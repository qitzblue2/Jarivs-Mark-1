/**
 * JARVIS editing its own code, end to end, in a real browser.
 *
 * Needs the mock provider and a PRODUCTION server with self-editing on, run
 * from the repo root (the sandbox is made under .sandbox/ there):
 *   ./test/start-mock.sh
 *   npm run build
 *   JARVIS_ALLOW_SELF_EDIT=1 GROQ_API_KEY=test JARVIS_GROQ_BASE_URL=http://localhost:8899/v1 npm start
 *   npm run test:sandbox
 *
 * It applies a change to the real components/ChatPane.tsx and undoes it, and
 * checks the file is byte-for-byte as it was.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const OUT = process.env.SHOT_DIR ?? "/tmp";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SANDBOX = process.env.SANDBOX_URL ?? "http://localhost:3100";
const FILE = "components/ChatPane.tsx";
const MARK = "edited by itself";
const original = readFileSync(FILE, "utf8");

let failed = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
};
const api = async (body) =>
  (await fetch(`${BASE}/api/sandbox`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })).json();

async function waitOnline(label, ms = 180_000) {
  const until = Date.now() + ms;
  let state = "";
  while (Date.now() < until) {
    state = (await api())?.server?.state;
    if (state === "online") return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`     (last state: ${state})`);
  return false;
}

// Start clean, whatever an earlier run left.
await api({ action: "reset" });
check("the sandbox comes up with JARVIS", await waitOnline("boot"));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("header button", { hasText: /mock-/ }).first().waitFor({ timeout: 10000 });
  check("the sandbox button is there", (await page.locator('button[title^="Sandbox"]').count()) > 0);
  check("and this one isn't marked as the sandbox", (await page.locator("[data-sandbox-banner]").count()) === 0);

  // --- JARVIS edits itself, with permission ---
  await page.locator("button", { hasText: "New chat" }).first().click();
  await page.locator("textarea").first().fill("change your welcome title please");
  await page.keyboard.press("Enter");
  await page.getByText("JARVIS wants to change its own code").waitFor({ timeout: 20000 });
  const card = await page.locator("text=JARVIS wants to change its own code").locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]").innerText();
  check("it asks first, showing the change", card.includes(`-`) && card.includes(MARK), card.split("\n").slice(0, 3).join(" / "));
  await page.screenshot({ path: `${OUT}/sandbox-approval.png` });
  await page.locator("button", { hasText: /^Approve$/ }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes("Done. Edited components/ChatPane.tsx"), { timeout: 20000 });
  check("the edit lands in the sandbox", readFileSync(`.sandbox/app/${FILE}`, "utf8").includes(MARK));
  check("and not in JARVIS", readFileSync(FILE, "utf8") === original);

  // --- the sandbox runs it ---
  const box = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await box.goto(SANDBOX, { waitUntil: "networkidle", timeout: 120000 });
  await box.locator("button", { hasText: "New chat" }).first().click();
  await box.getByText(MARK).first().waitFor({ timeout: 60000 });
  check("the sandbox shows the change, live", true);
  check("and says it's the sandbox", (await box.locator("[data-sandbox-banner]").count()) === 1);
  await box.screenshot({ path: `${OUT}/sandbox-running.png` });
  await page.locator("button", { hasText: "New chat" }).first().click();
  check("the real JARVIS doesn't", !(await page.content()).includes(MARK));

  // --- always online: kill it and it comes back ---
  const before = (await api()).server;
  try { process.kill(-before.pid, "SIGKILL"); } catch { process.kill(before.pid, "SIGKILL"); }
  await new Promise((r) => setTimeout(r, 1500));
  check("killing the sandbox server is noticed", (await api()).server.state !== "online");
  check("and it is started again by itself", await waitOnline("restart", 120000));
  check("having counted the restart", (await api()).server.restarts >= 1);

  // --- the panel: see it, edit by hand, check, apply, undo ---
  await page.locator('button[title^="Sandbox"]').first().click();
  const panel = page.locator('[role="dialog"][aria-label="Sandbox"]');
  await panel.waitFor({ timeout: 5000 });
  await panel.locator("[data-sandbox-state=online]").waitFor({ timeout: 20000 });
  check("the panel shows it online", true);
  await panel.locator("button", { hasText: FILE }).first().click();
  await panel.getByText(MARK).first().waitFor({ timeout: 5000 });
  check("and the change as a diff", true);
  await page.screenshot({ path: `${OUT}/sandbox-panel.png` });

  // You can edit any file yourself, too.
  await panel.locator("input[placeholder='Find a file']").fill("README.md");
  await panel.locator("aside button", { hasText: "README.md" }).first().click();
  await panel.locator("[data-open-file='README.md']").waitFor({ timeout: 5000 });
  const editor = panel.locator("textarea");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nAdded by hand in the sandbox.\n");
  await page.keyboard.press("Control+s");
  await panel.getByText("Saved README.md to the sandbox").waitFor({ timeout: 5000 });
  check("your own edits save to the sandbox", readFileSync(".sandbox/app/README.md", "utf8").includes("Added by hand"));
  check("only the sandbox", !readFileSync("README.md", "utf8").includes("Added by hand"));
  page.once("dialog", (d) => d.accept());
  await panel.locator("button", { hasText: "Revert" }).click();
  await page.waitForFunction(() => !document.querySelector("[data-open-file='README.md']")?.parentElement?.innerText.includes("changed"), null, { timeout: 5000 });
  check("and can be reverted", !readFileSync(".sandbox/app/README.md", "utf8").includes("Added by hand"));

  await panel.locator("button", { hasText: "Run checks" }).click();
  await panel.locator("[data-check]").waitFor({ timeout: 300000 });
  const verdict = await panel.locator("[data-check]").getAttribute("data-check");
  check("the checks run against the sandbox", verdict === "passed", verdict);

  await panel.locator("button", { hasText: /Apply 1 change to JARVIS/ }).click();
  await panel.getByText("Applied 1 file(s) to JARVIS").waitFor({ timeout: 300000 });
  check("applying writes it into JARVIS", readFileSync(FILE, "utf8").includes(MARK));
  await page.screenshot({ path: `${OUT}/sandbox-applied.png` });
  // An apply once left backups the type checker read as source, which broke
  // the next `npm run build`. The real project must still check clean.
  const tsc = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"], { encoding: "utf8" });
  check("and JARVIS still type-checks afterwards", tsc.status === 0, (tsc.stdout || "").split("\n")[0]);

  page.once("dialog", (d) => d.accept());
  await panel.locator("button", { hasText: "Undo" }).first().click();
  await panel.getByText(/^Undone\./).waitFor({ timeout: 20000 });
  check("and undo puts JARVIS back exactly", readFileSync(FILE, "utf8") === original);

  // --- it works on a phone ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("the panel fits a phone", overflow === 0, `${overflow}px`);
  await panel.locator("button", { hasText: /^Changes/ }).click();
  await panel.locator("button", { hasText: "Run checks" }).waitFor({ timeout: 5000 });
  check("with its sections as tabs", true);
  await page.screenshot({ path: `${OUT}/sandbox-phone.png` });
} finally {
  // Whatever happened, JARVIS' own file must end as it began.
  if (readFileSync(FILE, "utf8") !== original) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(FILE, original);
    console.log("     restored components/ChatPane.tsx after a failure");
  }
  await api({ action: "reset" });
}

check("no console or page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
