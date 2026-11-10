/**
 * NOCT's mark: a half moon. The lit half is the accent; the dark half is a
 * faint outline, so the full disc reads at small sizes.
 */
export function MoonMark({ size = 22, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title} focusable="false">
      <circle cx="16" cy="16" r="12.25" fill="none" stroke="var(--accent)" strokeOpacity="0.38" strokeWidth="1.5" />
      <path d="M16 3.75a12.25 12.25 0 0 1 0 24.5Z" fill="var(--accent)" />
    </svg>
  );
}
