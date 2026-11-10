import { useId } from "react";
import { moonArt } from "./moon-art";

/**
 * NOCT's mark: a realistic half moon (see moon-art.ts). The art is a fixed
 * string built in code; only the id prefix varies, so several marks can share
 * a page without their gradients and filters colliding.
 */
export function MoonMark({ size = 22, title }: { size?: number; title?: string }) {
  const prefix = `moon${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      style={{ overflow: "visible", flex: "none" }}
      dangerouslySetInnerHTML={{ __html: moonArt(prefix) }}
    />
  );
}
