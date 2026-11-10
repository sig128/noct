"use client";

import { useState } from "react";
import Link from "next/link";
import { formatAmount, parseUnits } from "@/lib/decimal";
import { usePrivate, useSettings, useTransferDraft, useWallet } from "@/lib/client/stores";
import { privateTransferSpec, registrationSpec } from "@/lib/client/private-specs";
import { txFlow } from "@/lib/client/tx-flow";
import { useTokensByMint } from "@/lib/client/hooks";
import { isLikelySolanaAddress } from "@/lib/tokens/sanitize";
import { NATIVE_SOL_MINT } from "@/lib/tokens/types";
import { PROFILES, UNAVAILABLE } from "@/lib/privacy/model";
import { ModulePanel } from "@/components/shell/ModulePanel";
import { CopyButton, EmptyState, Segmented } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { DisclosurePreview } from "@/components/swap/DisclosurePreview";
import { useTokenLabel } from "@/components/swap/useTokenLabel";
import { AmountField, Select } from "./common";
import styles from "./panels.module.css";

export function TransferPanel() {
  const [tab, setTab] = useState<"send" | "receive">("send");
  const demo = useSettings((s) => s.demoMode);
  return (
    <ModulePanel id="send" title="Send and receive" lead="Private transfers from your private balance to a registered Solana address." badge={demo ? <span className="chip chip-warn">Demo data</span> : null}>
      <div style={{ marginBottom: 16 }}>
        <Segmented
          label="Direction"
          value={tab}
          onChange={setTab}
          options={[
            { value: "send", label: "Send" },
            { value: "receive", label: "Receive" },
          ]}
        />
      </div>
      {tab === "send" ? <SendForm /> : <ReceiveView />}
    </ModulePanel>
  );
}

function LockedNotice() {
  return (
    <EmptyState
      title="Unlock your private balance to send"
      action={
        <Link className="btn" href="/balance">
          Go to balance
        </Link>
      }
    >
      Private transfers spend from the private balance, which is locked. Public tokens can be deposited there first.
    </EmptyState>
  );
}

function SendForm() {
  const priv = usePrivate();
  const demo = useSettings((s) => s.demoMode);
  const network = useSettings((s) => s.network);
  const address = useWallet((s) => s.address);
  const draft = useTransferDraft();
  const tokens = useTokensByMint(priv.balances.map((b) => b.mint));
  const mint = draft.assetMint && priv.balances.some((b) => b.mint === draft.assetMint) ? draft.assetMint : (priv.balances[0]?.mint ?? NATIVE_SOL_MINT);
  const label = useTokenLabel(mint);
  if (!address) {
    return (
      <EmptyState
        title="Connect a wallet"
        action={
          <button type="button" className="btn" onClick={() => useWallet.getState().set({ pickerOpen: true })}>
            {demo ? "Use demo wallet" : "Connect wallet"}
          </button>
        }
      />
    );
  }
  if (priv.status !== "ready") return <LockedNotice />;
  const bal = priv.balances.find((b) => b.mint === mint)?.amount ?? 0n;
  const parsed = draft.amountText ? parseUnits(draft.amountText, label.decimals) : null;
  const amount = parsed?.ok ? parsed.value : null;
  const recipient = draft.recipient.trim();
  const validRecipient = isLikelySolanaAddress(recipient);
  const self = recipient === address;
  const over = amount !== null && amount > bal;

  let action = "Review private transfer";
  if (!validRecipient) action = recipient ? "Enter a valid Solana address" : "Enter a recipient";
  else if (self) action = "That is your own address";
  else if (!amount) action = "Enter an amount";
  else if (over) action = "More than your private balance";

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (!validRecipient || self || !amount || over) return;
        void txFlow.start(
          privateTransferSpec({
            network,
            signer: address,
            demo,
            assetMint: mint,
            symbol: label.symbol,
            decimals: label.decimals,
            amount,
            token2022: label.token?.tokenProgram === "token2022",
            recipient,
            onSettled: () => useTransferDraft.getState().set({ amountText: "" }),
          }),
        );
      }}
    >
      <div>
        <label className={styles.fieldLabel} htmlFor="send-recipient">
          Recipient's Solana address
        </label>
        <input
          id="send-recipient"
          className="text-input num"
          value={draft.recipient}
          onChange={(e) => draft.set({ recipient: e.target.value })}
          autoComplete="off"
          spellCheck={false}
          placeholder="Solana address"
          aria-invalid={recipient.length > 0 && !validRecipient}
        />
        <p className={styles.hint} style={{ marginTop: 6 }}>
          The recipient must have registered a private address. If not, NOCT offers a public withdrawal instead and asks you to accept that first.
        </p>
      </div>
      {priv.balances.length === 0 ? (
        <p className={styles.meta}>Your private balance is empty.</p>
      ) : (
        <>
          <Select
            label="Token"
            value={mint}
            onChange={(v) => draft.set({ assetMint: v, amountText: "" })}
            options={priv.balances.map((b) => ({ value: b.mint, label: tokens.data?.find((t) => t.mint === b.mint)?.symbol ?? (b.mint === NATIVE_SOL_MINT ? "SOL" : b.mint.slice(0, 6)) }))}
          />
          <AmountField label="Amount" value={draft.amountText} onChange={(v) => draft.set({ amountText: v })} decimals={label.decimals} symbol={label.symbol} max={bal} invalid={over} />
        </>
      )}
      <DisclosurePreview profile={PROFILES.privateTransfer} detail=" The token and amount are hidden; your address and the recipient's are visible." />
      <div className="note">
        <Icon name="info" size={16} />
        <span>{UNAVAILABLE.anonymousTransfer}</span>
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={action !== "Review private transfer"}>
        {action}
      </button>
    </form>
  );
}

function ReceiveView() {
  const priv = usePrivate();
  const address = useWallet((s) => s.address);
  const demo = useSettings((s) => s.demoMode);
  const network = useSettings((s) => s.network);
  const [mint, setMint] = useState<string>(NATIVE_SOL_MINT);
  const [amountText, setAmountText] = useState("");
  const label = useTokenLabel(mint);
  if (!address) return <EmptyState title="Connect a wallet to receive" />;
  const parsed = amountText ? parseUnits(amountText, label.decimals) : null;
  const request = parsed?.ok
    ? `Please send ${formatAmount(parsed.value, label.decimals, { maxFraction: label.decimals })} ${label.symbol} (mint ${mint}) to ${address} as a Solana Privacy Rings private transfer.`
    : null;
  return (
    <div className={styles.form}>
      <div>
        <span className={styles.fieldLabel}>Your receiving address</span>
        <div className="note" style={{ alignItems: "center" }}>
          <span className={styles.code} style={{ flex: 1 }}>
            {address}
          </span>
          <CopyButton value={address} label="Copy address" />
        </div>
        <p className={styles.hint} style={{ marginTop: 6 }}>
          Private transfers are addressed to your normal Solana address once it is registered. Your address stays visible on chain; the token and amount do not.
        </p>
      </div>
      {priv.status !== "ready" ? (
        <div className="note note-private">
          <Icon name="lock" size={16} />
          <span>
            Unlock your private balance to check whether this address is registered. <Link className="link" href="/balance">Go to balance</Link>
          </span>
        </div>
      ) : priv.registered ? (
        <div className="note note-accent">
          <Icon name="check" size={16} />
          <span>Registered. Others can send to you privately.</span>
        </div>
      ) : (
        <div className="note">
          <Icon name="info" size={16} />
          <span>
            Not registered yet.{" "}
            <button type="button" className="link" style={{ background: "none", border: 0, padding: 0, color: "inherit", font: "inherit" }} onClick={() => void txFlow.start(registrationSpec({ network, signer: address, demo }))}>
              Review registration
            </button>
          </span>
        </div>
      )}
      <section className={styles.section}>
        <h2 className={styles.h2} style={{ marginBottom: 10 }}>
          Payment request
        </h2>
        <p className={styles.lead}>Compose a request to copy and share yourself. NOCT does not put amounts or addresses in links.</p>
        <div className={styles.form}>
          <AmountField label="Amount" value={amountText} onChange={setAmountText} decimals={label.decimals} symbol={label.symbol} />
          <Select
            label="Token"
            value={mint}
            onChange={(v) => {
              setMint(v);
              setAmountText("");
            }}
            options={[
              { value: NATIVE_SOL_MINT, label: "SOL" },
              { value: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", label: "USDC" },
            ]}
          />
          {request ? (
            <div className="note" style={{ alignItems: "center" }}>
              <span style={{ flex: 1, overflowWrap: "anywhere" }}>{request}</span>
              <CopyButton value={request} label="Copy request" />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
