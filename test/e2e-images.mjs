/**
 * Pictures, end to end in a real browser. Requires the mock provider standing
 * in for both the chat model and NanoGPT's image endpoint, and a PRODUCTION
 * server — `next dev` serves files that `next start` doesn't, which is the
 * bug this exists to keep fixed:
 *   ./test/start-mock.sh
 *   npm run build
 *   GROQ_API_KEY=test JARVIS_GROQ_BASE_URL=http://localhost:8899/v1 \
 *     NANOGPT_API_KEY=test JARVIS_NANOGPT_IMAGES_URL=http://localhost:8899/v1/images/generations \
 *     npm start
 *   npm run test:images
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const OUT = process.env.SHOT_DIR ?? "/tmp";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

let failed = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
};

await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator("header button", { hasText: /mock-/ }).first().waitFor({ timeout: 10000 });

// --- a picture is made and shown ---
await page.locator("button", { hasText: "New chat" }).first().click();
await page.locator("textarea").first().fill("draw me a lighthouse");
await page.keyboard.press("Enter");

await page.getByText("Used generate_image").waitFor({ timeout: 30000 });
check("the image tool ran", true);

const img = page.locator(".prose-jarvis img").first();
await img.waitFor({ timeout: 20000 });
const src = await img.getAttribute("src");
check("the reply shows a same-origin picture", /^\/api\/images\/[0-9a-f-]{36}$/.test(src ?? ""), src);
await page.waitForFunction(
  () => [...document.querySelectorAll(".prose-jarvis img")].some((i) => i.complete && i.naturalWidth > 0),
  { timeout: 10000 },
);
check("and it actually loads under next start", true);
await page.screenshot({ path: `${OUT}/images-chat.png` });

// --- downloadable ---
const res = await page.request.get(`${BASE}${src}?download=1`);
check("download is offered as an attachment", /attachment/.test(res.headers()["content-disposition"] ?? ""));
check("and is a PNG", res.headers()["content-type"] === "image/png");

// --- enlarge ---
await img.click();
const dialog = page.locator('[role="dialog"] img');
await dialog.waitFor({ timeout: 5000 });
check("clicking enlarges it", true);
await page.screenshot({ path: `${OUT}/images-lightbox.png` });
await page.keyboard.press("Escape");
check("escape closes it", (await page.locator('[role="dialog"]').count()) === 0);

// --- gallery ---
await page.locator('button[title="Pictures"]').first().click();
await page.getByText("a lighthouse in a storm").first().waitFor({ timeout: 5000 });
check("the gallery lists it", true);
await page.screenshot({ path: `${OUT}/images-gallery.png` });

// --- ask for a change from the gallery ---
await page.locator('button[title="Ask for a change to this picture"]').first().click({ force: true });
const draft = await page.locator("textarea").first().inputValue();
check("the gallery starts an edit request", draft.includes(src), draft);
await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA", null, { timeout: 5000 });
check("and puts the cursor there", true);
await page.keyboard.type("make it night");
const typed = await page.locator("textarea").first().inputValue();
check("typing continues after the path, not before it", typed.endsWith("make it night"), typed);
await page.keyboard.press("Enter");
await page.waitForFunction(
  (first) => [...document.querySelectorAll(".prose-jarvis img")].some((i) => i.getAttribute("src") !== first && i.naturalWidth > 0),
  src,
  { timeout: 30000 },
);
check("and the edit comes back as a new picture", true);
await page.screenshot({ path: `${OUT}/images-edit.png` });

// --- only our pictures are served, and only by id ---
const bad = await page.request.get(`${BASE}/api/images/..%2F..%2Fpackage.json`);
check("a path in place of an id is refused", bad.status() === 400 || bad.status() === 404, String(bad.status()));

check("no console or page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
