/**
 * Settings export and import, and the activity list, in a real browser.
 * Same setup as test/e2e.mjs (mock provider + a server pointed at it).
 */
import { readFileSync } from "node:fs";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const OUT = process.env.SHOT_DIR ?? "/tmp";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SECRET = "gsk_THIS_MUST_NOT_LEAVE_THE_BROWSER";

let failed = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

// A browser that already has a key saved and a non-default temperature.
await page.addInitScript((secret) => {
  if (localStorage.getItem("jarvis.settings.v1")) return;
  localStorage.setItem("jarvis.settings.v1", JSON.stringify({ temperature: 0.3, keys: { groq: secret } }));
}, SECRET);
await page.goto(BASE, { waitUntil: "networkidle" });

await page.locator('button[title="Settings"]').first().click();
const dialog = page.locator("div.fixed", { hasText: "Settings" }).first();
await dialog.locator("button", { hasText: "Export" }).waitFor({ timeout: 5000 });

// --- export ---
const [download] = await Promise.all([page.waitForEvent("download"), dialog.locator("button", { hasText: "Export" }).click()]);
check("export downloads a dated JSON file", /^jarvis-settings-\d{4}-\d\d-\d\d\.json$/.test(download.suggestedFilename()), download.suggestedFilename());
const path = await download.path();
const text = readFileSync(path, "utf8");
const exported = JSON.parse(text);
check("it says what it is", exported.format === "jarvis-settings" && exported.version === 1);
check("it carries the settings", exported.settings.temperature === 0.3, String(exported.settings.temperature));
check("it never carries the API key", !text.includes(SECRET));
check("and says so", (await dialog.getByText("API keys are never included").count()) > 0);

// --- import: a file that changes one thing, tries to sneak a key in, and is otherwise hostile ---
const incoming = JSON.stringify({
  format: "jarvis-settings", version: 1,
  settings: { temperature: 1.4, keys: { groq: "injected" }, endpoints: { "self-hosted": "javascript:alert(1)" } },
});
await dialog.locator("input[data-settings-file]").setInputFiles({ name: "s.json", mimeType: "application/json", buffer: Buffer.from(incoming) });
await dialog.getByText("Loaded temperature").waitFor({ timeout: 5000 });
check("import says what changed, and that nothing is saved yet", /Press Save/.test(await dialog.locator("[role=status]").innerText()));
check("the slider shows the imported value", (await dialog.locator("span.font-mono", { hasText: "1.40" }).count()) > 0);
await page.screenshot({ path: `${OUT}/settings-import.png` });

await dialog.locator("button", { hasText: /^Save$/ }).click();
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.settings.v1")));
check("after Save the new temperature is kept", saved.temperature === 1.4, String(saved.temperature));
check("the existing key is untouched", saved.keys?.groq === SECRET, JSON.stringify(saved.keys));
check("a hostile endpoint was not accepted", !JSON.stringify(saved.endpoints ?? {}).includes("javascript"));

// --- refusals ---
await page.locator('button[title="Settings"]').first().click();
await dialog.locator("input[data-settings-file]").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
await dialog.getByText("isn't a JARVIS settings file").waitFor({ timeout: 5000 });
check("another JSON file is refused, with a reason", true);
await dialog.locator("input[data-settings-file]").setInputFiles({ name: "y.json", mimeType: "application/json", buffer: Buffer.from("not json at all") });
await dialog.getByText("isn't a JSON file").waitFor({ timeout: 5000 });
check("so is something that isn't JSON", true);
await page.keyboard.press("Escape");

// --- activity: do something that is recorded, then look for it ---
await (await fetch(`${BASE}/api/backup`)).arrayBuffer();
await page.locator('button[title="Usage"]').first().click();
const usage = page.locator('[role="dialog"][aria-label="Usage"]');
await usage.waitFor({ timeout: 5000 });
await usage.locator("[data-activity]").waitFor({ timeout: 5000 });
const activity = await usage.locator("[data-activity]").innerText();
check("the usage page lists what happened", activity.includes("Downloaded a backup"), activity.split("\n")[0]);
await page.screenshot({ path: `${OUT}/usage-activity.png` });

check("no console or page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
