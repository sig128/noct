import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MODULES } from "@/lib/client/modules";

const IDS = MODULES.filter((m) => m.id !== "swap").map((m) => m.href.slice(1));

export function generateStaticParams() {
  return IDS.map((module) => ({ module }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }): Promise<Metadata> {
  const { module } = await params;
  const def = MODULES.find((m) => m.href === `/${module}`);
  return { title: def?.label ?? "Not found" };
}

/** Deep link to a tool. The URL names the tool only, never amounts, addresses or terms. */
export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  if (!IDS.includes(module)) notFound();
  return null;
}
