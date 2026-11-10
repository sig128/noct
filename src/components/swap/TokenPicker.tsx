"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatAmount, formatUsd, formatUsdPrice, parseDecimalRatio, valueOf } from "@/lib/decimal";
import { useDefaultTokens, usePublicBalances, useTokenSearch, useTokensByMint } from "@/lib/client/hooks";
import { annotateIdentity, rankTokens } from "@/lib/tokens/identity";
import { assessTokenRisk } from "@/lib/tokens/risk";
import { isLikelySolanaAddress, shortAddress } from "@/lib/tokens/sanitize";
import { NATIVE_SOL_MINT, type RiskFlag, type TokenInfo } from "@/lib/tokens/types";
import { Dialog, Sensitive, TokenAvatar, CopyButton } from "@/components/ui/primitives";
import { Icon, Spinner } from "@/components/ui/Icon";
import styles from "./swap.module.css";

interface Props {
  open: boolean;
  side: "pay" | "receive";
  exclude: string | null;
  onClose(): void;
  onSelect(token: TokenInfo): void;
}

export function TokenPicker({ open, side, exclude, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<{ token: TokenInfo; flags: RiskFlag[] } | null>(null);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const defaults = useDefaultTokens();
  const search = useTokenSearch(query);
  const balances = usePublicBalances();
  const heldMints = useMemo(() => (balances.data?.tokens ?? []).filter((t) => t.amount > 0n).map((t) => t.mint), [balances.data]);
  const held = useTokensByMint(heldMints.slice(0, 40));

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setPending(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const trimmed = query.trim();
  const exactMint = isLikelySolanaAddress(trimmed);
  const reference = defaults.data ?? [];

  const { groups, flat } = useMemo(() => {
    let groups: { label: string; tokens: TokenInfo[] }[];
    if (trimmed) {
      // Only results for exactly what is typed; stale results could be picked by mistake.
      const ranked = search.forQuery === trimmed ? rankTokens(search.data ?? [], trimmed) : [];
      groups = [{ label: exactMint ? "Mint lookup" : "Results", tokens: ranked }];
    } else {
      const heldTokens = (held.data ?? []).filter((t) => !reference.some((r) => r.mint === t.mint));
      groups = [
        { label: "Popular", tokens: reference },
        ...(heldTokens.length > 0 ? [{ label: "In your wallet", tokens: heldTokens }] : []),
      ];
    }
    groups = groups.map((g) => ({ ...g, tokens: g.tokens.filter((t) => t.mint !== exclude) })).filter((g) => g.tokens.length > 0);
    return { groups, flat: groups.flatMap((g) => g.tokens) };
  }, [trimmed, search.data, search.forQuery, held.data, reference, exclude, exactMint]);

  const identity = useMemo(() => annotateIdentity(flat, reference), [flat, reference]);

  const choose = (token: TokenInfo) => {
    const flags = [...(identity.get(token.mint)?.flags ?? []), ...assessTokenRisk(token)];
    if (flags.some((f) => f.level === "danger")) {
      setPending({ token, flags });
      return;
    }
    onSelect(token);
  };

  const balanceOf = (mint: string): bigint | null => {
    if (!balances.data) return null;
    if (mint === NATIVE_SOL_MINT) return balances.data.lamports;
    const rows = balances.data.tokens.filter((t) => t.mint === mint);
    return rows.length ? rows.reduce((a, t) => a + t.amount, 0n) : null;
  };

  const loading = trimmed ? search.forQuery !== trimmed || (search.isFetching && !search.data) : defaults.isLoading;
  const error = trimmed ? (search.forQuery === trimmed ? search.error : null) : defaults.error;

  return (
    <Dialog open={open} onClose={onClose} labelledBy={`${listId}-title`} size="md">
      {pending ? (
        <div className={styles.confirm}>
          <h2 id={`${listId}-title`}>Check this token</h2>
          <ul className={styles.flags}>
            {pending.flags
              .filter((f) => f.level !== "info")
              .map((f) => (
                <li key={f.code} data-level={f.level}>
                  <Icon name="warning" size={14} />
                  <span>{f.message}</span>
                </li>
              ))}
          </ul>
          <div>
            <p style={{ margin: "0 0 6px", color: "var(--text-2)", fontSize: "var(--fs-small)" }}>
              {pending.token.symbol}, {pending.token.name}
            </p>
            <div className={`${styles.mintBox} num`}>
              <span style={{ flex: 1 }}>{pending.token.mint}</span>
              <CopyButton value={pending.token.mint} label="Copy mint address" />
            </div>
          </div>
          <div className={styles.confirmActions}>
            <button type="button" className="btn" onClick={() => setPending(null)}>
              Back to list
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const t = pending.token;
                setPending(null);
                onSelect(t);
              }}
            >
              Use this token
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.picker}>
          <div className={styles.pickerHead}>
            <div className={styles.pickerTitleRow}>
              <h2 id={`${listId}-title`}>{side === "pay" ? "Token to pay" : "Token to receive"}</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className={styles.searchWrap}>
              <Icon name="search" size={17} />
              <input
                ref={inputRef}
                className="text-input"
                type="search"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={flat[active] ? `${listId}-${flat[active]!.mint}` : undefined}
                aria-autocomplete="list"
                placeholder="Name, ticker or mint address"
                value={query}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, Math.max(0, flat.length - 1)));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter" && flat[active]) {
                    e.preventDefault();
                    choose(flat[active]!);
                  }
                }}
              />
            </div>
          </div>
          <ul id={listId} className={styles.pickerList} role="listbox" aria-label="Tokens" aria-busy={loading}>
            {loading ? (
              <li style={{ display: "flex", gap: 10, alignItems: "center", padding: "14px 10px", color: "var(--text-2)" }}>
                <Spinner size={16} /> Searching tokens…
              </li>
            ) : error ? (
              <li className="note note-error" style={{ margin: 10 }}>
                <Icon name="warning" size={16} />
                <span>Token search is unavailable: {(error as Error).message}</span>
              </li>
            ) : flat.length === 0 ? (
              <li style={{ padding: "14px 10px", color: "var(--text-2)", fontSize: "var(--fs-small)" }}>
                {trimmed ? (exactMint ? "No token metadata for this mint. It may not be tradable through Jupiter." : `No tokens match “${trimmed}”. Paste the mint address to look it up directly.`) : "No tokens to show."}
              </li>
            ) : (
              groups.map((g) => (
                <li key={g.label} role="presentation">
                  <div className={styles.groupLabel} role="presentation">
                    {g.label}
                  </div>
                  <ul role="group" aria-label={g.label} style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {g.tokens.map((t) => {
                      const index = flat.indexOf(t);
                      const ann = identity.get(t.mint);
                      const risks = [...(ann?.flags ?? []), ...assessTokenRisk(t)].filter((f) => f.level !== "info");
                      const bal = balanceOf(t.mint);
                      const price = t.usdPrice ? parseDecimalRatio(t.usdPrice) : null;
                      return (
                        <li
                          key={t.mint}
                          id={`${listId}-${t.mint}`}
                          role="option"
                          aria-selected={index === active}
                          className={styles.tokenRow}
                          onMouseEnter={() => setActive(index)}
                          onClick={() => choose(t)}
                        >
                          <TokenAvatar symbol={t.symbol} icon={t.icon} mint={t.mint} size={32} />
                          <div className={styles.tokenMain}>
                            <div className={styles.tokenLine}>
                              <span className={styles.tokenSymbol}>{t.symbol}</span>
                              {t.verified ? (
                                <span className={styles.verified} title="Verified by Jupiter">
                                  <Icon name="check" size={14} aria-label="Verified" />
                                </span>
                              ) : null}
                              <span className={`${styles.tokenMint} num`}>{shortAddress(t.mint, 4, 4)}</span>
                            </div>
                            <span className={styles.tokenName}>{t.name}</span>
                            {risks.length > 0 ? (
                              <div className={styles.riskLine}>
                                {risks.slice(0, 2).map((f) => (
                                  <span key={f.code} className={`chip ${f.level === "danger" ? "chip-error" : "chip-warn"}`} title={f.message}>
                                    {f.code === "ticker_collision" ? (ann?.imitates ? `Not the verified ${ann.imitates.symbol}` : "Shared ticker") : f.code === "lookalike" ? "Lookalike ticker" : f.code === "suspicious" ? "Flagged" : f.code === "unverified" ? "Unverified" : f.code === "freeze_authority" ? "Freezable" : f.code === "mint_authority" ? "Mintable" : f.code === "low_liquidity" ? "Thin liquidity" : f.code === "new_token" ? "New" : f.code === "concentrated_holders" ? "Concentrated" : "Caution"}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <div className={`${styles.tokenSide} num`}>
                            {bal !== null && bal > 0n ? (
                              <>
                                <Sensitive>{formatAmount(bal, t.decimals)}</Sensitive>
                                {price ? (
                                  <div style={{ color: "var(--text-3)", fontSize: "var(--fs-micro)" }}>
                                    <Sensitive>{formatUsd(valueOf(bal, t.decimals, price))}</Sensitive>
                                  </div>
                                ) : null}
                              </>
                            ) : price ? (
                              formatUsdPrice(price)
                            ) : (
                              <span style={{ color: "var(--text-3)" }}>No price</span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
          <div className={styles.pickerFoot}>Token details come from Jupiter's token API and are shown as plain text. A route existing does not mean a token is safe or private-balance compatible.</div>
        </div>
      )}
    </Dialog>
  );
}
