"use client";

import Link from "next/link";
import { MoonMark } from "@/components/ui/MoonMark";
import styles from "./landing.module.css";

/**
 * The landing page at "/". The ring itself is drawn by RingStage into the
 * slot below, so that "Launch app" can carry the same ring to its place in
 * the app.
 */
export function Landing({ leaving }: { leaving: boolean }) {
  return (
    <section className={styles.landing} data-leaving={leaving ? "true" : undefined} aria-labelledby="landing-title">
      <div className={styles.slot} data-ring-slot aria-hidden="true" />
      <div className={styles.copy}>
        <h1 id="landing-title" className={styles.mark}>
          <MoonMark size={64} />
          <span>noct</span>
        </h1>
        <p className={styles.lead}>Swap any Solana token. Hold and send from a private balance.</p>
        <Link href="/swap" className={`btn btn-primary ${styles.launch}`}>
          Launch app
        </Link>
        <p className={styles.note}>Solana mainnet. Private transfers hide the token and the amount; the addresses stay visible.</p>
      </div>
    </section>
  );
}
