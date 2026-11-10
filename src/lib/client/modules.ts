import type { IconName } from "@/components/ui/Icon";

export type ModuleId = "swap" | "balance" | "send" | "earn" | "borrow" | "activity" | "settings";

export interface ModuleDef {
  id: ModuleId;
  label: string;
  /** Short label for the mobile bar. */
  short: string;
  href: string;
  icon: IconName;
}

/** Rail order is fixed by the product brief. */
export const MODULES: readonly ModuleDef[] = [
  { id: "swap", label: "Swap", short: "Swap", href: "/", icon: "swap" },
  { id: "balance", label: "Balance", short: "Balance", href: "/balance", icon: "balance" },
  { id: "send", label: "Send and receive", short: "Send", href: "/send", icon: "send" },
  { id: "earn", label: "Earn", short: "Earn", href: "/earn", icon: "earn" },
  { id: "borrow", label: "Borrow", short: "Borrow", href: "/borrow", icon: "borrow" },
  { id: "activity", label: "Activity", short: "Activity", href: "/activity", icon: "activity" },
  { id: "settings", label: "Settings and security", short: "Settings", href: "/settings", icon: "shield" },
];

export function moduleFromPath(pathname: string | null): ModuleId {
  const seg = (pathname ?? "/").split("/")[1] ?? "";
  const hit = MODULES.find((m) => m.href === `/${seg}`);
  return hit && seg ? hit.id : "swap";
}
