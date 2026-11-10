import type { Metadata, Viewport } from "next";
import "@fontsource-variable/mona-sans/standard.css";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { AppShell } from "@/components/shell/AppShell";

export const metadata: Metadata = {
  title: { default: "Swap | noct", template: "%s | noct" },
  description: "Swap Solana tokens, hold a private balance and see what every operation reveals before you sign.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080a0c",
  colorScheme: "dark",
};

/**
 * The shell lives in the root layout so the swap card stays mounted while
 * tools open and close: an unfinished swap survives navigation.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppShell />
          {children}
        </Providers>
      </body>
    </html>
  );
}
