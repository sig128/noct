"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { moduleFromPath } from "@/lib/client/modules";
import { TopBar } from "./TopBar";
import { RightActionRail } from "./RightActionRail";
import { MobileNav } from "./MobileNav";
import { SwapCard } from "@/components/swap/SwapCard";
import { ContextStrip } from "@/components/swap/ContextStrip";
import { WalletPicker } from "@/components/wallet/WalletPicker";
import { TxDialog } from "@/components/tx/TxDialog";
import { AmbientContext } from "./AmbientContext";
import { Landing } from "./Landing";
import { RingStage, type Stage } from "./RingStage";
import styles from "./shell.module.css";

const panels = {
  balance: dynamic(() => import("@/components/panels/BalancePanel").then((m) => m.BalancePanel)),
  send: dynamic(() => import("@/components/panels/TransferPanel").then((m) => m.TransferPanel)),
  earn: dynamic(() => import("@/components/panels/EarnPanel").then((m) => m.EarnPanel)),
  borrow: dynamic(() => import("@/components/panels/BorrowPanel").then((m) => m.BorrowPanel)),
  activity: dynamic(() => import("@/components/panels/ActivityPanel").then((m) => m.ActivityPanel)),
  settings: dynamic(() => import("@/components/panels/SecuritySettings").then((m) => m.SecuritySettings)),
} as const;

/** How long the ring takes to glide from the landing page to its place in the app. */
const LAUNCH_MS = 1150;

export function AppShell() {
  const pathname = usePathname();
  const atLanding = pathname === "/";
  const module = moduleFromPath(pathname);
  const [stage, setStage] = useState<Stage>(atLanding ? "landing" : "app");

  // "/" is the landing page; any app route launches (or stays in) the app.
  useEffect(() => {
    if (atLanding) setStage("landing");
    else setStage((s) => (s === "landing" ? "launching" : s));
  }, [atLanding]);

  useEffect(() => {
    if (stage !== "launching") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => {
      setStage("app");
      document.getElementById("swap-heading")?.focus({ preventScroll: true });
    }, reduce ? 0 : LAUNCH_MS);
    return () => clearTimeout(t);
  }, [stage]);

  const Panel = module === "swap" ? null : panels[module];
  const hidden = stage === "landing";
  return (
    <div className={styles.shell} data-module={module} data-stage={stage}>
      <RingStage stage={stage} showInApp={module === "swap"} />
      <div className={styles.app} data-stage={stage} inert={hidden} aria-hidden={hidden ? true : undefined}>
        <a href="#swap-heading" className="vh">
          Skip to swap
        </a>
        <TopBar />
        <main className={styles.workspace}>
          <div className={styles.swapColumn} data-ring-center>
            <SwapCard headingLevel={module === "swap" ? 1 : 2} />
            <ContextStrip />
          </div>
          <div className={styles.contextColumn} data-module={module}>
            {Panel ? <Panel /> : <AmbientContext />}
          </div>
        </main>
        <RightActionRail active={module} />
        <MobileNav active={module} />
      </div>
      {stage !== "app" ? <Landing leaving={stage === "launching"} /> : null}
      <WalletPicker />
      <TxDialog />
    </div>
  );
}
