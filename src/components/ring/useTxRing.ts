"use client";

import { useEffect, useState } from "react";
import { useTxFlow } from "@/lib/client/tx-flow";
import type { Phase } from "@/lib/operations/state-machine";
import type { RingMode, RingTone } from "./RingArt";

const ON_ITS_WAY: readonly Phase[] = ["submitting", "confirming", "pendingRecovery"];
const FLARE_MS: Partial<Record<RingMode, number>> = { landed: 2600, failed: 1400 };

/** The ring's state for an operation in a given phase (the dialog shows this directly). */
export function ringModeFor(phase: Phase): RingMode {
  if (phase === "preparing") return "waiting";
  if (ON_ITS_WAY.includes(phase)) return "moving";
  if (phase === "completed") return "landed";
  if (phase === "retryableFailure" || phase === "rejected") return "failed";
  return "idle";
}

export function ringToneFor(kind: string | null | undefined): RingTone | null {
  if (!kind) return null;
  return kind.startsWith("private") ? "private" : "public";
}

interface Track {
  phase: Phase;
  /** Tone of the latest operation, kept after its dialog closes. */
  lastTone: RingTone | null;
  /** A one-off flare after an operation settles. */
  flare: RingMode | null;
  flareTone: RingTone | null;
  flareId: number;
}

/**
 * The background ring follows the operation in flight: it speeds up while the
 * transaction is on its way, flares once when it lands (or turns coral briefly
 * when it fails), then settles back to idle even if the dialog stays open.
 */
export function useTxRing(): { mode: RingMode; tone: RingTone | null } {
  const phase = useTxFlow((s) => s.phase);
  const tone = ringToneFor(useTxFlow((s) => s.spec?.kind ?? null));
  const [track, setTrack] = useState<Track>({ phase, lastTone: tone, flare: null, flareTone: null, flareId: 0 });

  // Derived during render, so the flare starts in the same frame as the outcome.
  let current = track;
  if (track.phase !== phase || (tone !== null && tone !== track.lastTone)) {
    const wasActive = track.phase === "preparing" || ON_ITS_WAY.includes(track.phase);
    const outcome: RingMode | null =
      track.phase !== phase && wasActive ? (phase === "completed" ? "landed" : phase === "retryableFailure" || phase === "rejected" ? "failed" : null) : null;
    const lastTone = tone ?? track.lastTone;
    current = {
      phase,
      lastTone,
      flare: outcome ?? track.flare,
      flareTone: outcome ? lastTone : track.flareTone,
      flareId: outcome ? track.flareId + 1 : track.flareId,
    };
    setTrack(current);
  }

  const { flare, flareId } = current;
  useEffect(() => {
    if (!flare) return;
    const t = setTimeout(() => setTrack((s) => (s.flareId === flareId ? { ...s, flare: null } : s)), FLARE_MS[flare] ?? 1500);
    return () => clearTimeout(t);
  }, [flare, flareId]);

  if (current.flare) return { mode: current.flare, tone: current.flareTone };
  const live = ringModeFor(phase);
  return { mode: live === "landed" || live === "failed" ? "idle" : live, tone };
}
