"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useCapabilities, useDefaultTokens, useEarnMarkets, useMintFacts, useVaults } from "@/lib/client/hooks";
import { usePrivate, useSettings, useSwapDraft } from "@/lib/client/stores";
import { tokenCapabilities } from "@/lib/capabilities";
import { annotateIdentity } from "@/lib/tokens/identity";
import { assessTokenRisk } from "@/lib/tokens/risk";
import { shortAddress } from "@/lib/tokens/sanitize";
import { formatAge } from "@/lib/credit/vault-math";
import { CopyButton, Row, TokenAvatar } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/client/api";
import styles from "./shell.module.css";
import swap from "@/components/swap/swap.module.css";

const Rosette = dynamic(() => import("./Rosette").then((m) => m.Rosette), { ssr: false });

function compactUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "Not reported";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function AmbientContext() {
  const privateStatus = usePrivate((s) => s.status);
  return (
    <div className={styles.ambient}>
      <div className={styles.ambientLayer} aria-hidden="true">
        <div className={styles.ambientArt}>
          <Rosette tone={privateStatus === "ready" ? "private" : "neutral"} />
        </div>
      </div>
      <TokenDossier />
    </div>
  );
}

/** Due-diligence facts for the token being bought, beside the swap. */
function TokenDossier() {
  const output = useSwapDraft((s) => s.output);
  const input = useSwapDraft((s) => s.input);
  const demo = useSettings((s) => s.demoMode);
  const network = useSettings((s) => s.network);
  const defaults = useDefaultTokens();
  const facts = useMintFacts(output?.mint);
  const caps = useCapabilities();
  const earn = useEarnMarkets();
  const vaults = useVaults();
  const qc = useQueryClient();

  const token = output;
  // Route state for this pair, read from quotes the swap card already fetched (no new request).
  const pairKey = useMemo(() => ["quote", demo, network, input?.mint, output?.mint], [demo, network, input?.mint, output?.mint]);
  const subscribe = useCallback((cb: () => void) => qc.getQueryCache().subscribe(cb), [qc]);
  const route = useSyncExternalStore(
    subscribe,
    () => {
      if (!input || !output) return "unchecked" as const;
      const found = qc.getQueryCache().findAll({ queryKey: pairKey });
      if (found.some((q) => q.state.data !== undefined)) return "found" as const;
      if (found.some((q) => q.state.error instanceof ApiError && q.state.error.code === "no_route")) return "none" as const;
      return "unchecked" as const;
    },
    () => "unchecked" as const,
  );
  const flags = useMemo(() => {
    if (!token) return [];
    const ann = annotateIdentity([token], defaults.data ?? []).get(token.mint);
    return [...(ann?.flags ?? []), ...assessTokenRisk(token)];
  }, [token, defaults.data]);

  if (!token) return null;

  const privacyNet = demo ? { enabled: true, reason: null } : caps.data ? { enabled: caps.data.privacy[network].enabled, reason: caps.data.privacy[network].reason } : { enabled: false, reason: "Checking configuration…" };
  const { capabilities } = tokenCapabilities({
    mint: token.mint,
    route,
    mintFacts: facts.isPending && token.mint !== "So11111111111111111111111111111111111111112" ? undefined : (facts.data ?? null),
    privacy: privacyNet,
    earnAssets: new Set((earn.data?.markets ?? []).map((m) => m.assetAddress)),
    collateralMints: new Set((vaults.data?.vaults ?? []).map((v) => v.supplyToken.address)),
    debtMints: new Set((vaults.data?.vaults ?? []).map((v) => v.borrowToken.address)),
  });
  const created = token.createdAt ? Date.parse(token.createdAt) : NaN;

  return (
    <aside className={`${swap.dossier} glass`} aria-label={`About ${token.symbol}`}>
      <div className={swap.dossierHead}>
        <TokenAvatar symbol={token.symbol} icon={token.icon} mint={token.mint} size={34} />
        <div style={{ minWidth: 0 }}>
          <h2>
            {token.symbol}{" "}
            {token.verified ? <Icon name="check" size={14} style={{ color: "var(--accent)", verticalAlign: "-2px" }} aria-label="Verified" /> : null}
          </h2>
          <span className={swap.dossierName}>{token.name}</span>
        </div>
      </div>
      <dl className={swap.facts}>
        <Row label="Mint">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
            {shortAddress(token.mint, 5, 5)}
            <CopyButton value={token.mint} label="Copy mint address" />
          </span>
        </Row>
        <Row label="Program">{facts.data?.program === "token2022" || token.tokenProgram === "token2022" ? "Token-2022" : "SPL Token"}</Row>
        <Row label="Liquidity">{compactUsd(token.liquidityUsd)}</Row>
        <Row label="Holders">{token.holderCount !== null ? token.holderCount.toLocaleString("en-US") : "Not reported"}</Row>
        {Number.isFinite(created) ? <Row label="Created">{formatAge(Date.now() - created)} ago</Row> : null}
        {token.launchpad ? <Row label="Launched on">{token.launchpad}</Row> : null}
      </dl>
      {flags.filter((f) => f.level !== "info").length > 0 ? (
        <ul className={swap.flags}>
          {flags
            .filter((f) => f.level !== "info")
            .slice(0, 3)
            .map((f) => (
              <li key={f.code} data-level={f.level}>
                <Icon name="warning" size={14} />
                <span>{f.message}</span>
              </li>
            ))}
        </ul>
      ) : null}
      <ul className={swap.caps} aria-label="What NOCT can do with this token">
        {capabilities
          .filter((c) => ["publicRoute", "privateHolding", "earnMarket", "borrowCollateral"].includes(c.key))
          .map((c) => (
            <li key={c.key} title={c.detail}>
              <span>{c.label}</span>
              <span className={swap.capState} data-status={c.status}>
                {c.status === "available" ? "Yes" : c.status === "unavailable" ? "No" : "Not checked"}
              </span>
            </li>
          ))}
      </ul>
    </aside>
  );
}
