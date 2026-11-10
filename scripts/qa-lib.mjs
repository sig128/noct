/** Shared helpers for the browser QA scripts (test infrastructure only). */
import { chromium } from "playwright-core";
import { generateKeyPair, getAddressFromPublicKey } from "@solana/kit";

export const BASE = process.env.QA_BASE ?? "http://127.0.0.1:3100";
export const CHROME = process.env.QA_CHROME ?? "/usr/bin/google-chrome";

export const VIEWPORTS = {
  "1440": { viewport: { width: 1440, height: 900 } },
  "1280": { viewport: { width: 1280, height: 800 } },
  "768": { viewport: { width: 768, height: 1024 }, hasTouch: true },
  "390": { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

export async function testWallet() {
  const kp = await generateKeyPair();
  const addr = await getAddressFromPublicKey(kp.publicKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { address: addr, publicKey: Array.from(raw) };
}

/**
 * Registers a Wallet Standard wallet in the page. It "signs" by filling the
 * fee payer's signature slot with a fixed pattern; the fixture upstream
 * accepts it. It can never produce a valid signature for a real network.
 */
export function walletInitScript({ address, publicKey, supportsV1 = false, rejectSign = false, delayMs = 0 }) {
  return `(() => {
    const account = Object.freeze({ address: ${JSON.stringify(address)}, publicKey: new Uint8Array(${JSON.stringify(publicKey)}), chains: ["solana:mainnet", "solana:devnet"], features: ["solana:signTransaction", "solana:signMessage"] });
    const listeners = new Set();
    const fakeSign = (bytes) => { const out = new Uint8Array(bytes); for (let i = 1; i <= 64; i++) out[i] = 0x5a; return out; };
    const wallet = {
      version: "1.0.0",
      name: "QA Test Wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAzMiAzMic+PHJlY3Qgd2lkdGg9JzMyJyBoZWlnaHQ9JzMyJyByeD0nOCcgZmlsbD0nIzJhMzEzNScvPjxjaXJjbGUgY3g9JzE2JyBjeT0nMTYnIHI9JzYnIGZpbGw9JyNkOGY5OGEnLz48L3N2Zz4=",
      chains: ["solana:mainnet", "solana:devnet"],
      get accounts() { return window.__qaConnected ? [account] : []; },
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => { window.__qaConnected = true; return { accounts: [account] }; } },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => { window.__qaConnected = false; } },
        "standard:events": { version: "1.0.0", on: (e, l) => { listeners.add(l); return () => listeners.delete(l); } },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ${supportsV1 ? '["legacy", 0, 1]' : '["legacy", 0]'}, signTransaction: async (...inputs) => { window.__qaSignCalls = (window.__qaSignCalls || 0) + 1; if (${delayMs}) await new Promise((r) => setTimeout(r, ${delayMs})); if (${rejectSign ? "true" : "false"}) { const e = new Error("User rejected the request."); e.code = 4001; throw e; } window.__qaSigned = (window.__qaSigned || 0) + inputs.length; return inputs.map((i) => ({ signedTransaction: fakeSign(i.transaction) })); } },
        "solana:signMessage": { version: "1.0.0", signMessage: async (...inputs) => inputs.map((i) => ({ signedMessage: i.message, signature: new Uint8Array(64).fill(7) })) },
      },
    };
    const callback = ({ register }) => register(wallet);
    class RegisterWalletEvent extends Event { constructor(cb) { super("wallet-standard:register-wallet", { bubbles: false, cancelable: false, composed: false }); this.detail = cb; } }
    try { window.dispatchEvent(new RegisterWalletEvent(callback)); } catch (e) { console.error(e); }
    window.addEventListener("wallet-standard:app-ready", ({ detail }) => callback(detail));
  })();`;
}

export function settingsInitScript(settings) {
  return `try { localStorage.setItem("noct.settings.v1", ${JSON.stringify(JSON.stringify({ state: settings, version: 1 }))}); } catch (e) {}`;
}

export async function launch() {
  return chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"] });
}

export async function settle(page, ms = 400) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}
