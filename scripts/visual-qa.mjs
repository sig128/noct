#!/usr/bin/env node
/**
 * Renders the landing page and the key app screens at 1440, 1280, 768 and
 * 390 px (and the ring's transaction states) and saves screenshots
 * to qa-output/. Run against a server backed by scripts/fixture-upstream.mjs.
 *   QA_BASE=http://127.0.0.1:3100 node scripts/visual-qa.mjs [filter]
 */
import { mkdir } from "node:fs/promises";
import { APP, BASE, VIEWPORTS, launch, settle, settingsInitScript, testWallet, walletInitScript } from "./qa-lib.mjs";

const OUT = process.env.QA_OUT ?? "qa-output";
const filter = process.argv[2] ?? "";
await mkdir(OUT, { recursive: true });
const browser = await launch();
const wallet = await testWallet();
const results = [];

async function shot(name, vpKey, fn, opts = {}) {
  const tag = `${name}-${vpKey}`;
  if (filter && !tag.includes(filter)) return;
  const ctx = await browser.newContext({ ...VIEWPORTS[vpKey], reducedMotion: opts.reducedMotion ? "reduce" : "no-preference" });
  if (opts.settings) await ctx.addInitScript(settingsInitScript(opts.settings));
  if (opts.wallet !== false) await ctx.addInitScript(walletInitScript({ ...wallet, ...(opts.walletOpts ?? {}) }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  try {
    await fn(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `${OUT}/${tag}.png`, fullPage: opts.fullPage ?? false });
    results.push({ tag, overflow, errors: errors.filter((e) => !/favicon|Failed to load resource/.test(e)) });
  } catch (error) {
    results.push({ tag, failed: String(error), errors });
    await page.screenshot({ path: `${OUT}/${tag}-FAILED.png` }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

const typeAmount = async (page, value) => {
  const input = page.locator("input[data-amount-input]").first();
  await input.click();
  await input.fill(value);
  await page.waitForTimeout(900);
};

const connect = async (page) => {
  const btn = page.getByRole("button", { name: /Connect wallet/ }).first();
  await btn.click();
  await page.getByRole("button", { name: /QA Test Wallet/ }).click();
  await page.waitForTimeout(500);
};

for (const vp of Object.keys(VIEWPORTS)) {
  await shot("landing", vp, async (page) => {
    await page.goto(BASE);
    await settle(page, 1800);
  });
  await shot("home", vp, async (page) => {
    await page.goto(APP);
    await settle(page, 900);
  });
  await shot("quote", vp, async (page) => {
    await page.goto(APP);
    await settle(page, 600);
    await typeAmount(page, "1.25");
    await settle(page, 600);
  });
}

await shot("quote-details", "1440", async (page) => {
  await page.goto(APP);
  await settle(page, 600);
  await typeAmount(page, "1.25");
  await page.getByRole("button", { name: /Costs and route/ }).click();
  await settle(page, 300);
});

await shot("picker-bonk", "1440", async (page) => {
  await page.goto(APP);
  await settle(page, 600);
  await page.getByRole("button", { name: /You receive: USDC/ }).click();
  await page.locator("input[type=search]").fill("bonk");
  await settle(page, 900);
});

await shot("picker-bonk", "390", async (page) => {
  await page.goto(APP);
  await settle(page, 600);
  await page.getByRole("button", { name: /You receive: USDC/ }).click();
  await page.locator("input[type=search]").fill("bonk");
  await settle(page, 900);
});

await shot("connected-quote", "1440", async (page) => {
  await page.goto(APP);
  await settle(page, 600);
  await connect(page);
  await typeAmount(page, "1.25");
  await settle(page, 500);
});

await shot("review", "1440", async (page) => {
  await page.goto(APP);
  await settle(page, 600);
  await connect(page);
  await typeAmount(page, "1.25");
  await page.getByRole("button", { name: "Review swap" }).click();
  await page.getByRole("button", { name: "Sign and swap" }).waitFor({ timeout: 8000 });
  await settle(page, 300);
});

await shot("receipt", "1440", async (page) => {
  await page.goto(APP);
  await settle(page, 600);
  await connect(page);
  await typeAmount(page, "1.25");
  await page.getByRole("button", { name: "Review swap" }).click();
  await page.getByRole("button", { name: "Sign and swap" }).click({ timeout: 8000 });
  await page.getByText("Confirmed").waitFor({ timeout: 10000 });
  await settle(page, 300);
});

await shot("preview-earn", "1440", async (page) => {
  await page.goto(APP);
  await settle(page, 700);
  await page.locator('[data-rail="earn"]').hover();
  await settle(page, 700);
});

await shot("preview-balance", "1280", async (page) => {
  await page.goto(APP);
  await settle(page, 700);
  await page.locator('[data-rail="balance"]').hover();
  await settle(page, 500);
});

for (const vp of ["1440", "390"]) {
  for (const mod of ["balance", "earn", "borrow", "send", "activity", "settings"]) {
    await shot(`module-${mod}`, vp, async (page) => {
      await page.goto(`${BASE}/${mod}`);
      await settle(page, 700);
      if (mod === "balance" || mod === "send" || mod === "borrow") {
        await connect(page).catch(() => {});
        await settle(page, 700);
      }
      if (mod === "earn") {
        await page.locator("button[aria-pressed]", { hasText: "USDC" }).first().click();
        await settle(page, 500);
      }
    }, { fullPage: vp === "390" });
  }
}

await shot("module-balance-768", "768", async (page) => {
  await page.goto(`${BASE}/balance`);
  await settle(page, 700);
  await connect(page).catch(() => {});
  await settle(page, 600);
});

// The ring while a swap is on its way, and as it lands.
await shot("ring-sending", "1440", async (page) => {
  await page.goto(APP);
  await settle(page, 900);
  await connect(page);
  await typeAmount(page, "1.25");
  await page.getByRole("button", { name: "Review swap" }).click();
  await page.getByRole("button", { name: "Sign and swap" }).click({ timeout: 8000 });
  await page.waitForTimeout(500);
}, { walletOpts: { delayMs: 1500 } });

await shot("ring-landed", "1440", async (page) => {
  await page.goto(APP);
  await settle(page, 900);
  await connect(page);
  await typeAmount(page, "1.25");
  await page.getByRole("button", { name: "Review swap" }).click();
  await page.getByRole("button", { name: "Sign and swap" }).click({ timeout: 8000 });
  await page.getByText("Confirmed").waitFor({ timeout: 10000 });
  await page.waitForTimeout(450);
});

await shot("ring-landed", "390", async (page) => {
  await page.goto(APP);
  await settle(page, 900);
  await connect(page);
  await typeAmount(page, "1.25");
  await page.getByRole("button", { name: "Review swap" }).click();
  await page.getByRole("button", { name: "Sign and swap" }).click({ timeout: 8000 });
  await page.getByText("Confirmed").waitFor({ timeout: 10000 });
  await page.waitForTimeout(450);
});

await shot("masked", "1440", async (page) => {
  await page.goto(`${BASE}/balance`);
  await settle(page, 600);
  await connect(page);
  await settle(page, 800);
}, { settings: { maskBalances: true } });

await shot("reduced-motion", "1440", async (page) => {
  await page.goto(APP);
  await settle(page, 900);
}, { reducedMotion: true });

await browser.close();
console.log(JSON.stringify(results, null, 2));
const bad = results.filter((r) => r.failed || r.overflow > 0 || r.errors.length > 0);
if (bad.length) {
  console.error(`\n${bad.length} screen(s) need attention`);
  process.exitCode = 1;
}
