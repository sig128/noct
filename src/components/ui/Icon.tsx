import type { SVGProps } from "react";

/** One icon family: 24px grid, 1.6px round strokes, no fills except dots. */
const PATHS = {
  swap: <path d="M4 8.5h14l-3.6-3.6M20 15.5H6l3.6 3.6" />,
  balance: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="3.2" />
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 5v2.2M12 16.8V19M7.2 12H5.5M18.5 12h-1.7" />
    </>
  ),
  send: <path d="M13.5 4.5h6v6M19.5 4.5l-7.5 7.5M10.5 19.5h-6v-6M4.5 19.5l7.5-7.5" />,
  earn: <path d="M3.5 17.5l5.2-5.2 3.6 3 8.2-8.3M15 7h5.5v5.5" />,
  borrow: (
    <>
      <path d="M12 4v15.5M7.5 19.5h9M5 7.5h14" />
      <path d="M5 7.5l-2.6 5.6a2.9 2.9 0 0 0 5.2 0L5 7.5zM19 7.5l-2.6 5.6a2.9 2.9 0 0 0 5.2 0L19 7.5z" />
    </>
  ),
  activity: <path d="M3.5 12h3.6l2.4-6 5 12 2.4-6h3.6" />,
  shield: (
    <>
      <path d="M12 3.2l7 2.9v5.2c0 4.6-2.9 8.1-7 9.5-4.1-1.4-7-4.9-7-9.5V6.1l7-2.9z" />
      <circle cx="12" cy="10.8" r="1.7" />
      <path d="M12 12.5v3" />
    </>
  ),
  chevronDown: <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />,
  chevronRight: <path d="M9.5 6.5l5.5 5.5-5.5 5.5" />,
  chevronLeft: <path d="M14.5 6.5L9 12l5.5 5.5" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="M5 12.5l4.4 4.4L19 7.4" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.6" />
      <path d="M15 9V6.6A2.6 2.6 0 0 0 12.4 4H6.6A2.6 2.6 0 0 0 4 6.6v5.8A2.6 2.6 0 0 0 6.6 15H9" />
    </>
  ),
  external: <path d="M13.5 4.5h6v6M19.5 4.5l-8.5 8.5M18 14v3.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H10" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.9" r="0.6" fill="currentColor" />
    </>
  ),
  warning: (
    <>
      <path d="M10.4 4.6L3 17.5A1.8 1.8 0 0 0 4.6 20h14.8a1.8 1.8 0 0 0 1.6-2.5L13.6 4.6a1.8 1.8 0 0 0-3.2 0z" />
      <path d="M12 9.5v4" />
      <circle cx="12" cy="16.6" r="0.6" fill="currentColor" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.6" />
      <path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.6" />
      <path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.3-1.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12s3.4-6.3 9.2-6.3S21.2 12 21.2 12s-3.4 6.3-9.2 6.3S2.8 12 2.8 12z" />
      <circle cx="12" cy="12" r="2.7" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 4l16 16M9.9 6A9.6 9.6 0 0 1 12 5.7c5.8 0 9.2 6.3 9.2 6.3a17 17 0 0 1-2.9 3.6M6.4 7.7A16 16 0 0 0 2.8 12s3.4 6.3 9.2 6.3a9 9 0 0 0 3.9-.9" />
      <path d="M9.9 10a2.7 2.7 0 0 0 3.9 3.8" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M15.6 15.6l4.4 4.4" />
    </>
  ),
  refresh: <path d="M19.5 11.2A7.6 7.6 0 1 0 17.4 17M19.5 5v6.2h-6.2" />,
  reverse: <path d="M8 4.5v15M8 4.5L4.6 7.9M8 4.5l3.4 3.4M16 19.5v-15M16 19.5l-3.4-3.4M16 19.5l3.4-3.4" />,
  wallet: (
    <>
      <rect x="3.5" y="6" width="17" height="13" rx="3" />
      <path d="M3.5 9.5H17a3.5 3.5 0 0 1 3.5 3.5M15.8 13.6h1.6" />
      <path d="M6.5 6l8.6-2.3a1.6 1.6 0 0 1 2 1.5V6" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  sliders: (
    <>
      <path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9" />
      <circle cx="15" cy="7.5" r="2" />
      <circle cx="9" cy="16.5" r="2" />
    </>
  ),
  rosette: (
    <>
      <circle cx="12" cy="8.2" r="3.8" />
      <circle cx="15.3" cy="13.9" r="3.8" />
      <circle cx="8.7" cy="13.9" r="3.8" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M3.6 12h16.8M12 3.4c2.4 2.3 3.6 5.2 3.6 8.6s-1.2 6.3-3.6 8.6c-2.4-2.3-3.6-5.2-3.6-8.6S9.6 5.7 12 3.4z" />
    </>
  ),
  arrowDown: <path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" />,
  download: <path d="M12 4.5v10.5M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="spin">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
      <path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <style>{`.spin{animation:spin .9s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.spin{transform-origin:center}`}</style>
    </svg>
  );
}
