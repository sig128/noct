"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { moduleFromPath } from "@/lib/client/modules";
import { useSettings } from "@/lib/client/stores";
import { TopBar } from "./TopBar";
import { RightActionRail } from "./RightActionRail";
import { MobileNav } from "./MobileNav";
import { SwapCard } from "@/components/swap/SwapCard";
import { ContextStrip } from "@/components/swap/ContextStrip";
import { WalletPicker } from "@/components/wallet/WalletPicker";
import { TxDialog } from "@/components/tx/TxDialog";
import { AmbientContext } from "./AmbientContext";
import styles from "./shell.module.css";

const panels = {
  balance: dynamic(() => import("@/components/panels/BalancePanel").then((m) => m.BalancePanel)),
  send: dynamic(() => import("@/components/panels/TransferPanel").then((m) => m.TransferPanel)),
  earn: dynamic(() => import("@/components/panels/EarnPanel").then((m) => m.EarnPanel)),
  borrow: dynamic(() => import("@/components/panels/BorrowPanel").then((m) => m.BorrowPanel)),
  activity: dynamic(() => import("@/components/panels/ActivityPanel").then((m) => m.ActivityPanel)),
  settings: dynamic(() => import("@/components/panels/SecuritySettings").then((m) => m.SecuritySettings)),
} as const;

export function AppShell() {
  const pathname = usePathname();
  const module = moduleFromPath(pathname);
  const demo = useSettings((s) => s.demoMode);
  const Panel = module === "swap" ? null : panels[module];
  return (
    <div className={styles.shell} data-module={module} data-demo={demo}>
      <a href="#swap-heading" className="vh">
        Skip to swap
      </a>
      <TopBar />
      <main className={styles.workspace}>
        <div className={styles.swapColumn}>
          <SwapCard headingLevel={module === "swap" ? 1 : 2} />
          <ContextStrip />
        </div>
        <div className={styles.contextColumn} data-module={module}>
          {Panel ? <Panel /> : <AmbientContext />}
        </div>
      </main>
      <RightActionRail active={module} />
      <MobileNav active={module} />
      <WalletPicker />
      <TxDialog />
    </div>
  );
}
