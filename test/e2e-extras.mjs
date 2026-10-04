/**
 * The rest, in a real browser: scheduled-task templates, the welcome screen,
 * the gallery's copy-prompt and picture families, usage as CSV, daily backups,
 * and chat statistics — each with an axe scan. (What each past sandbox apply
 * changed is checked in test/e2e-sandbox.mjs, where there is a sandbox.)
 * Same setup as test/e2e.mjs (mock provider + a server pointed at it); it
 * needs to know the server's data folder to place pictures:
 *   JARVIS_DATA_DIR=<the folder the server was started with> npm run test:extras
 *
 * Seeds its own chats, pictures and tasks and removes every one it made.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const OUT = process.env.SHOT_DIR ?? "/tmp";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DATA = process.env.JARVIS_DATA_DIR ?? "data";
const RUN = Date.now().toString(36).slice(-5);
const AXE = new URL("../node_modules/axe-core/axe.min.js", import.meta.url).pathname;

let failed = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
};
const json = (path) => fetch(`${BASE}${path}`).then((r) => r.json());
const send = (path, method, body) =>
  fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const madeChats = [];
const madeTasks = [];
const madePictures = [];

async function seedChat(title, messages, patch = {}) {
  const { chat } = await (await send("/api/chats", "POST", { title })).json();
  madeChats.push(chat.id);
  await send(`/api/chats/${chat.id}`, "PATCH", {
    messages: messages.map((m, i) => ({ id: `${chat.id}-${i}`, createdAt: Date.now() + i, ...m })),
    ...patch,
  });
  await new Promise((r) => setTimeout(r, 30));
  return chat;
}

// A one-pixel PNG: a real, decodable picture, which is all the gallery needs.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
let pictureSeq = 0;
function seedPicture(prompt, extra = {}) {
  // Ids are 36 characters of hex and dashes, as the image store requires.
  const id = `00000000-0000-4000-8000-${(RUN.padEnd(6, "0") + String(++pictureSeq).padStart(6, "0")).replace(/[^0-9a-f]/g, "0").slice(0, 12)}`;
  mkdirSync(`${DATA}/images`, { recursive: true });
  writeFileSync(`${DATA}/images/${id}.png`, PNG);
  writeFileSync(`${DATA}/images/${id}.json`, JSON.stringify({ id, prompt, model: "mock-image", mime: "image/png", bytes: PNG.length, createdAt: Date.now() + pictureSeq * 1000, ...extra }));
  madePictures.push(id);
  return id;
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", acceptDownloads: true });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });
page.on("dialog", (d) => d.accept());

async function axe(label) {
  if ((await page.evaluate(() => typeof window.axe)) === "undefined") await page.addScriptTag({ path: AXE });
  await page.addStyleTag({ content: "[data-msg] .opacity-0, [data-picture] .opacity-0 { opacity: 1 !important } *, *::before, *::after { transition: none !important; }" });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    });
    return result.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help,
      nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(" ")} :: ${(n.any[0] ?? n.all[0] ?? n.none[0])?.message ?? ""}`.slice(0, 220)),
    }));
  });
  for (const v of violations) console.log(`     axe [${v.impact}] ${v.id}: ${v.help}\n${v.nodes.map((n) => `        ${n}`).join("\n")}`);
  check(`axe finds nothing to fix — ${label}`, violations.length === 0, violations.length ? `${violations.length} rule(s) violated` : "");
}
async function theme(value) {
  await page.evaluate((v) => {
    const a = JSON.parse(localStorage.getItem("jarvis.appearance") ?? "{}");
    localStorage.setItem("jarvis.appearance", JSON.stringify({ ...a, theme: v }));
  }, value);
  await page.reload({ waitUntil: "networkidle" });
}
async function openSettings() {
  await page.locator('button[title="Settings"]').first().click();
  const dialog = page.locator('[role="dialog"][aria-labelledby="settings-title"]');
  await dialog.waitFor({ timeout: 5000 });
  return dialog;
}
const rail = () => page.locator('aside[aria-label="Chats"]');

try {
  // Chats the welcome screen should offer, and one it should not.
  const recentA = await seedChat(`Where we left off ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "hi there" }]);
  await seedChat(`Archived away ${RUN}`, [{ role: "user", content: "old" }, { role: "assistant", content: "gone" }], { archived: true });
  await seedChat(`Empty ${RUN}`, []);

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("header button", { hasText: /mock-/ }).first().waitFor({ timeout: 10000 });

  // --- 45: the welcome screen ------------------------------------------------------
  await page.locator("button", { hasText: "New chat" }).first().click();
  const welcome = page.locator("[data-welcome]");
  await welcome.waitFor({ timeout: 5000 });
  const greeting = (await welcome.locator("[data-greeting]").innerText()).trim();
  check("an empty chat greets you for the hour", /^(Good morning|Good afternoon|Good evening|Working late\?)$/.test(greeting), greeting);
  const recentIds = await welcome.locator("[data-recent-chat]").evaluateAll((els) => els.map((e) => e.getAttribute("data-recent-chat")));
  check("it offers where you left off", recentIds.includes(recentA.id) && recentIds.length <= 4, `${recentIds.length} chats`);
  const listed = await welcome.locator("[data-welcome-recent]").innerText();
  check("not archived or empty chats", !listed.includes(`Archived away ${RUN}`) && !listed.includes(`Empty ${RUN}`));
  check("with how long ago and how long", /just now|\dm ago|\dh ago|\dd ago/.test(listed) && /\d+ msg/.test(listed));
  check("and things to try", (await welcome.getByText("Build a bouncing ball animation").count()) === 1);
  await page.screenshot({ path: `${OUT}/extras-welcome.png` });
  await welcome.locator(`[data-recent-chat="${recentA.id}"]`).click();
  await page.getByText("hi there").first().waitFor({ timeout: 5000 });
  check("choosing one opens it", (await page.locator("[data-welcome]").count()) === 0);

  await page.locator("button", { hasText: "New chat" }).first().click();
  await welcome.waitFor();
  await welcome.locator('[data-quick-action="search"]').click();
  check("Search chats puts the cursor in the search", await page.evaluate(() => document.activeElement?.hasAttribute("data-chat-search")));
  await welcome.locator('[data-quick-action="pictures"]').click();
  await page.locator('[role="dialog"][aria-label="Pictures"]').waitFor({ timeout: 3000 });
  check("Pictures opens the gallery", true);
  await page.keyboard.press("Escape");
  await welcome.locator('[data-quick-action="saved"]').click();
  await page.locator('[role="dialog"][aria-label="Saved messages"]').waitFor({ timeout: 3000 });
  check("Saved messages opens them", true);
  await page.keyboard.press("Escape");
  await welcome.locator('[data-quick-action="shortcuts"]').click();
  await page.locator("[data-shortcuts]").waitFor({ timeout: 3000 });
  check("Keyboard shortcuts lists them", true);
  await page.keyboard.press("Escape");
  check("a voice action is there too", (await welcome.locator('[data-quick-action="voice"]').count()) === 1);
  await axe("dark, the welcome screen");
  await theme("light");
  await page.locator("button", { hasText: "New chat" }).first().click();
  await welcome.waitFor();
  await axe("light, the welcome screen");
  await theme("dark");

  // --- 44: scheduled-task templates ----------------------------------------------------
  let dialog = await openSettings();
  const templates = dialog.locator("[data-schedule-templates]");
  await templates.scrollIntoViewIfNeeded();
  check("the schedule offers templates", (await templates.locator("[data-template]").count()) >= 5);
  await templates.locator('[data-template="morning-briefing"]').click();
  const form = templates.locator('[data-template-form="morning-briefing"]');
  check("choosing one asks only what it needs, with a default time", (await form.locator("[data-template-time]").inputValue()) === "08:00" && (await form.locator("[data-template-field]").count()) === 1);
  await form.locator("[data-template-time]").fill("07:15");
  await form.locator('[data-template-field="topic"]').fill(`rust ${RUN}`);
  await page.screenshot({ path: `${OUT}/extras-template.png` });
  await form.locator("[data-template-submit]").click();
  await page.waitForFunction(() => !document.querySelector("[data-template-form]"), null, { timeout: 5000 });
  let tasks = (await json("/api/schedule")).tasks;
  const made = tasks.find((t) => t.label === `Morning briefing — rust ${RUN}`);
  if (made) madeTasks.push(made.id);
  check("it is scheduled", Boolean(made));
  check("daily, at the time asked", made?.when === "daily at 07:15", made?.when);
  check("with a prompt that carries the topic, written for JARVIS to read aloud", made?.prompt.includes(`headlines about rust ${RUN}`) && made?.prompt.includes("read aloud"));
  check("and the list shows it", (await dialog.getByText(`Morning briefing — rust ${RUN}`).count()) === 1);

  await templates.locator('[data-template="reminder"]').click();
  const reminder = templates.locator('[data-template-form="reminder"]');
  await reminder.locator("[data-template-submit]").click();
  check("a required field must be filled in", (await reminder.count()) === 1 && (await json("/api/schedule")).tasks.every((t) => !t.label.startsWith("Remind:")));
  await reminder.locator('[data-template-field="what"]').fill(`stretch ${RUN}`);
  await reminder.locator("[data-template-submit]").click();
  await page.waitForFunction(() => !document.querySelector("[data-template-form]"), null, { timeout: 5000 });
  tasks = (await json("/api/schedule")).tasks;
  const remind = tasks.find((t) => t.label === `Remind: stretch ${RUN}`);
  if (remind) madeTasks.push(remind.id);
  check("a reminder is made from what you typed", Boolean(remind) && remind.prompt === `Remind me to stretch ${RUN}. One short sentence.`);

  await templates.locator('[data-template="water"]').click();
  const water = templates.locator('[data-template-form="water"]');
  check("a repeating one asks how often, and says it costs a request", (await water.locator("[data-template-minutes]").inputValue()) === "120" && (await water.innerText()).includes("spends one request"));
  await water.locator("[data-template-minutes]").fill("90");
  await water.locator("[data-template-submit]").click();
  await page.waitForFunction(() => !document.querySelector("[data-template-form]"), null, { timeout: 5000 });
  const drink = (await json("/api/schedule")).tasks.find((t) => t.label === "Drink water" && t.when === "every 90 minutes");
  if (drink) madeTasks.push(drink.id);
  check("every 90 minutes, as asked", Boolean(drink));
  await templates.locator('[data-template="water"]').click();
  await templates.locator("[data-template-form] button", { hasText: "Cancel" }).last().click();
  check("a template can be backed out of", (await templates.locator("[data-template-form]").count()) === 0);
  await axe("dark, Settings with templates and backups");
  await dialog.getByRole("button", { name: "Close" }).click();

  // --- 49: daily backups -----------------------------------------------------------------------
  dialog = await openSettings();
  const backups = dialog.locator("[data-auto-backups]");
  await backups.scrollIntoViewIfNeeded();
  const statusText = await backups.locator("[data-backup-status]").innerText();
  check("Settings says daily backups are on, and how many are kept", /once a day/.test(statusText) && /last 7 kept/.test(statusText), statusText.slice(0, 90));
  check("and says where, and what is left out", /backups/.test(statusText) && /without pictures/.test(statusText));
  await backups.locator("[data-backup-now]").click();
  const note = backups.locator("[data-backup-note]");
  await note.waitFor({ timeout: 20000 });
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const todayName = `jarvis-auto-${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.zip`;
  check("Back up now makes today's", (await note.innerText()).includes(todayName), await note.innerText());
  check("and lists it", (await backups.locator(`[data-backup="${todayName}"]`).count()) === 1);
  const [download] = await Promise.all([page.waitForEvent("download"), backups.locator(`[data-backup="${todayName}"] a`).click()]);
  const zipPath = `${OUT}/extras-backup.zip`;
  await download.saveAs(zipPath);
  const zip = readFileSync(zipPath);
  check("the download is a zip, named as it was", zip.readUInt32LE(0) === 0x04034b50 && download.suggestedFilename() === todayName);
  const text = zip.toString("latin1");
  check("holding the chats and how to restore them", text.includes("RESTORE.txt") && text.includes(`data/chats/${recentA.id}.json`));
  check("but not the backups folder itself, nor pictures", !text.includes("data/backups/") && !text.includes("data/images/"));
  const auto = await json("/api/backup/auto");
  check("the API reports it", auto.enabled && auto.keep === 7 && auto.backups.some((b) => b.name === todayName && b.size > 100));
  check("a second one on the same day replaces rather than adds", (await (await send("/api/backup/auto", "POST", {})).json()).backups.filter((b) => b.name === todayName).length === 1);
  check("only names of exactly that shape can be fetched", (await Promise.all(["..%2F..%2Fetc%2Fpasswd", "notes.txt", "jarvis-auto-2026-01-01.zip.partial", "jarvis-auto-9999-99-99.zip"].map((n) => fetch(`${BASE}/api/backup/auto/${n}`).then((r) => r.status)))).every((s) => s === 404));
  check("making one wants application/json", (await fetch(`${BASE}/api/backup/auto`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" })).status === 415);
  await dialog.getByRole("button", { name: "Close" }).click();

  // --- 48: usage as CSV ------------------------------------------------------------------------------
  // Make sure there is something to export, even against a server that has just started.
  await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }], provider: "groq", model: "mock-fast-8b", useTools: false }),
  }).then((r) => r.text());
  await rail().locator('button[title="Usage"]').click();
  const usage = page.locator('[role="dialog"][aria-label="Usage"]');
  await usage.waitFor();
  const csvLink = usage.locator("[data-usage-csv]");
  check("Usage offers the tally as a CSV", (await csvLink.count()) === 1);
  const [csvDownload] = await Promise.all([page.waitForEvent("download"), csvLink.click()]);
  check("named for the day", /^jarvis-usage-\d{4}-\d{2}-\d{2}\.csv$/.test(csvDownload.suggestedFilename()), csvDownload.suggestedFilename());
  const csvPath = `${OUT}/extras-usage.csv`;
  await csvDownload.saveAs(csvPath);
  const csv = readFileSync(csvPath, "utf8").split(/\r?\n/);
  check("with a header row", csv[0] === "date_utc,provider,provider_name,requests,ok,rate_limited,failed,tokens_sent_estimated,last_request_utc,last_error", csv[0]);
  const direct = await fetch(`${BASE}/api/usage?format=csv`);
  check("served as text/csv", (direct.headers.get("content-type") ?? "").startsWith("text/csv"));
  check("one row per provider per day, with real counts", csv.length > 1 && csv.slice(1).filter(Boolean).every((l) => /^\d{4}-\d{2}-\d{2},[\w:-]+,[^,]+,\d+,\d+,\d+,\d+,\d+,/.test(l)), csv[1]);

  // --- 50: chat statistics ---------------------------------------------------------------------------------
  const before = await json(`/api/stats?days=30&tz=${new Date().getTimezoneOffset()}`);
  const toolRound = (name, isError = false) => ({ round: 1, calls: [{ id: "c1", name, arguments: "{}" }], results: [{ toolCallId: "c1", name, content: "x", isError, ms: 5 }] });
  await seedChat(`Stats ${RUN}`, [
    { role: "user", content: "one two three" },
    { role: "assistant", content: "four five six seven", model: "stats-model", toolRounds: [toolRound("calculate"), toolRound("calculate"), toolRound("zz_tool", true)] },
    { role: "user", content: "eight" },
  ]);
  const after = await json(`/api/stats?days=30&tz=${new Date().getTimezoneOffset()}`);
  check("the API counts the new chat", after.chats.total === before.chats.total + 1 && after.messages.total === before.messages.total + 3);
  check("words, by who wrote them", after.words.user === before.words.user + 4 && after.words.assistant === before.words.assistant + 4);
  const toolOf = (s, n) => s.tools.find((t) => t.name === n) ?? { calls: 0, errors: 0 };
  check("tools, with their failures", toolOf(after, "calculate").calls === toolOf(before, "calculate").calls + 2 && toolOf(after, "zz_tool").errors === 1);
  check("today's bar went up by what was written", after.perDay.at(-1).messages === before.perDay.at(-1).messages + 3);
  check("it covers thirty days", after.perDay.length === 30);

  await usage.locator('[data-usage-tab="chats"]').click();
  const stats = usage.locator("[data-chat-stats]");
  await stats.waitFor({ timeout: 5000 });
  check("the Chats tab shows the totals", (await stats.locator('[data-stat="Chats"]').innerText()).includes(String(after.chats.total)) && (await stats.locator('[data-stat="Messages"]').innerText()).includes(after.messages.total.toLocaleString()));
  check("a bar for each of thirty days", (await stats.locator("[data-day]").count()) === 30);
  check("today's bar is today's count", Number(await stats.locator("[data-day]").last().getAttribute("data-count")) === after.perDay.at(-1).messages);
  check("the chart is described for a screen reader, with the numbers in a table", (await stats.locator('[data-day-chart]').getAttribute("aria-label"))?.includes("messages over the last 30 days") && (await stats.locator("table.sr-only tbody tr").count()) === 30);
  check("tools used are listed with counts and failures", /calculate/.test(await stats.locator("[data-tool-stats]").innerText()) && /1 failed/.test(await stats.locator("[data-tool-stats]").innerText()));
  check("and the models that answered", (await stats.locator("[data-model-stats]").innerText()).includes("stats-model"));
  await page.screenshot({ path: `${OUT}/extras-stats.png` });
  check("the CSV link belongs to the providers tab", (await usage.locator("[data-usage-csv]").count()) === 0);
  await usage.locator('[data-usage-tab="chats"]').press("ArrowLeft");
  check("the arrow keys move between the tabs", (await usage.locator('[data-usage-tab="providers"]').getAttribute("aria-selected")) === "true");
  await usage.locator('[data-usage-tab="chats"]').click();
  await axe("dark, chat statistics");
  await page.keyboard.press("Escape");
  await theme("light");
  await rail().locator('button[title="Usage"]').click();
  await page.locator('[data-usage-tab="chats"]').click();
  await page.locator("[data-chat-stats]").waitFor();
  await axe("light, chat statistics");
  await page.keyboard.press("Escape");
  await theme("dark");

  // --- 46: the gallery ---------------------------------------------------------------------------------------------
  const original = seedPicture(`a lighthouse at dawn ${RUN}`);
  const edit1 = seedPicture(`make it night ${RUN}`, { editedFrom: original });
  const edit2 = seedPicture(`add a ship ${RUN}`, { editedFrom: edit1 });
  const stranger = seedPicture(`a red bicycle ${RUN}`);
  const orphan = seedPicture(`an edit of something deleted ${RUN}`, { editedFrom: "00000000-0000-4000-8000-deadbeef0000" });
  await page.reload({ waitUntil: "networkidle" });
  await rail().locator('button[title="Pictures"]').click();
  const gallery = page.locator('[role="dialog"][aria-label="Pictures"]');
  await gallery.locator(`[data-picture="${original}"]`).waitFor({ timeout: 5000 });
  const tile = (id) => gallery.locator(`[data-picture="${id}"]`);
  await tile(original).hover();
  await tile(original).locator("[data-copy-prompt]").click();
  check("Copy prompt copies the picture's prompt", (await page.evaluate(() => navigator.clipboard.readText())) === `a lighthouse at dawn ${RUN}`);
  check("and says it did", (await tile(original).locator("[data-copy-prompt] svg.lucide-check").count()) === 1);
  check("an original with edits says how many", (await tile(original).locator("[data-show-edits]").innerText()) === "1 edit");
  check("an edit says it came from an earlier picture", (await tile(edit1).locator("[data-show-original]").count()) === 1);
  check("an edit of an edit has both", (await tile(edit1).locator("[data-show-edits]").count()) === 1 && (await tile(edit2).locator("[data-show-original]").count()) === 1);
  check("an unrelated picture has neither", (await tile(stranger).locator("[data-lineage]").count()) === 0);
  check("an edit of a deleted picture says so", (await tile(orphan).innerText()).includes("Original deleted"));
  await tile(original).locator("[data-show-edits]").click();
  await gallery.locator("[data-family-banner]").waitFor();
  const family = await gallery.locator("[data-picture]").evaluateAll((els) => els.map((e) => e.getAttribute("data-picture")));
  check("the family is the original and everything made from it, oldest first", JSON.stringify(family) === JSON.stringify([original, edit1, edit2]), family.join(","));
  check("and says how many", (await gallery.locator("[data-family-banner]").innerText()).includes("3 pictures from the same original"));
  await page.screenshot({ path: `${OUT}/extras-gallery-family.png` });
  await axe("dark, a picture family");
  await gallery.locator("[data-family-clear]").click();
  check("Show all brings the rest back", (await gallery.locator(`[data-picture="${stranger}"]`).count()) === 1 && (await gallery.locator("[data-family-banner]").count()) === 0);
  await tile(edit2).locator("[data-show-original]").click();
  check("starting from an edit shows the same family", (await gallery.locator("[data-picture]").count()) === 3);
  await gallery.locator("[data-family-clear]").click();
  await page.keyboard.press("Escape");
  await theme("light");
  await rail().locator('button[title="Pictures"]').click();
  await page.locator('[role="dialog"][aria-label="Pictures"]').waitFor();
  await axe("light, the gallery with pictures");
  await page.keyboard.press("Escape");

  check("no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  for (const id of madeChats) {
    await send(`/api/chats/${id}`, "DELETE", {}).catch(() => {});
    await fetch(`${BASE}/api/trash?id=${id}`, { method: "DELETE" }).catch(() => {});
  }
  for (const id of madeTasks) await fetch(`${BASE}/api/schedule?id=${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of madePictures) await fetch(`${BASE}/api/images/${id}`, { method: "DELETE" }).catch(() => {});
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
