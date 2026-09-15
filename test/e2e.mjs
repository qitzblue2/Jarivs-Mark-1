/**
 * Browser end-to-end test. Requires the mock provider and a dev server
 * pointed at it:
 *   ./test/start-mock.sh
 *   GROQ_API_KEY=test JARVIS_GROQ_BASE_URL=http://localhost:8899/v1 npm run dev
 *   npm run test:e2e
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const OUT = process.env.SHOT_DIR ?? "/tmp";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const check = (label, ok, extra = "") =>
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
check("page loads", (await page.title()) === "JARVIS Mark 5", await page.title());

await page.locator("header button", { hasText: /mock-/ }).first().waitFor({ timeout: 10000 });
check("model picker populated from live /models", true);

// --- tool calling ---
await page.locator("button", { hasText: "New chat" }).first().click();
await page.locator("textarea").first().fill("what is (2+3)*sqrt(16)? calculate it");
await page.keyboard.press("Enter");

await page.getByText("Used calculate").waitFor({ timeout: 20000 });
check("tool trace appears", true);

await page.waitForFunction(() => document.body.innerText.includes("The calculator says"), { timeout: 20000 });
const answered = await page.evaluate(() => document.body.innerText.includes("= 20"));
check("tool result reached the answer", answered);

// Expand the trace and confirm it shows the real call and result.
await page.getByText("Used calculate").click();
await page.waitForTimeout(300);
const traceText = await page.locator(".prose-jarvis").last().evaluate((el) => el.closest("div[class*='min-w-0']")?.innerText ?? "");
check("trace expands with arguments", traceText.includes("expression"), traceText.slice(0, 60).replace(/\n/g, " "));
await page.screenshot({ path: `${OUT}/mark2-tool-trace.png` });

// --- code canvas still works ---
await page.locator("button", { hasText: "New chat" }).first().click();
await page.locator("textarea").first().fill("bouncing ball");
await page.keyboard.press("Enter");
await page.getByText("Code canvas").waitFor({ timeout: 20000 });
await page.waitForFunction(() => document.body.innerText.includes("runs standalone"), { timeout: 20000 });

const frame = page.frameLocator('iframe[title="Code preview"]');
await frame.locator("#b").waitFor({ timeout: 10000 });
const p1 = await frame.locator("#b").evaluate((el) => el.style.transform);
await page.waitForTimeout(500);
const p2 = await frame.locator("#b").evaluate((el) => el.style.transform);
check("preview animates", p1 !== p2);

const sandbox = await page.locator('iframe[title="Code preview"]').getAttribute("sandbox");
check("preview sandbox withholds same-origin", !sandbox.includes("allow-same-origin"), sandbox);

const lines = await page.locator(".prose-jarvis pre code").first().evaluate((el) => el.innerText.split("\n").length);
check("chat code block keeps newlines", lines > 5, `${lines} lines`);

const canvasCount = await page.locator('iframe[title="Code preview"]').count();
check("exactly one preview iframe", canvasCount === 1, `${canvasCount}`);

// --- persistence ---
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.body.innerText.includes("runs standalone"), { timeout: 15000 });
check("chat restored after reload", true);

// --- responsive ---
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal overflow at 390px", overflow === 0, `${overflow}px`);

// --- can this model do the one thing JARVIS depends on? ---
//
// A model that accepts the `tools` parameter and then never calls one passes
// every other check and simply ignores the projector, search and memory. The
// probe is the only thing that catches it, so it is worth testing that the
// probe itself distinguishes the two.
const probe = async (model) =>
  (await fetch("http://localhost:3000/api/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "groq", model }),
  })).json();

const good = await probe("mock-fast-8b");
check("the probe sees a model call a tool", good.ok && good.calledTool === true);
check("and names which one", good.toolName === "get_time", good.toolName);
check("and times the first reply", typeof good.firstByteMs === "number" && good.firstByteMs >= 0);

const noTools = await probe("mock-no-tools");
check("a model that refuses tools is reported, not crashed", noTools.ok === false && /tool/i.test(noTools.error ?? ""), (noTools.error ?? "").slice(0, 40));

check("no console or page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(errors.length ? 1 : 0);
