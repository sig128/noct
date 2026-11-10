"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatAmount, formatUnits, formatUsd, parseDecimalRatio, parseUnits, valueOf } from "@/lib/decimal";
import { useDefaultTokens, useMintFacts, useNow, usePrices, usePublicBalances, useEpoch, publicBalanceOf } from "@/lib/client/hooks";
import { usePrivate, useSettings, useSwapDraft, useWallet } from "@/lib/client/stores";
import { txFlow, useTxFlow } from "@/lib/client/tx-flow";
import { swapSpec, rateText } from "@/lib/client/swap-spec";
import { PROFILES, UNAVAILABLE, type PrivacyClass } from "@/lib/privacy/model";
import { isQuoteStale, networkCostLamports, QUOTE_TTL_MS } from "@/lib/swap/quote";
import { maxSpendable, presetAmount, TOKEN_ACCOUNT_RENT_LAMPORTS } from "@/lib/swap/max";
import { activeTransferFee, extensionRestrictions } from "@/lib/tokens/mint-account";
import { annotateIdentity } from "@/lib/tokens/identity";
import { assessTokenRisk } from "@/lib/tokens/risk";
import { NATIVE_SOL_MINT, USDC_MINT, type TokenInfo } from "@/lib/tokens/types";
import { Icon, Spinner } from "@/components/ui/Icon";
import { AmountOutput, AmountTokenInput } from "./AmountTokenInput";
import { TokenPicker } from "./TokenPicker";
import { QuoteDetails } from "./QuoteDetails";
import { DisclosurePreview } from "./DisclosurePreview";
import { useSwapQuote } from "./useSwapQuote";
import styles from "./swap.module.css";

function usd(amount: bigint | null, token: TokenInfo | null, price: string | undefined): string | null {
  if (amount === null || !token || !price) return null;
  const r = parseDecimalRatio(price);
  return r ? `≈ ${formatUsd(valueOf(amount, token.decimals, r))}` : null;
}

export function SwapCard({ headingLevel }: { headingLevel: 1 | 2 }) {
  const { input, output, amountText, requestedPrivacy, set } = useSwapDraft();
  const demo = useSettings((s) => s.demoMode);
  const network = useSettings((s) => s.network);
  const slippage = useSettings((s) => s.slippageBps);
  const address = useWallet((s) => s.address);
  const privateStatus = usePrivate((s) => s.status);
  const flowOpen = useTxFlow((s) => s.open);
  const [picker, setPicker] = useState<"pay" | "receive" | null>(null);
  const [modeOpen, setModeOpen] = useState(false);
  const [slipOpen, setSlipOpen] = useState(false);
  const now = useNow();

  const defaults = useDefaultTokens();
  useEffect(() => {
    const list = defaults.data;
    if (!list || (input && output)) return;
    const sol = list.find((t) => t.mint === NATIVE_SOL_MINT);
    const usdc = list.find((t) => t.mint === USDC_MINT);
    if (!input && !output && sol && usdc) set({ input: sol, output: usdc });
  }, [defaults.data, input, output, set]);

  // Token metadata changes with demo mode; drop selections from the other world.
  const demoRef = useRef(demo);
  useEffect(() => {
    if (demoRef.current !== demo) {
      demoRef.current = demo;
      set({ input: null, output: null, amountText: "" });
    }
  }, [demo, set]);

  const balances = usePublicBalances();
  const prices = usePrices([input?.mint, output?.mint]);
  const inputFacts = useMintFacts(input?.mint);
  const outputFacts = useMintFacts(output?.mint);
  const epoch = useEpoch();

  const parsed = input && amountText ? parseUnits(amountText, input.decimals) : null;
  const amount = parsed?.ok ? parsed.value : null;
  const quoteState = useSwapQuote(input, output, amount);
  const quote = quoteState.status === "ready" ? quoteState.quote : null;

  const inputBalance = input && address ? publicBalanceOf(balances.data, input.mint) : null;
  const outputBalance = output && address ? publicBalanceOf(balances.data, output.mint) : null;
  const outputHasAccount = Boolean(output && (output.mint === NATIVE_SOL_MINT || balances.data?.tokens.some((t) => t.mint === output.mint)));

  const max = useMemo(() => {
    if (!input || inputBalance === null) return null;
    return maxSpendable({
      balance: inputBalance,
      isNativeSol: input.mint === NATIVE_SOL_MINT,
      networkFeeLamports: quote ? networkCostLamports(quote, address) || 50_000n : 50_000n,
      rentLamports: outputHasAccount ? 0n : TOKEN_ACCOUNT_RENT_LAMPORTS,
    });
  }, [input, inputBalance, quote, address, outputHasAccount]);

  const restrictions = [...(inputFacts.data ? extensionRestrictions(inputFacts.data) : []), ...(outputFacts.data ? extensionRestrictions(outputFacts.data) : [])];
  const blocked = restrictions.find((r) => r.severity === "block");
  const outFee = outputFacts.data && epoch.data !== undefined ? activeTransferFee(outputFacts.data, epoch.data) : null;

  const outputFlags = useMemo(() => {
    if (!output) return [];
    const ann = annotateIdentity([output], defaults.data ?? []).get(output.mint);
    return [...(ann?.flags ?? []), ...assessTokenRisk(output)].filter((f) => f.level === "danger");
  }, [output, defaults.data]);

  const stale = quote ? isQuoteStale(quote, now || Date.now(), QUOTE_TTL_MS) : false;
  const ageSec = quote && now ? Math.max(0, Math.round((now - quote.receivedAt) / 1000)) : 0;

  const insufficient = amount !== null && inputBalance !== null && max !== null && amount > (input?.mint === NATIVE_SOL_MINT ? max.amount : inputBalance);

  // ---- primary action -------------------------------------------------------
  let action: { label: string; disabled: boolean; busy?: boolean; onClick?: () => void; hint?: string };
  if (requestedPrivacy !== "public") action = { label: "Private balance swaps are unavailable", disabled: true };
  else if (!input || !output) action = { label: "Select a token", disabled: true };
  else if (input.mint === output.mint) action = { label: "Choose two different tokens", disabled: true };
  else if (!amountText || amount === null)
    action = { label: parsed && !parsed.ok && parsed.reason === "too_large" ? "Amount too large" : "Enter an amount", disabled: true };
  else if (quoteState.status === "wrong_network") action = { label: "Swaps need mainnet", disabled: true, hint: quoteState.error ?? undefined };
  else if (blocked) action = { label: "This token cannot be moved", disabled: true, hint: blocked.message };
  else if (!address) action = { label: demo ? "Use the demo wallet" : "Connect wallet to swap", disabled: false, onClick: () => useWallet.getState().set({ pickerOpen: true }) };
  else if (insufficient) action = { label: `Insufficient ${input.symbol}`, disabled: true, hint: input.mint === NATIVE_SOL_MINT ? "Keeps SOL back for fees and account rent." : undefined };
  else if (quoteState.status === "loading") action = { label: "Getting a quote", disabled: true, busy: true };
  else if (quoteState.status === "no_route") action = { label: "No route for this pair", disabled: true, hint: quoteState.error ?? undefined };
  else if (quoteState.status === "error") action = { label: "Retry quote", disabled: false, onClick: quoteState.refresh, hint: quoteState.error ?? undefined };
  else if (!quote) action = { label: "Getting a quote", disabled: true, busy: true };
  else if (stale) action = { label: "Refresh quote", disabled: false, onClick: quoteState.refresh };
  else
    action = {
      label: "Review swap",
      disabled: flowOpen,
      onClick: () =>
        void txFlow.start(
          swapSpec({
            input,
            output,
            amount: amount!,
            slippageBps: slippage,
            network,
            signer: address,
            demo,
            inputBalance: input.mint === NATIVE_SOL_MINT ? max!.amount : inputBalance ?? 0n,
            outputTransferFeeBps: outFee?.basisPoints ?? null,
            onSettled: () => void balances.refetch(),
          }),
        ),
    };

  const presets =
    max && max.amount > 0n && input && address && requestedPrivacy === "public"
      ? ([25, 50, 100] as const).map((p) => ({
          label: p === 100 ? "Max" : `${p}%`,
          onClick: () => set({ amountText: formatUnits(presetAmount(max.amount, p), input.decimals) }),
        }))
      : undefined;

  const reverse = () => {
    const nextText = quote && output ? formatUnits(quote.outAmount, output.decimals) : "";
    set({ input: output, output: input, amountText: nextText });
  };

  const Heading = headingLevel === 1 ? "h1" : "h2";
  const [announce, setAnnounce] = useState("");
  const lastKey = useRef("");
  useEffect(() => {
    if (!quote || !output) return;
    const key = `${quote.inputMint}${quote.outputMint}${quote.inAmount}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      setAnnounce(`Quote ready: about ${formatAmount(quote.outAmount, output.decimals)} ${output.symbol}.`);
    }
  }, [quote, output]);

  return (
    <section className={`${styles.card} glass`} aria-labelledby="swap-heading">
      <header className={styles.head}>
        <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
          <Heading id="swap-heading" className={styles.title} tabIndex={-1}>
            Swap
          </Heading>
          {demo ? <span className={`chip chip-warn ${styles.demoTag}`}>Demo</span> : null}
        </div>
        <div className={styles.headTools}>
          <button
            type="button"
            className={styles.modeBtn}
            data-mode={requestedPrivacy === "public" ? "public" : "private"}
            aria-haspopup="true"
            aria-expanded={modeOpen}
            onClick={() => {
              setSlipOpen(false);
              setModeOpen((o) => !o);
            }}
          >
            <Icon name={requestedPrivacy === "public" ? "globe" : "rosette"} size={15} />
            {requestedPrivacy === "public" ? "Public wallet" : "Private balance"}
            <Icon name="chevronDown" size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Slippage: ${slippage ? `${(slippage / 100).toFixed(2)}%` : "automatic"}`}
            aria-haspopup="true"
            aria-expanded={slipOpen}
            onClick={() => {
              setModeOpen(false);
              setSlipOpen((o) => !o);
            }}
          >
            <Icon name="sliders" size={18} />
          </button>
        </div>
      </header>

      {modeOpen ? <ModePopover value={requestedPrivacy} privateStatus={privateStatus} onChange={(v) => set({ requestedPrivacy: v })} onClose={() => setModeOpen(false)} /> : null}
      {slipOpen ? <SlippagePopover onClose={() => setSlipOpen(false)} /> : null}

      <div className={styles.fields}>
        <AmountTokenInput
          label="You pay"
          token={input}
          value={amountText}
          onChange={(v) => set({ amountText: v })}
          onPickToken={() => setPicker("pay")}
          usdText={usd(amount, input, prices.data?.[input?.mint ?? ""]?.usdPrice)}
          balance={inputBalance !== null ? { amount: inputBalance } : null}
          presets={presets}
          invalid={insufficient}
        />
        <button type="button" className={styles.reverse} aria-label="Reverse tokens" onClick={reverse}>
          <Icon name="reverse" size={18} />
        </button>
        <AmountOutput
          label="You receive"
          token={output}
          amount={quote?.outAmount ?? null}
          loading={quoteState.status === "loading"}
          onPickToken={() => setPicker("receive")}
          usdText={usd(quote?.outAmount ?? null, output, prices.data?.[output?.mint ?? ""]?.usdPrice)}
          status={quoteState.status === "no_route" ? "No executable route" : undefined}
          balance={outputBalance !== null && outputBalance > 0n ? { amount: outputBalance } : null}
        />
      </div>

      <p className="vh" aria-live="polite">
        {announce}
      </p>

      {outputFlags.length > 0 ? (
        <div className="note note-error">
          <Icon name="warning" size={16} />
          <span>{outputFlags[0]!.message}</span>
        </div>
      ) : null}
      {restrictions.filter((r) => r.severity === "warn").slice(0, 1).map((r) => (
        <div key={r.code} className="note note-warn">
          <Icon name="warning" size={16} />
          <span>{r.message}</span>
        </div>
      ))}

      {requestedPrivacy !== "public" ? (
        <div className="note note-private">
          <Icon name="rosette" size={16} />
          <span>
            {UNAVAILABLE.privateSwap} You can swap from your public wallet, or withdraw from your private balance first (a public withdrawal).{" "}
            <button type="button" className="link" style={{ background: "none", border: 0, padding: 0, color: "inherit", font: "inherit" }} onClick={() => set({ requestedPrivacy: "public" })}>
              Swap from public wallet instead
            </button>
          </span>
        </div>
      ) : null}

      {quote && input && output ? (
        <>
          <div className={styles.quoteLine}>
            <span className={`${styles.rate} num`}>{rateText(quote, input, output)}</span>
            <span className={styles.fresh} data-stale={stale}>
              {quoteState.refreshing ? (
                <>
                  <Spinner size={12} /> Refreshing
                </>
              ) : stale ? (
                "Quote expired"
              ) : (
                <span className="num">Updated {ageSec}s ago</span>
              )}
              <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Refresh quote" onClick={quoteState.refresh}>
                <Icon name="refresh" size={14} />
              </button>
            </span>
          </div>
          <QuoteDetails quote={quote} input={input} output={output} taker={address} transferFeeBps={outFee?.basisPoints ?? null} />
        </>
      ) : null}

      <DisclosurePreview profile={PROFILES.publicSwap} detail=" Your wallet address, both tokens and both amounts are visible on chain." />

      <div className={styles.primaryWrap}>
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={action.disabled}
          data-busy={action.busy ?? false}
          aria-describedby={action.hint ? "swap-action-hint" : undefined}
          onClick={action.onClick}
        >
          {action.busy ? <Spinner size={16} /> : null}
          {action.label}
        </button>
        {action.hint ? (
          <p id="swap-action-hint" className={styles.primaryHint}>
            {action.hint}
          </p>
        ) : null}
      </div>

      <TokenPicker
        open={picker !== null}
        side={picker ?? "pay"}
        exclude={picker === "pay" ? (output?.mint ?? null) : (input?.mint ?? null)}
        onClose={() => setPicker(null)}
        onSelect={(token) => {
          if (picker === "pay") {
            // Keep the typed amount, trimmed to the new token's precision.
            const [w = "", f] = amountText.split(".");
            const text = f !== undefined && token.decimals > 0 ? `${w}.${f.slice(0, token.decimals)}` : w;
            set({ input: token, amountText: text });
          } else set({ output: token });
          setPicker(null);
        }}
      />
    </section>
  );
}

function ModePopover({ value, onChange, onClose, privateStatus }: { value: PrivacyClass; onChange(v: PrivacyClass): void; onClose(): void; privateStatus: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest("[aria-haspopup]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);
  const options: { value: PrivacyClass; label: string; desc: string }[] = [
    { value: "public", label: "Public wallet", desc: "Your wallet signs a Jupiter swap. Everything about it is public." },
    {
      value: "confidential_transfer",
      label: "Private balance",
      desc: `Not available. ${UNAVAILABLE.privateSwap}${privateStatus === "ready" ? "" : " Your private balance is also locked."}`,
    },
  ];
  return (
    <div ref={ref} className={`${styles.popover} glass`} role="radiogroup" aria-label="Swap from">
      <p className={styles.popoverTitle}>Swap from</p>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={styles.option}
          onClick={() => {
            onChange(o.value);
            onClose();
          }}
        >
          <span className={styles.optionMark}>
            <Icon name={value === o.value ? "check" : o.value === "public" ? "globe" : "rosette"} size={16} />
          </span>
          <span className={styles.optionLabel}>{o.label}</span>
          <span className={styles.optionDesc}>{o.desc}</span>
        </button>
      ))}
    </div>
  );
}

function SlippagePopover({ onClose }: { onClose(): void }) {
  const value = useSettings((s) => s.slippageBps);
  const setValue = useSettings((s) => s.setSlippageBps);
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState(value && ![30, 50, 100].includes(value) ? (value / 100).toString() : "");
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const presets: { label: string; bps: number | null }[] = [
    { label: "Auto", bps: null },
    { label: "0.3%", bps: 30 },
    { label: "0.5%", bps: 50 },
    { label: "1%", bps: 100 },
  ];
  return (
    <div ref={ref} className={`${styles.popover} glass`} role="dialog" aria-label="Slippage limit">
      <p className={styles.popoverTitle}>Slippage limit. Auto lets Jupiter estimate it per trade.</p>
      <div style={{ display: "flex", gap: 6, padding: "0 6px 8px", flexWrap: "wrap" }}>
        {presets.map((p) => (
          <button key={p.label} type="button" className="btn" style={{ minHeight: 36, padding: "0 12px", borderColor: value === p.bps ? "var(--accent-line)" : undefined, color: value === p.bps ? "var(--accent)" : undefined }} aria-pressed={value === p.bps} onClick={() => setValue(p.bps)}>
            {p.label}
          </button>
        ))}
      </div>
      <form
        style={{ display: "flex", gap: 6, padding: "0 6px 6px" }}
        onSubmit={(e) => {
          e.preventDefault();
          const pct = Number(custom);
          if (Number.isFinite(pct) && pct > 0 && pct <= 50) setValue(Math.round(pct * 100));
        }}
      >
        <label className="vh" htmlFor="slip-custom">
          Custom slippage percent
        </label>
        <input id="slip-custom" className="text-input num" inputMode="decimal" placeholder="Custom %" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ""))} />
        <button type="submit" className="btn" style={{ minHeight: 46 }}>
          Set
        </button>
      </form>
      {value !== null && value > 300 ? <p className={styles.primaryHint} style={{ color: "var(--warn)", textAlign: "left" }}>Above 3%, a trade can fill at a much worse price.</p> : null}
    </div>
  );
}
