/**
 * Browser checks for NOCT wallets (test infrastructure only): adding wallets
 * with a real Ed25519 message signature, the panel at desktop and phone
 * widths, and a buy from three wallets against the fixture upstream.
 * Run against a production build backed by the fixtures (see README).
 */
import { mkdirSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { getAddressDecoder } from "@solana/kit";
import { APP, launch, settingsInitScript, settle, VIEWPORTS, walletInitScript } from "./qa-lib.mjs";

const OUT = process.env.QA_OUT ?? "qa-shots";
mkdirSync(OUT, { recursive: true });

const secret = ed25519.utils.randomSecretKey();
const publicKey = ed25519.getPublicKey(secret);
const address = getAddressDecoder().decode(publicKey);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

const browser = await launch();
try {
  for (const [width, options] of [["1440", VIEWPORTS["1440"]], ["390", VIEWPORTS["390"]]]) {
    const context = await browser.newContext(options);
    await context.exposeFunction("__qaSignMessage", (bytes) => Array.from(ed25519.sign(Uint8Array.from(bytes), secret)));
    await context.addInitScript(walletInitScript({ address, publicKey: Array.from(publicKey), realMessages: true }));
    await context.addInitScript(settingsInitScript({}));
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(APP);
    await settle(page);
    await page.getByRole("button", { name: /Connect wallet/ }).first().click();
    await page.getByRole("button", { name: /QA Test Wallet/ }).click();
    await settle(page, 600);

    await page.getByRole("button", { name: "Add wallet" }).first().click();
    await page.getByRole("heading", { name: /Wallets/ }).waitFor({ timeout: 8000 });
    for (let i = 0; i < 2; i += 1) {
      await page.locator("section[aria-labelledby='wallets-heading']").getByRole("button", { name: "Add wallet" }).click();
      await page.waitForTimeout(150);
    }
    const names = await page.locator("section[aria-labelledby='wallets-heading'] li").allInnerTexts();
    check(`${width}: three wallets added`, names.length === 3, `${names.length} rows`);
    const copyLabels = await page.locator("section[aria-labelledby='wallets-heading'] button[aria-label^='Copy wallet']").count();
    check(`${width}: each wallet has a copy button`, copyLabels === 3);
    check(`${width}: the panel says it is not anonymous yet`, await page.getByText(/Not anonymous yet/).isVisible());

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${width}: no horizontal overflow`, overflow <= 0, `${overflow}px`);
    await page.locator("section[aria-labelledby='wallets-heading']").screenshot({ path: `${OUT}/wallets-${width}.png` });

    if (width === "1440") {
      // Pick a token to buy: the receive side defaults to a token in the fixtures.
      const buy = page.getByRole("button", { name: /^Buy .+ with 3 wallets$/ });
      if (await buy.isEnabled()) {
        await buy.click();
        await page.waitForFunction(() => document.querySelectorAll("section[aria-labelledby='wallets-heading'] p[data-phase='done'], section[aria-labelledby='wallets-heading'] p[data-phase='failed']").length >= 3, null, { timeout: 30000 }).catch(() => {});
        const runs = await page.locator("section[aria-labelledby='wallets-heading'] p[data-phase]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-phase")}: ${e.textContent}`));
        check("1440: all three wallets report a result", runs.length === 3, runs.join(" | "));
        await page.locator("section[aria-labelledby='wallets-heading']").screenshot({ path: `${OUT}/wallets-after-buy.png` });
      } else {
        check("1440: buy button enabled with a token selected", false, await buy.innerText());
      }
      await page.getByRole("button", { name: "Close wallets in this tab" }).click();
      check("1440: closing forgets the wallets", (await page.locator("section[aria-labelledby='wallets-heading']").count()) === 0);
    }
    check(`${width}: no console errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
    await context.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} wallet checks passed`);
process.exit(failed ? 1 : 0);
