/**
 * Finding, pinning and exporting chats, in a real browser. Needs the mock
 * provider and a server pointed at it, as for test/e2e.mjs:
 *   ./test/start-mock.sh
 *   GROQ_API_KEY=test JARVIS_GROQ_BASE_URL=http://localhost:8899/v1 npm run dev
 *   npm run test:chats
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const OUT = process.env.SHOT_DIR ?? "/tmp";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let failed = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
};

/** Seed a chat through the API, so the test does not depend on what the model says. */
async function seed(title, messages) {
  const created = await (await fetch(`${BASE}/api/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  })).json();
  const id = created.chat.id;
  await fetch(`${BASE}/api/chats/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: messages.map(([role, content], i) => ({ id: `${id}-${i}`, role, content, createdAt: Date.now() })),
    }),
  });
  return id;
}

const marker = `zeppelin${Date.now().toString(36)}`;
const deepId = await seed("Holiday ideas", [
  ["user", "Where should we go in spring?"],
  ["assistant", `Somewhere with a ${marker} tour would be memorable.`],
]);
const pinId = await seed(`Pin me ${marker.slice(-4)}`, [["user", "keep this one handy"]]);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

await page.goto(BASE, { waitUntil: "networkidle" });

// --- search what was said, not just titles ---
await page.keyboard.press("Control+/");
const focused = await page.evaluate(() => document.activeElement?.hasAttribute("data-chat-search"));
check("Ctrl+/ jumps to search", focused === true);
await page.keyboard.type(marker);
const hit = page.locator("aside nav li", { hasText: "Holiday ideas" }).first();
await hit.waitFor({ timeout: 5000 });
check("a word only in a reply finds the chat", true);
check("and shows where", (await hit.innerText()).includes("tour would be memorable"));
await page.screenshot({ path: `${OUT}/chats-search.png` });
await page.locator("aside input[data-chat-search]").first().fill("");

// --- pin ---
const row = page.locator("aside nav li", { hasText: `Pin me ${marker.slice(-4)}` }).first();
await row.hover();
await row.locator('button[title="Pin to top"]').click();
await page.getByText("Pinned", { exact: true }).first().waitFor({ timeout: 5000 });
const firstRow = await page.locator("aside nav li").first().innerText();
check("a pinned chat goes to the top", firstRow.includes(`Pin me ${marker.slice(-4)}`), firstRow.split("\n").slice(0, 2).join(" / "));
await page.reload({ waitUntil: "networkidle" });
const afterReload = await page.locator("aside nav li").first().innerText();
check("and stays there after a reload", afterReload.includes(`Pin me ${marker.slice(-4)}`));
await page.screenshot({ path: `${OUT}/chats-pinned.png` });

// --- export ---
await page.locator("aside nav li", { hasText: "Holiday ideas" }).first().locator("button").first().click();
const exportLink = page.locator('a[title="Export this chat as Markdown"]');
await exportLink.waitFor({ timeout: 5000 });
const [download] = await Promise.all([page.waitForEvent("download"), exportLink.click()]);
check("export downloads a Markdown file", download.suggestedFilename() === "holiday-ideas.md", download.suggestedFilename());
const body = await (await fetch(`${BASE}/api/chats/${deepId}/export`)).text();
check("with the conversation in it", body.includes("# Holiday ideas") && body.includes(marker));

// --- what's been spent ---
// Send one message so there is something to count.
await page.locator("button", { hasText: "New chat" }).first().click();
await page.locator("textarea").first().fill("bouncing ball");
await page.keyboard.press("Enter");
await page.waitForFunction(() => document.body.innerText.includes("runs standalone"), { timeout: 20000 });
await page.locator('button[title="Usage"]').first().click();
const usage = page.locator('[role="dialog"][aria-label="Usage"]');
await usage.waitFor({ timeout: 5000 });
await usage.getByText("Groq").first().waitFor({ timeout: 5000 });
const usageText = await usage.innerText();
check("the usage page counts requests to the provider", /Groq\s+\d+/.test(usageText), usageText.split("\n").slice(0, 8).join(" | "));
check("and says when it can answer", usageText.includes("Ready"));
await page.screenshot({ path: `${OUT}/chats-usage.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("escape closes it", (await usage.count()) === 0);
check("and only it — the code canvas behind stays open", (await page.locator('iframe[title="Code preview"]').count()) === 1);

// --- everything, in one file ---
const [backup] = await Promise.all([page.waitForEvent("download"), page.locator("a", { hasText: "Back up" }).first().click()]);
check("back up downloads a zip", /^jarvis-backup-\d{4}-\d\d-\d\d\.zip$/.test(backup.suggestedFilename()), backup.suggestedFilename());
const zip = Buffer.from(await (await fetch(`${BASE}/api/backup`)).arrayBuffer());
check("holding the chats", zip.readUInt32LE(0) === 0x04034b50 && zip.includes(`data/chats/${deepId}.json`));

// --- still fits a phone ---
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal overflow at 390px", overflow === 0, `${overflow}px`);
await page.keyboard.press("Control+/");
await page.waitForTimeout(300);
const drawerFocused = await page.evaluate(() => document.activeElement?.hasAttribute("data-chat-search"));
check("Ctrl+/ opens the drawer on a phone", drawerFocused === true);

// Tidy up what the test made.
for (const id of [deepId, pinId]) await fetch(`${BASE}/api/chats/${id}`, { method: "DELETE" });

check("no console or page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
