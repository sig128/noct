"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCapabilities, useEarnMarkets, useMintFacts, useNow } from "@/lib/client/hooks";
import { txFlow, useTxFlow, type ReviewRow } from "@/lib/client/tx-flow";
import { useHandoff, usePrivate, useSettings } from "@/lib/client/stores";
import { sequence, useSequence } from "@/lib/client/sequence";
import { shieldSpec } from "@/lib/client/private-specs";
import { extensionRestrictions } from "@/lib/tokens/mint-account";
import { HOLDING_BLOCKERS } from "@/lib/capabilities";
import { formatAmount } from "@/lib/decimal";
import type { Phase } from "@/lib/operations/state-machine";
import { programLabel } from "@/lib/tx/programs";
import { Dialog, ExplorerLinks, Row, Sensitive } from "@/components/ui/primitives";
import { Icon, Spinner } from "@/components/ui/Icon";
import { VisibilityGrid, DisclosureSheet } from "@/components/swap/DisclosurePreview";
import styles from "./tx.module.css";

const STEPS = ["Review", "Sign", "Submit", "Confirm"] as const;

function stepIndex(phase: Phase): number {
  switch (phase) {
    case "quoting":
    case "review":
    case "awaitingApproval":
    case "staleQuote":
    case "rejected":
      return 0;
    case "preparing":
      return 1;
    case "submitting":
      return 2;
    case "confirming":
    case "pendingRecovery":
      return 3;
    case "completed":
      return 4;
    default:
      return 0;
  }
}

function ReviewRows({ rows }: { rows: ReviewRow[] }) {
  return (
    <dl className={styles.rows}>
      {rows.map((r) => (
        <Row key={r.label} label={r.label} tone={r.tone}>
          {r.sensitive ? <Sensitive>{r.value}</Sensitive> : r.value}
        </Row>
      ))}
    </dl>
  );
}

export function TxDialog() {
  const s = useTxFlow();
  const now = useNow();
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const earn = useEarnMarkets();
  const seq = useSequence();
  const privateStatus = usePrivate((p) => p.status);
  const demoMode = useSettings((st) => st.demoMode);
  const network = useSettings((st) => st.network);
  const caps = useCapabilities();
  const spec = s.spec;
  const swapIntent = s.built?.intent.kind === "swap" ? s.built.intent : null;
  const outFacts = useMintFacts(swapIntent?.outputMint);
  const idx = stepIndex(s.phase);
  const failed = s.phase === "retryableFailure";
  const can = txFlow.canApprove();

  useEffect(() => {
    if (!s.open) setSheet(false);
  }, [s.open]);

  if (!spec) return <Dialog open={false} onClose={() => {}} labelledBy="tx-title">{null}</Dialog>;

  const remaining = s.built ? Math.max(0, Math.ceil((s.built.expiresAt - (now || Date.now())) / 1000)) : null;
  const expired = remaining !== null && remaining <= 0 && (s.phase === "awaitingApproval" || s.phase === "rejected");
  const inFlight = ["preparing", "submitting", "confirming", "pendingRecovery"].includes(s.phase);

  // Cross-module next step: after swapping into an asset with an Earn market, offer (not perform) a supply.
  const swappedInto = spec.kind === "swap" && s.built?.intent.kind === "swap" ? s.built.intent.outputMint : null;
  const earnable = swappedInto && (earn.data?.markets ?? []).some((m) => m.assetAddress === swappedInto);

  // Guided series (for example paying from the private balance): show the step and offer the next one.
  const inSequence = Boolean(seq.title);
  const nextStep = inSequence ? (seq.steps[seq.index + 1] ?? null) : null;
  const stopNote = inSequence ? (seq.stopNotes[seq.index] ?? null) : null;
  const closeAll = () => {
    sequence.stop();
    txFlow.close();
  };

  // After an ordinary swap, offer to move what was bought into the private balance.
  const privacyOn = demoMode || Boolean(caps.data?.privacy[network].enabled);
  const holdBlocked = outFacts.data ? extensionRestrictions(outFacts.data).some((r) => HOLDING_BLOCKERS.includes(r.code)) : false;
  const receivedText = s.outputs?.received ?? s.outputs?.minimum ?? null;
  const canShield = !inSequence && swapIntent !== null && privacyOn && privateStatus === "ready" && !holdBlocked && receivedText !== null && BigInt(receivedText) > 0n;
  const shieldReceived = () => {
    if (!swapIntent || !receivedText || !spec) return;
    const amount = BigInt(receivedText);
    const symbol = s.built?.rows.find((r) => r.label === "You receive (estimated)")?.value.split(" ").pop() ?? "tokens";
    txFlow.close();
    void txFlow.start(
      shieldSpec({
        network: spec.network,
        signer: spec.signer,
        demo: spec.demo,
        assetMint: swapIntent.outputMint,
        symbol,
        decimals: swapIntent.outputDecimals,
        amount,
        token2022: outFacts.data?.program === "token2022",
        available: amount,
      }),
    );
  };

  return (
    <>
      <Dialog open={s.open} onClose={closeAll} labelledBy="tx-title" size="md" dismissible={!inFlight || true}>
        <div className={styles.wrap}>
          <div className={styles.head}>
            <div>
              {inSequence ? (
                <p className={styles.seqLabel}>
                  {seq.title}: step {seq.index + 1} of {seq.steps.length}
                </p>
              ) : null}
              <h2 id="tx-title">{spec.title}</h2>
              {spec.demo ? <span className="chip chip-warn" style={{ marginTop: 8 }}>Demo: nothing will be signed or sent</span> : null}
            </div>
            <button type="button" className="icon-btn" aria-label={inFlight ? "Hide; tracking continues" : "Close"} onClick={closeAll}>
              <Icon name="close" size={18} />
            </button>
          </div>

          <ol className={styles.steps} aria-label="Progress">
            {STEPS.map((label, i) => (
              <li key={label} className={styles.step} data-state={failed && i === Math.min(idx, 3) ? "error" : i < idx ? "done" : i === idx ? "current" : "todo"} aria-current={i === idx ? "step" : undefined}>
                {label}
              </li>
            ))}
          </ol>

          {s.phase === "quoting" ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center", color: "var(--text-2)", fontSize: "var(--fs-small)" }} role="status">
              <Spinner size={16} /> Preparing the exact transaction and checking it…
            </div>
          ) : null}

          {s.built && s.phase !== "completed" ? <ReviewRows rows={s.built.rows} /> : null}

          {s.phase === "completed" ? (
            <div style={{ display: "grid", gap: 12 }} role="status">
              <div className={styles.receiptHead}>
                <Icon name="check" size={18} /> {spec.demo ? "Simulated" : "Confirmed"}
              </div>
              {s.receipt ? <ReviewRows rows={s.receipt} /> : null}
              {s.signature ? <ExplorerLinks signature={s.signature} network={spec.network} /> : null}
            </div>
          ) : null}

          {s.built && s.phase !== "completed" ? (
            <section aria-label="Disclosure">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <span style={{ fontSize: "var(--fs-small)", fontWeight: 560 }}>{spec.disclosure.summary}</span>
                <button type="button" className="link" style={{ background: "none", border: 0, padding: 0, fontSize: "var(--fs-small)" }} onClick={() => setSheet(true)}>
                  What is visible
                </button>
              </div>
              <VisibilityGrid profile={spec.disclosure} />
            </section>
          ) : null}

          {s.inspection || s.simulation || s.violations.length > 0 ? (
            <div className={styles.checks} aria-label="Checks">
              {s.inspection ? (
                <div className={styles.check} data-ok={s.violations.length === 0}>
                  <Icon name={s.violations.length === 0 ? "check" : "warning"} size={16} />
                  <span>
                    {s.violations.length === 0 ? "Invokes only expected programs: " : "Blocked. "}
                    {s.violations.length === 0 ? s.inspection.programs.map(programLabel).join(", ") : s.violations.join(" ")}
                  </span>
                </div>
              ) : null}
              {s.simulation ? (
                <div className={styles.check} data-ok={s.simulation.ok}>
                  <Icon name={s.simulation.ok ? "check" : "warning"} size={16} />
                  <span>
                    {s.simulation.message}
                    {s.simulation.units ? ` ${s.simulation.units.toLocaleString("en-US")} compute units.` : ""}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {spec.downgradeNotice && s.built && !inFlight && s.phase !== "completed" ? (
            <label className={styles.consent}>
              <input type="checkbox" checked={s.downgradeAccepted} onChange={(e) => txFlow.setDowngradeAccepted(e.target.checked)} />
              <span>{spec.downgradeNotice} I accept this.</span>
            </label>
          ) : null}

          {s.error ? (
            <div className="note note-error" role="alert">
              <Icon name="warning" size={16} />
              <span>{s.error}</span>
            </div>
          ) : null}
          {s.phase === "completed" && nextStep && stopNote ? (
            <div className="note" role="note">
              <Icon name="info" size={16} />
              <span>If you stop here: {stopNote}</span>
            </div>
          ) : null}
          {s.note ? (
            <div className={`note ${s.phase === "pendingRecovery" ? "note-warn" : ""}`} role="status">
              <Icon name="info" size={16} />
              <span>{s.note}</span>
            </div>
          ) : null}

          <div className={styles.footer}>
          {remaining !== null && (s.phase === "awaitingApproval" || s.phase === "rejected") ? (
            <p className={styles.expiry} data-urgent={remaining <= 8} role="timer">
              {expired ? "These terms expired. Refresh to get current ones." : `Terms valid for ${remaining}s. Any change to amount, fee, route or recipient voids this approval.`}
            </p>
          ) : null}
          <div className={styles.actions}>
            {s.phase === "completed" && nextStep ? (
              <>
                <button type="button" className="btn" onClick={closeAll}>
                  Stop here
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void sequence.advance()}>
                  Continue: {nextStep.label}
                </button>
              </>
            ) : s.phase === "completed" && canShield ? (
              <>
                <button type="button" className="btn" onClick={closeAll}>
                  Done
                </button>
                <button type="button" className="btn btn-primary" onClick={shieldReceived}>
                  Move {formatAmount(BigInt(receivedText!), swapIntent!.outputDecimals)} to private balance
                </button>
              </>
            ) : s.phase === "completed" ? (
              <>
                {earnable ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      useHandoff.getState().set({ earnAsset: swappedInto });
                      txFlow.close();
                      router.push("/earn");
                    }}
                  >
                    Open Earn
                  </button>
                ) : null}
                <button type="button" className="btn btn-primary" onClick={closeAll}>
                  Done
                </button>
              </>
            ) : s.phase === "pendingRecovery" ? (
              <button type="button" className="btn" onClick={() => void txFlow.reconcile(10)}>
                Check the chain again
              </button>
            ) : failed && s.errorCode && spec.alternative?.(s.errorCode) ? (
              <>
                <button type="button" className="btn" onClick={() => txFlow.cancel()}>
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const alt = spec.alternative!(s.errorCode!)!;
                    txFlow.cancel(undefined, { silent: true });
                    void txFlow.start(alt.spec());
                  }}
                >
                  {spec.alternative(s.errorCode)!.label}
                </button>
              </>
            ) : failed || expired || s.phase === "staleQuote" ? (
              <>
                <button type="button" className="btn" onClick={() => txFlow.cancel()}>
                  Close
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void txFlow.refresh()}>
                  Get fresh terms
                </button>
              </>
            ) : inFlight ? (
              <button type="button" className="btn btn-primary" disabled data-busy="true">
                <Spinner size={16} /> {s.phase === "preparing" ? "Waiting for your wallet" : s.phase === "submitting" ? "Submitting" : "Confirming"}
              </button>
            ) : (
              <>
                <button type="button" className="btn" onClick={() => txFlow.cancel()}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" disabled={!can.ok || s.phase === "quoting"} onClick={() => void txFlow.approve()}>
                  {can.ok || s.phase === "quoting" ? (s.phase === "rejected" ? "Try signing again" : spec.primaryLabel) : (can.reason ?? spec.primaryLabel)}
                </button>
              </>
            )}
          </div>
          </div>
        </div>
      </Dialog>
      <DisclosureSheet profile={spec.disclosure} open={sheet} onClose={() => setSheet(false)} />
    </>
  );
}
