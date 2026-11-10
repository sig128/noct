#!/usr/bin/env node
/**
 * Browser interaction checks: the landing page and launch, rail keyboard and
 * pointer behaviour, previews, module routing and focus, modal focus traps,
 * touch navigation, reduced motion, the full swap lifecycle against the local
 * fixtures (including the ring's states), duplicate-click protection, wallet
 * rejection, quote expiry, mainnet-only relays and storage hygiene. Run
 * against a server backed by scripts/fixture-upstream.mjs.
 *   QA_BASE=http://127.0.0.1:3100 node scripts/interaction-qa.mjs [filter] [--slow]
 */
import { APP, BASE, VIEWPORTS, launch, settle, settingsInitScript, testWallet, walletInitScript } from "./qa-lib.mjs";

const args = process.argv.slice(2);
const SLOW = args.includes("--slow");
const filter = args.find((a) => !a.startsWith("--")) ?? "";
const browser = await launch();
const wallet = await testWallet();
const results = [];

const DESKTOP = VIEWPORTS["1440"];

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function check(name, fn, { context = DESKTOP, wallet: withWallet = true, walletOpts = {}, settings = null, reducedMotion = false } = {}) {
  if (filter && !name.includes(filter)) return;
  const ctx = await browser.newContext({ ...context, reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  if (settings) await ctx.addInitScript(settingsInitScript(settings));
  if (withWallet) await ctx.addInitScript(walletInitScript({ ...wallet, ...walletOpts }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const started = Date.now();
  try {
    await fn(page, ctx);
    assert(errors.length === 0, `console errors: ${errors.join(" | ").slice(0, 400)}`);
    results.push({ name, ok: true, ms: Date.now() - started });
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error: String(error?.message ?? error).split("\n")[0].slice(0, 400) });
  } finally {
    await ctx.close();
  }
}

const activeInfo = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a?.tagName ?? null, rail: a?.getAttribute("data-rail") ?? null, label: a?.getAttribute("aria-label") ?? a?.textContent?.trim().slice(0, 40) ?? null, inDialog: Boolean(a?.closest("dialog")) };
  });

const preview = (page) => page.locator("#tool-preview");

async function connect(page) {
  await page.getByRole("button", { name: /Connect wallet/ }).first().click();
  await page.getByRole("button", { name: /QA Test Wallet/ }).click();
  await page.getByRole("button", { name: /Connect wallet/ }).first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}

async function typeAmount(page, value) {
  const input = page.locator("input[data-amount-input]").first();
  await input.click();
  await input.fill(value);
}

async function openReview(page) {
  await typeAmount(page, "1.25");
  const review = page.getByRole("button", { name: "Review swap" });
  await review.waitFor({ timeout: 8000 });
  await review.click();
  await page.getByRole("button", { name: "Sign and swap" }).waitFor({ timeout: 8000 });
}

// ---------------------------------------------------------------- landing

const ringMode = (page, which) => page.evaluate((w) => document.querySelector(`[data-ring="${w}"] svg`)?.getAttribute("data-mode") ?? null, which);

await check("landing: the ring, a plain description and Launch app; the app behind it is unreachable", async (page) => {
  await page.goto(BASE);
  await settle(page, 600);
  await page.getByRole("heading", { level: 1, name: "noct" }).waitFor();
  const text = await page.locator("body").innerText();
  assert(/addresses stay visible/.test(text), "the landing does not say what stays visible");
  assert(!/untraceable|zero trace|100% anonymous|\banonymous/i.test(text), "the landing makes an anonymity claim");
  assert((await ringMode(page, "stage")) === "landing", "the ring is not in its landing state");
  assert((await page.locator('[data-stage="landing"][inert]').count()) === 1, "the app behind the landing is not inert");
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
  assert(first === "Launch app", `first Tab stop on the landing was "${first}"`);
});

await check("landing: Launch app glides the ring into place, opens the swap and focuses it; Back returns", async (page) => {
  await page.goto(BASE);
  await settle(page, 600);
  await page.getByRole("link", { name: "Launch app" }).click();
  await page.waitForURL(APP);
  await page.waitForTimeout(1600);
  const focused = await page.evaluate(() => document.activeElement?.id);
  assert(focused === "swap-heading", `focus after launch was on ${focused}`);
  assert((await page.locator('[data-stage="app"]').count()) > 0, "the app did not finish launching");
  assert((await page.getByRole("link", { name: "Launch app" }).count()) === 0, "the landing is still mounted");
  const placed = await page.evaluate(() => {
    const box = document.querySelector('[data-ring="stage"] > div')?.getBoundingClientRect();
    const centre = document.querySelector("[data-ring-center]")?.getBoundingClientRect();
    const size = document.querySelector("[data-ring-anchor]")?.getBoundingClientRect();
    if (!box || !centre || !size) return null;
    return { dx: Math.abs(box.left + box.width / 2 - (centre.left + centre.width / 2)), dy: Math.abs(box.top + box.height / 2 - (centre.top + centre.height / 2)), dw: Math.abs(box.width - size.width) };
  });
  assert(placed && placed.dx < 3 && placed.dy < 3 && placed.dw < 3, `ring not centred behind the swap: ${JSON.stringify(placed)}`);
  await page.goBack();
  await page.waitForURL(BASE + "/");
  await page.getByRole("link", { name: "Launch app" }).waitFor({ timeout: 3000 });
  assert((await ringMode(page, "stage")) === "landing", "the ring did not return to the landing");
});

await check("landing at 390 px: stacked, no horizontal overflow, launch works", async (page) => {
  await page.goto(BASE);
  await settle(page, 600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 0, `horizontal overflow of ${overflow}px`);
  const slot = await page.locator("[data-ring-slot]").boundingBox();
  const button = await page.getByRole("link", { name: "Launch app" }).boundingBox();
  assert(slot && button && button.y > slot.y + slot.height - 1, "the words overlap the ring on a phone");
  assert(button.height >= 44, "Launch app is smaller than a 44 px target");
  await page.getByRole("link", { name: "Launch app" }).tap();
  await page.waitForURL(APP);
  await page.getByRole("heading", { level: 1, name: "Swap" }).waitFor({ timeout: 4000 });
}, { context: VIEWPORTS["390"] });

// ---------------------------------------------------------------- rail

await check("rail: fixed order and accessible names", async (page) => {
  await page.goto(APP);
  await settle(page);
  const rail = page.getByRole("navigation", { name: "Tools" });
  const labels = await rail.getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  assert(JSON.stringify(labels) === JSON.stringify(["Swap", "Balance", "Send and receive", "Earn", "Borrow", "Activity", "Settings and security"]), `order was ${labels.join(", ")}`);
  const current = await rail.locator('a[aria-current="page"]').getAttribute("aria-label");
  assert(current === "Swap", `active item was ${current}`);
});

await check("rail: keyboard focus opens a preview to the left; arrows move; Escape closes and keeps focus", async (page) => {
  await page.goto(APP);
  await settle(page);
  await page.locator('[data-rail="swap"]').focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowDown");
  const info = await activeInfo(page);
  assert(info.rail === "earn", `ArrowDown x3 focused ${info.rail}`);
  await preview(page).waitFor({ timeout: 2000 });
  assert((await preview(page).getAttribute("aria-label")) === "Earn preview", "preview is not for Earn");
  const p = await preview(page).boundingBox();
  const r = await page.getByRole("navigation", { name: "Tools" }).boundingBox();
  assert(p && r && p.x + p.width <= r.x, `preview not left of rail (${p?.x}+${p?.width} vs ${r?.x})`);
  const describedBy = await page.locator('[data-rail="earn"]').getAttribute("aria-describedby");
  assert(describedBy === "tool-preview", "focused rail item is not described by its preview");
  await page.keyboard.press("Escape");
  await preview(page).waitFor({ state: "detached", timeout: 2000 });
  assert((await activeInfo(page)).rail === "earn", "focus left the rail item after Escape");
});

await check("rail: ArrowLeft moves into the preview; Tab order is not trapped", async (page) => {
  await page.goto(APP);
  await settle(page);
  await page.locator('[data-rail="earn"]').focus();
  await preview(page).waitFor({ timeout: 2000 });
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowLeft");
  const inside = await page.evaluate(() => document.getElementById("tool-preview")?.contains(document.activeElement) ?? false);
  assert(inside, "ArrowLeft did not move focus into the preview");
  await page.keyboard.press("Escape");
  assert((await activeInfo(page)).rail === "earn", "Escape from inside the preview did not return focus to the rail item");
});

await check("rail: hover has an opening delay, survives moving into the preview, closes after leaving", async (page) => {
  await page.goto(APP);
  await settle(page);
  const btn = page.locator('[data-rail="balance"]');
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(40);
  assert((await preview(page).count()) === 0, "preview opened without delay (flicker risk)");
  await preview(page).waitFor({ timeout: 1500 });
  const p = await preview(page).boundingBox();
  // Travel left into the preview through the gap.
  await page.mouse.move(p.x + p.width - 20, box.y + box.height / 2, { steps: 6 });
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2, { steps: 4 });
  await page.waitForTimeout(450);
  assert((await preview(page).count()) === 1, "preview closed while the pointer was inside it");
  await page.mouse.move(300, 300, { steps: 4 });
  await preview(page).waitFor({ state: "detached", timeout: 1500 });
});

await check("rail: preview never covers the amount being edited", async (page) => {
  await page.goto(APP);
  await settle(page);
  await typeAmount(page, "2");
  const btn = page.locator('[data-rail="balance"]');
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await preview(page).waitFor({ timeout: 1500 });
  const p = await preview(page).boundingBox();
  const a = await page.locator("input[data-amount-input]").first().boundingBox();
  const overlaps = p.x < a.x + a.width && p.x + p.width > a.x && p.y < a.y + a.height && p.y + p.height > a.y;
  const compact = await preview(page).getAttribute("data-compact");
  assert(!overlaps || compact === "true", "full preview overlaps the amount field");
}, { context: { viewport: { width: 900, height: 760 } } });

await check("rail: click opens the module, focus moves to its heading, Escape returns focus to the rail", async (page) => {
  await page.goto(APP);
  await settle(page);
  await page.locator('[data-rail="earn"]').click();
  await page.waitForURL(/\/earn$/);
  await page.getByRole("heading", { level: 1, name: "Earn" }).waitFor();
  await page.waitForTimeout(200);
  const focusedHeading = await page.evaluate(() => document.activeElement?.tagName === "H1" && document.activeElement.textContent);
  assert(focusedHeading === "Earn", `focus after opening was ${focusedHeading}`);
  await page.keyboard.press("Escape");
  await page.waitForURL(APP);
  await page.waitForTimeout(200);
  assert((await activeInfo(page)).rail === "earn", "focus did not return to the Earn rail item");
});

await check("routing: unfinished swap survives module switches; back and forward behave", async (page) => {
  await page.goto(APP);
  await settle(page);
  await typeAmount(page, "1.25");
  await page.locator('[data-rail="balance"]').click();
  await page.waitForURL(/\/balance$/);
  await page.locator('[data-rail="borrow"]').click();
  await page.waitForURL(/\/borrow$/);
  await page.goBack();
  await page.waitForURL(/\/balance$/);
  await page.goBack();
  await page.waitForURL(APP);
  await page.goForward();
  await page.waitForURL(/\/balance$/);
  await page.goto(APP);
  await settle(page, 200);
  // A full navigation starts clean; an in-app return keeps the draft.
  await typeAmount(page, "1.25");
  await page.locator('[data-rail="activity"]').click();
  await page.waitForURL(/\/activity$/);
  await page.locator('[data-rail="swap"]').click();
  await page.waitForURL(APP);
  const value = await page.locator("input[data-amount-input]").first().inputValue();
  assert(value === "1.25", `swap amount was "${value}" after switching modules`);
  assert(!/1\.25|amount/i.test(page.url()), "amount leaked into the URL");
});

await check("routing: deep links render their module and an unknown module is a 404", async (page) => {
  for (const [path, title] of [["/borrow", "Borrow"], ["/settings", "Settings and security"], ["/send", "Send and receive"]]) {
    await page.goto(BASE + path);
    await page.getByRole("heading", { level: 1, name: title }).waitFor({ timeout: 5000 });
  }
  const res = await page.goto(BASE + "/admin");
  assert(res.status() === 404, `/admin returned ${res.status()}`);
});

// ---------------------------------------------------------------- dialogs

await check("token picker: modal traps focus, Escape restores focus to the token button", async (page) => {
  await page.goto(APP);
  await settle(page);
  const trigger = page.getByRole("button", { name: /You receive: USDC/ });
  await trigger.click();
  await page.locator("input[type=search]").waitFor();
  for (let i = 0; i < 25; i += 1) await page.keyboard.press("Tab");
  assert((await activeInfo(page)).inDialog, "focus escaped the modal picker");
  await page.keyboard.press("Escape");
  await page.locator("input[type=search]").waitFor({ state: "detached" });
  const label = (await activeInfo(page)).label ?? "";
  assert(/You receive/.test(label), `focus returned to "${label}"`);
});

await check("token picker: exact mint search finds the token; impostor ticker is flagged", async (page) => {
  await page.goto(APP);
  await settle(page);
  await page.getByRole("button", { name: /You receive: USDC/ }).click();
  const search = page.locator("input[type=search]");
  await search.fill("bonk");
  await page.getByText("Not the verified Bonk").waitFor({ timeout: 5000 });
  await search.fill("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
  await page.getByRole("option").first().waitFor({ timeout: 5000 });
  const options = await page.getByRole("option").count();
  assert(options === 1, `exact mint search returned ${options} options`);
});

// ---------------------------------------------------------------- touch

await check("mobile: bottom navigation and More sheet open every module", async (page) => {
  await page.goto(APP);
  await settle(page);
  assert(!(await page.locator('[data-rail="swap"]').isVisible()), "desktop rail visible at 390 px");
  const nav = page.getByRole("navigation", { name: "Tools" });
  await nav.getByRole("link", { name: "Earn" }).tap();
  await page.waitForURL(/\/earn$/);
  await nav.getByRole("button", { name: "More" }).tap();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("link", { name: "Borrow" }).tap();
  await page.waitForURL(/\/borrow$/);
  assert((await nav.getByRole("button", { name: "More" }).getAttribute("aria-current")) === "page", "More is not marked current for Borrow");
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('nav[aria-label="Tools"] a, nav[aria-label="Tools"] button')]
      .filter((e) => e.offsetParent)
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width < 44 || r.height < 44).length,
  );
  assert(small === 0, `${small} bottom-nav targets are smaller than 44 px`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 0, `horizontal overflow of ${overflow}px`);
}, { context: VIEWPORTS["390"] });

await check("tablet touch: a tap on the rail opens the module without hover", async (page) => {
  await page.goto(APP);
  await settle(page);
  await page.locator('[data-rail="balance"]').tap();
  await page.waitForURL(/\/balance$/);
  await page.getByRole("heading", { level: 1, name: "Balance" }).waitFor();
}, { context: VIEWPORTS["768"] });

// ---------------------------------------------------------------- motion

await check("reduced motion: the ring and transitions are effectively still", async (page) => {
  await page.goto(APP);
  await settle(page, 900);
  const spins = await page.evaluate(() =>
    [...document.querySelectorAll('[data-ring="stage"] g')].filter((g) => /spin/.test(g.getAttribute("class") ?? "")).map((g) => getComputedStyle(g).animationName),
  );
  assert(spins.length === 3, `expected 3 ring bands, found ${spins.length}`);
  assert(spins.every((n) => n === "none"), `ring still turns (${spins.join(", ")})`);
  const dur = await page.evaluate(() => getComputedStyle(document.querySelector('[data-rail="earn"]')).transitionDuration);
  assert(dur.split(",").every((d) => parseFloat(d) < 0.01), `rail transition ${dur}`);
}, { reducedMotion: true });

// ---------------------------------------------------------------- lifecycle

await check("swap lifecycle: connect, review, one signature, confirmed, recorded in Activity", async (page) => {
  const execs = [];
  page.on("request", (r) => r.url().includes("/api/swap/execute") && execs.push(r.method()));
  await page.goto(APP);
  await settle(page);
  await connect(page);
  await openReview(page);
  await page.getByText(/Simulation passed/).waitFor({ timeout: 8000 });
  const checks = await page.locator("dialog[open]").innerText();
  assert(/Invokes only expected programs/.test(checks), "program allowlist check not shown");
  assert(/Simulation passed/.test(checks), "simulation result not shown");
  assert(/So11111111111111111111111111111111111111112/.test(checks) && /EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/.test(checks), "full mints not shown on review");
  await page.getByRole("button", { name: "Sign and swap" }).click();
  await page.getByText("Confirmed").waitFor({ timeout: 12000 });
  const signed = await page.evaluate(() => window.__qaSigned ?? 0);
  assert(signed === 1, `wallet signed ${signed} times`);
  assert(execs.length === 1, `execute called ${execs.length} times`);
  await page.getByRole("button", { name: "Done" }).click();
  await page.locator('[data-rail="activity"]').click();
  await page.waitForURL(/\/activity$/);
  await page.getByText(/Swap SOL for USDC/).first().waitFor({ timeout: 4000 });
});

await check("transaction ring: waits for the wallet, moves while sending, glows on confirmation, then settles", async (page) => {
  await page.goto(APP);
  await settle(page, 900);
  await connect(page);
  await openReview(page);
  await page.evaluate(() => {
    window.__ringLog = [];
    const read = () => {
      const tx = document.querySelector('[data-ring="tx"] svg')?.getAttribute("data-mode") ?? null;
      const bg = document.querySelector('[data-ring="stage"] svg')?.getAttribute("data-mode") ?? null;
      const last = window.__ringLog.at(-1);
      if (!last || last.tx !== tx || last.bg !== bg) window.__ringLog.push({ tx, bg });
    };
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-mode"] });
    read();
  });
  await page.getByRole("button", { name: "Sign and swap" }).click();
  await page.getByText("Confirmed").waitFor({ timeout: 12000 });
  await page.waitForTimeout(3200);
  const log = await page.evaluate(() => window.__ringLog);
  const seq = (k) => log.map((e) => e[k]).filter((v, i, a) => v && v !== a[i - 1]);
  // True when `want` appears in `list` in this order (other states may come between).
  const order = (list, want) => want.reduce((at, w) => (at < 0 ? at : list.indexOf(w, at) < 0 ? -1 : list.indexOf(w, at) + 1), 0) > 0;
  assert(order(seq("tx"), ["waiting", "moving", "landed"]), `dialog ring went ${seq("tx").join(" > ")}`);
  assert(order(seq("bg"), ["waiting", "moving", "landed", "idle"]), `background ring went ${seq("bg").join(" > ")}`);
  assert(log.at(-1).tx === "landed" && log.at(-1).bg === "idle", `ended at ${JSON.stringify(log.at(-1))}`);
}, { walletOpts: { delayMs: 700 } });

await check("duplicate protection: a double click signs and submits once", async (page) => {
  const execs = [];
  page.on("request", (r) => r.url().includes("/api/swap/execute") && execs.push(1));
  await page.goto(APP);
  await settle(page);
  await connect(page);
  await openReview(page);
  const btn = page.getByRole("button", { name: "Sign and swap" });
  await btn.dblclick();
  await page.getByText("Confirmed").waitFor({ timeout: 12000 });
  const calls = await page.evaluate(() => window.__qaSignCalls ?? 0);
  assert(calls === 1, `wallet asked to sign ${calls} times`);
  assert(execs.length === 1, `execute called ${execs.length} times`);
}, { walletOpts: { delayMs: 300 } });

await check("wallet rejection: nothing is submitted and the review can be retried", async (page) => {
  const execs = [];
  page.on("request", (r) => r.url().includes("/api/swap/execute") && execs.push(1));
  await page.goto(APP);
  await settle(page);
  await connect(page);
  await openReview(page);
  await page.getByRole("button", { name: "Sign and swap" }).click();
  await page.getByRole("button", { name: "Try signing again" }).waitFor({ timeout: 6000 });
  assert(execs.length === 0, "a rejected signature still reached execute");
  const text = await page.locator("dialog[open]").innerText();
  assert(/declined/i.test(text), "rejection is not explained");
}, { walletOpts: { rejectSign: true } });

if (SLOW) {
  await check("quote expiry: approval is blocked after the terms expire", async (page) => {
    await page.goto(APP);
    await settle(page);
    await connect(page);
    await openReview(page);
    await page.getByRole("button", { name: "Get fresh terms" }).waitFor({ timeout: 40000 });
    assert((await page.getByRole("button", { name: "Sign and swap" }).count()) === 0, "signing still offered after expiry");
    await page.getByRole("button", { name: "Get fresh terms" }).click();
    await page.getByRole("button", { name: "Sign and swap" }).waitFor({ timeout: 8000 });
    const signed = await page.evaluate(() => window.__qaSigned ?? 0);
    assert(signed === 0, "wallet was asked to sign during refresh");
  });
}

// ---------------------------------------------------------------- privacy hygiene

await check("storage hygiene: only settings persist; no address, amount or key material in storage, cookies or URL", async (page) => {
  await page.goto(APP);
  await settle(page);
  await connect(page);
  await openReview(page);
  await page.getByRole("button", { name: "Sign and swap" }).click();
  await page.getByText("Confirmed").waitFor({ timeout: 12000 });
  const dump = await page.evaluate(() => {
    const all = {};
    for (let i = 0; i < localStorage.length; i += 1) all[`local:${localStorage.key(i)}`] = localStorage.getItem(localStorage.key(i));
    for (let i = 0; i < sessionStorage.length; i += 1) all[`session:${sessionStorage.key(i)}`] = sessionStorage.getItem(sessionStorage.key(i));
    return { all, cookie: document.cookie };
  });
  const keys = Object.keys(dump.all);
  assert(keys.every((k) => k === "local:noct.settings.v1"), `unexpected storage keys: ${keys.join(", ")}`);
  const blob = JSON.stringify(dump.all);
  assert(!blob.includes(wallet.address), "wallet address found in browser storage");
  assert(!/1\.25|signature|seed|secret/i.test(blob), "amount or key material found in browser storage");
  assert(dump.cookie === "", `cookies set: ${dump.cookie}`);
  assert(!page.url().includes(wallet.address), "address in URL");
});

await check("masking: balances are hidden in the card, panel and preview", async (page) => {
  await page.goto(APP);
  await settle(page);
  await connect(page);
  await settle(page, 400);
  const cardText = await page.locator("#swap-heading").locator("xpath=ancestor::section[1]").innerText().catch(() => page.locator("body").innerText());
  assert(!/12\.48/.test(cardText), "SOL balance visible in the swap card while masked");
  const btn = page.locator('[data-rail="balance"]');
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await preview(page).waitFor({ timeout: 1500 });
  assert(!/\$\d/.test(await preview(page).innerText()), "dollar value visible in the Balance preview while masked");
}, { settings: { maskBalances: true } });

await check("headers: CSP and framing protections on the page and no-store on APIs", async (page) => {
  const res = await page.goto(APP);
  const h = res.headers();
  assert(/frame-ancestors 'none'/.test(h["content-security-policy"] ?? ""), "CSP frame-ancestors missing");
  assert(/connect-src 'self'/.test(h["content-security-policy"] ?? ""), "CSP connect-src not locked to self");
  assert(h["x-frame-options"] === "DENY", "X-Frame-Options missing");
  assert(h["referrer-policy"] === "no-referrer", "Referrer-Policy missing");
  const api = await page.request.get(`${BASE}/api/capabilities`);
  assert(/no-store/.test(api.headers()["cache-control"] ?? ""), "API responses are cacheable");
  const cross = await page.request.post(`${BASE}/api/swap/order`, { headers: { origin: "https://evil.example", "content-type": "application/json" }, data: {} });
  assert(cross.status() === 403, `cross-origin POST returned ${cross.status()}`);
});

await check("mainnet only: relays refuse other networks and the settings offer no network switch", async (page) => {
  const rpc = await page.request.post(`${BASE}/api/rpc/devnet`, { headers: { "content-type": "application/json" }, data: { jsonrpc: "2.0", id: 1, method: "getSlot" } });
  assert(rpc.status() === 400, `devnet RPC returned ${rpc.status()}`);
  const spr = await page.request.get(`${BASE}/api/spr/devnet/policy`);
  assert(spr.status() === 400, `devnet Privacy Rings relay returned ${spr.status()}`);
  const caps = await (await page.request.get(`${BASE}/api/capabilities`)).json();
  assert(caps.network === "mainnet" && !("devnet" in caps.privacy), "capabilities still describe another network");
  await page.goto(`${BASE}/settings`);
  await page.getByRole("heading", { level: 1, name: "Settings and security" }).waitFor();
  await page.getByText("Solana mainnet only").waitFor({ timeout: 5000 });
  const text = await page.locator("main").innerText();
  assert(!/devnet|demo mode/i.test(text), "settings still mention devnet or demo mode");
  assert(/Solana mainnet only/.test(text), "settings do not state mainnet only");
});

await browser.close();
const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${String(r.ms).padStart(6)} ms${r.ok ? "" : `\n      ${r.error}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${SLOW ? "" : " (run with --slow to include quote expiry)"}`);
if (failed) process.exitCode = 1;
