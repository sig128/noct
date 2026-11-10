import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { moonArt, moonSvg } from "@/components/ui/moon-art";

describe("moon mark", () => {
  it("the favicon is the same art as the in-app mark", () => {
    // Regenerate with: node --input-type=module -e 'import { moonSvg } from "./src/components/ui/moon-art.ts"; import { writeFileSync } from "node:fs"; writeFileSync("src/app/icon.svg", moonSvg("m"));'
    expect(readFileSync("src/app/icon.svg", "utf8")).toBe(moonSvg("m"));
  });

  it("prefixes every id so two marks on one page do not collide", () => {
    const a = moonArt("a");
    const ids = [...a.matchAll(/id="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.every((id) => id.startsWith("a-"))).toBe(true);
    const refs = [...a.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]!);
    expect(refs.every((r) => ids.includes(r))).toBe(true);
  });
});
