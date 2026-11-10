"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePrivate, useSettings, useWallet } from "@/lib/client/stores";

function InactivityLock() {
  const minutes = useSettings((s) => s.lockAfterMinutes);
  const status = usePrivate((s) => s.status);
  useEffect(() => {
    // 0 means "lock when this tab is hidden"; the visibility handler covers that case.
    if (status === "locked" || minutes <= 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => usePrivate.getState().lock("Locked after inactivity."), minutes * 60_000);
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [minutes, status]);
  return null;
}

function Hydrate() {
  useEffect(() => {
    void useSettings.persist.rehydrate();
    // Clear any decrypted state if the tab is being discarded.
    const onHide = () => {
      if (document.visibilityState === "hidden" && useSettings.getState().lockAfterMinutes === 0) usePrivate.getState().lock("Locked when the tab was hidden.");
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", () => usePrivate.getState().lock());
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: 1, structuralSharing: false },
        },
      }),
  );
  useEffect(() => {
    // Wallet epoch exists from first render; nothing to do on mount.
    void useWallet.getState();
  }, []);
  return (
    <QueryClientProvider client={client}>
      <Hydrate />
      <InactivityLock />
      {children}
    </QueryClientProvider>
  );
}
