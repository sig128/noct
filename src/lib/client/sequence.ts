"use client";

import { create } from "zustand";
import { txFlow, useTxFlow, type TxSpec } from "./tx-flow";

/**
 * A guided series of separately reviewed transactions, such as paying from
 * the private balance: move out, swap, move back in. Each step is a normal
 * TxSpec with its own review, checks and wallet signature. Nothing is chained
 * automatically: the next step starts only when the user continues after the
 * previous one confirmed, and it is built from that step's settled amounts.
 */

export interface SequenceStep {
  /** Short label for the step ("Swap USDC for BONK"). */
  label: string;
  /** Builds the step from amounts settled by earlier steps. Throws if it cannot. */
  spec(outputs: Readonly<Record<string, string>>): TxSpec;
}

export interface SequenceState {
  title: string | null;
  steps: SequenceStep[];
  /** Index of the step currently in the dialog. */
  index: number;
  /** Settled amounts collected from finished steps. */
  outputs: Record<string, string>;
  /** Where funds sit if the user stops now, for the stop note. */
  stopNotes: string[];
}

const empty: SequenceState = { title: null, steps: [], index: 0, outputs: {}, stopNotes: [] };

export const useSequence = create<SequenceState>()(() => ({ ...empty }));

export const sequence = {
  async start(title: string, steps: SequenceStep[], stopNotes: string[] = []): Promise<void> {
    if (steps.length === 0) return;
    useSequence.setState({ title, steps, index: 0, outputs: {}, stopNotes });
    await txFlow.start(steps[0]!.spec({}));
  },

  /** The step after the current one, if any. */
  next(): SequenceStep | null {
    const s = useSequence.getState();
    return s.title ? (s.steps[s.index + 1] ?? null) : null;
  },

  /** Where the user's funds are if they stop after the current step. */
  stopNote(): string | null {
    const s = useSequence.getState();
    return s.title ? (s.stopNotes[s.index] ?? null) : null;
  },

  /** Starts the next step. Only valid once the current step has completed. */
  async advance(): Promise<void> {
    const s = useSequence.getState();
    const flow = useTxFlow.getState();
    if (!s.title || flow.phase !== "completed") return;
    const nextStep = s.steps[s.index + 1];
    if (!nextStep) {
      sequence.stop();
      return;
    }
    const outputs = { ...s.outputs, ...(flow.outputs ?? {}) };
    let spec: TxSpec;
    try {
      spec = nextStep.spec(outputs);
    } catch (error) {
      useTxFlow.setState({ error: (error as Error).message });
      return;
    }
    useSequence.setState({ index: s.index + 1, outputs });
    txFlow.close();
    await txFlow.start(spec);
  },

  stop(): void {
    useSequence.setState({ ...empty });
  },
};
