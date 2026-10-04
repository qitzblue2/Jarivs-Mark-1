/**
 * Keeping things tidy, in a real browser: remembering from a message, memory
 * that expires, adding many facts and merging duplicates, notes and colour
 * labels on chats, sorting and compacting the chat list, and seeing where the
 * disk space goes — each with an axe scan in both themes. Same setup as
 * test/e2e.mjs (mock provider + a server pointed at it), plus the mock's log
 * to see what memory the model was actually given:
 *   npm run test:organising
 *
 * Seeds its own chats and memory and removes every one it made.
 */
import { readFileSync } from "node:fs";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const OUT = process.env.SHOT_DIR ?? "/tmp";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36).slice(-5);
const AXE = new URL("../node_modules/axe-core/axe.min.js", import.meta.url).pathname;
const MOCK_LOG = new URL("./.mock.log", import.meta.url).pathname;

let failed = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
};
const json = (path) => fetch(`${BASE}${path}`).then((r) => r.json());
const send = (path, method, body) => fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const made = [];
async function seedChat(title, messages, patch = {}) {
  const { chat } = await (await send("/api/chats", "POST", { title })).json();
  made.push(chat.id);
  await send(`/api/chats/${chat.id}`, "PATCH", { messages: messages.map((m, i) => ({ id: `${chat.id}-${i}`, createdAt: Date.now() + i, ...m })), ...patch });
  await new Promise((r) => setTimeout(r, 30));
  return chat;
}
const memories = async () => (await json("/api/memory")).entries;
async function cleanMemory() {
  for (const e of await memories()) if (e.text.includes(RUN)) await fetch(`${BASE}/api/memory?id=${e.id}`, { method: "DELETE" }).catch(() => {});
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const errors = [];
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });
page.on("dialog", (d) => d.accept());

async function axe(label) {
  if ((await page.evaluate(() => typeof window.axe)) === "undefined") await page.addScriptTag({ path: AXE });
  await page.addStyleTag({ content: "[data-msg] .opacity-0 { opacity: 1 !important } *, *::before, *::after { transition: none !important; animation: none !important; }" });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(" ")} :: ${(n.any[0] ?? n.all[0] ?? n.none[0])?.message ?? ""}`.slice(0, 220)) }));
  });
  for (const v of violations) console.log(`     axe [${v.impact}] ${v.id}: ${v.help}\n${v.nodes.map((n) => `        ${n}`).join("\n")}`);
  check(`axe finds nothing to fix — ${label}`, violations.length === 0, violations.length ? `${violations.length} rule(s) violated` : "");
}
async function axeBoth(label) {
  for (const t of ["dark", "light"]) {
    await page.evaluate((v) => document.documentElement.setAttribute("data-theme", v), t);
    await axe(`${t}, ${label}`);
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
}
async function open() {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("header button", { hasText: /mock-/ }).first().waitFor({ timeout: 10000 });
  await page.locator("[data-msg]").first().waitFor({ timeout: 5000 });
}
const banner = async (re) => {
  await page.waitForFunction((src) => new RegExp(src).test(document.querySelector("main div.bg-warn\\/10")?.textContent ?? ""), re.source, { timeout: 5000 }).catch(() => {});
  return (await page.locator("main div.bg-warn\\/10").first().innerText().catch(() => "")).trim();
};
async function openSettings() {
  await page.locator('button[title="Settings"]').first().click();
  const dialog = page.locator('[role="dialog"][aria-labelledby="settings-title"]');
  await dialog.waitFor({ timeout: 5000 });
  return dialog;
}
const composer = () => page.locator("#message-input");
const rail = () => page.locator('aside[aria-label="Chats"]');
const mockLogTail = () => readFileSync(MOCK_LOG, "utf8").trim().split("\n").filter((l) => l.includes("[mock] model=")).at(-1) ?? "";

try {
  await cleanMemory();
  const chat = await seedChat(`Organising ${RUN}`, [
    { role: "user", content: "What should I know about the trip?" },
    { role: "assistant", content: `Pack light and bring a charger. The ferry leaves at nine. Tickets cost twenty pounds each. Ref ${RUN}.`, model: "mock-fast-8b" },
  ]);
  await open();

  // --- 81: remember from a message ------------------------------------------------------------------
  const reply = page.locator('[data-msg][data-role="assistant"]').first();
  await reply.hover();
  await reply.locator("[data-remember]").click();
  const dlg = page.locator("[data-remember-dialog]");
  await dlg.waitFor();
  check("Remember opens a dialog offering the start of the message, as one plain line", (await dlg.locator("[data-remember-text]").inputValue()) === `Pack light and bring a charger. The ferry leaves at nine. Tickets cost twenty pounds each. Ref ${RUN}.`);
  await axeBoth("the remember dialog");
  await page.keyboard.press("Escape");
  check("Escape closes it and saves nothing", (await page.locator("[data-remember-dialog]").count()) === 0 && !(await memories()).some((e) => e.text.includes(RUN)));
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('[data-msg][data-role="assistant"] p')][0];
    const node = p.firstChild;
    const range = document.createRange();
    const at = node.data.indexOf("The ferry");
    range.setStart(node, at);
    range.setEnd(node, at + "The ferry leaves at nine.".length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await reply.hover();
  await reply.locator("[data-remember]").click();
  await dlg.waitFor();
  check("with words selected, those are what is offered — pressing the button doesn't lose the selection", (await dlg.locator("[data-remember-text]").inputValue()) === "The ferry leaves at nine.", await dlg.locator("[data-remember-text]").inputValue());
  await dlg.locator("[data-remember-text]").fill(`The ferry leaves at nine (${RUN})`);
  await dlg.locator("[data-remember-always]").check();
  await dlg.locator("[data-remember-save]").click();
  check("saving keeps it, and says so", /Remembered — and kept in mind in every chat/.test(await banner(/Remembered/)));
  const saved = (await memories()).find((e) => e.text === `The ferry leaves at nine (${RUN})`);
  check("tagged 'always' because it was asked for", Boolean(saved) && saved.tags.includes("always"));
  await reply.hover();
  await reply.locator("[data-remember]").click();
  await dlg.locator("[data-remember-text]").fill(`The ferry leaves at nine (${RUN})`);
  await dlg.locator("[data-remember-save]").click();
  check("the same words again are noted as already known", /Already in memory/.test(await banner(/Already in memory/)) && (await memories()).filter((e) => e.text === `The ferry leaves at nine (${RUN})`).length === 1);
  await send(`/api/memory`, "POST", { id: saved.id, text: saved.text, tags: [] });

  // --- 83: memory that expires -----------------------------------------------------------------------------
  const day = 86_400_000;
  await send("/api/memory", "POST", { text: `Prefers metric units ${RUN}`, tags: ["always"] });
  await send("/api/memory", "POST", { text: `Prefers imperial units ${RUN}`, tags: ["always"], expires: Date.now() - day });
  await send("/api/memory", "POST", { text: `Is testing the build ${RUN}`, tags: ["always"], expires: Date.now() + 5 * day });
  const apiEntries = (await memories()).filter((e) => e.text.includes(RUN));
  check("an expiry is stored with the entry — and an edit of the words alone doesn't clear it", apiEntries.find((e) => e.text.startsWith("Is testing")).expires > Date.now());
  const testing = apiEntries.find((e) => e.text.startsWith("Is testing"));
  await send("/api/memory", "POST", { id: testing.id, text: testing.text + " v2" });
  check("(an edit that says nothing about expiry leaves it)", (await memories()).find((e) => e.id === testing.id).expires === testing.expires);
  await send("/api/memory", "POST", { id: testing.id, text: testing.text, expires: "soon" });
  check("(and one with nonsense for it leaves it too)", (await memories()).find((e) => e.id === testing.id).expires === testing.expires);
  await composer().fill("tell me about my units please");
  await composer().press("Enter");
  await page.waitForFunction(() => !document.querySelector(".streaming-caret") && /finished/.test(document.querySelector("[data-reply-status]")?.textContent ?? ""), null, { timeout: 20000 });
  const logged = mockLogTail();
  check("a fact that has run out is not given to the model, even pinned", /memory=\[.*Prefers metric units/.test(logged) && !/imperial/.test(logged), logged.slice(-200));
  check("one that hasn't, is", /Is testing the build/.test(logged));

  let dialog = await openSettings();
  const mem = dialog.locator("[data-memory]");
  await mem.scrollIntoViewIfNeeded();
  await mem.locator("[data-memory-search]").fill(RUN);
  const row = (text) => mem.locator("[data-memory-entry]", { hasText: text });
  check("the list flags what has expired, and says when the rest will", (await row("imperial").locator('[data-memory-expiry-label="expired"]').innerText()) === "(expired)" && /\(expires in [45] days\)/.test(await row("Is testing").locator("[data-memory-expiry-label]").innerText()));
  await axeBoth("memory with expiry labels");
  await row("imperial").hover();
  await row("imperial").getByRole("button", { name: /^Edit:/ }).click();
  const when = new Date(Date.now() + 30 * day);
  const dateText = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
  await mem.locator("[data-memory-expiry]").fill(dateText);
  await mem.getByRole("button", { name: "Save" }).click();
  await row("imperial").locator("[data-memory-expiry-label]").waitFor();
  check("a new date extends it", /\(expires in 3\d days\)/.test(await row("imperial").locator("[data-memory-expiry-label]").innerText()));
  await row("imperial").hover();
  await row("imperial").getByRole("button", { name: /^Edit:/ }).click();
  await mem.locator("[data-memory-expiry]").fill("");
  await mem.getByRole("button", { name: "Save" }).click();
  // Saved when the editing fields are gone — the row has no label while it is being edited, so "no label" alone proves nothing.
  await mem.locator("[data-memory-expiry]").waitFor({ state: "detached", timeout: 5000 });
  await page.waitForFunction((t) => ![...document.querySelectorAll("[data-memory-entry]")].find((e) => e.textContent.includes(t))?.querySelector("[data-memory-expiry-label]"), "imperial", { timeout: 3000 });
  check("clearing the date makes it last again", (await memories()).find((e) => e.text.includes("imperial")).expires === undefined);
  await mem.locator("[data-memory-search]").fill("");

  // --- 84: add many ---------------------------------------------------------------------------------------------------
  await mem.locator("[data-memory-bulk-toggle]").click();
  await mem.locator("[data-memory-bulk-text]").fill([`- Allergic to peanuts ${RUN} #Health`, `2. Walks the dog at seven ${RUN}`, "", `   * Keeps bees ${RUN}  `, `walks THE dog at seven ${RUN}`, `Prefers metric units ${RUN}`].join("\n"));
  await axeBoth("adding several facts");
  await mem.locator("[data-memory-bulk-add]").click();
  await mem.locator("[data-memory-note]").waitFor();
  check("each line is a fact; bullets and numbers go; what is already remembered or repeated is skipped, and it says so", /^Added 3 · 2 already remembered\.$/.test(await mem.locator("[data-memory-note]").innerText()), await mem.locator("[data-memory-note]").innerText());
  const bulk = (await memories()).filter((e) => e.text.includes(RUN));
  check("the tag at the end of a line became its tag", bulk.find((e) => e.text.startsWith("Allergic")).tags.includes("health") && bulk.find((e) => e.text.startsWith("Allergic")).text === `Allergic to peanuts ${RUN}`);
  check("and the box closes", (await mem.locator("[data-memory-bulk]").count()) === 0);
  const tooMany = await (await send("/api/memory", "POST", { bulk: Array.from({ length: 120 }, (_, i) => `bulk fact ${RUN} number ${i}`).join("\n") })).json();
  check("a hundred at a time, by the server too", tooMany.added === 100 && tooMany.skipped.overLimit === 20);
  for (const e of await memories()) if (e.text.startsWith("bulk fact")) await fetch(`${BASE}/api/memory?id=${e.id}`, { method: "DELETE" });

  // --- 82: duplicates ---------------------------------------------------------------------------------------------------
  await mem.locator("[data-memory-search]").fill("");
  await send("/api/memory", "POST", { text: `Lives in Cardiff near the bay ${RUN}`, tags: ["home"] });
  await send("/api/memory", "POST", { text: `  lives in CARDIFF near the bay ${RUN} `, tags: ["place"] });
  await page.keyboard.press("Escape");
  dialog = await openSettings();
  const mem2 = dialog.locator("[data-memory]");
  await mem2.scrollIntoViewIfNeeded();
  await mem2.locator("[data-memory-find-duplicates]").click();
  const groups = mem2.locator("[data-memory-dupe-group]");
  await groups.first().waitFor();
  check("duplicates are found — same words however they are spaced or capitalised", (await groups.count()) >= 1 && /Cardiff/i.test(await groups.first().innerText()));
  check("showing which wording is kept and which would go", (await groups.first().locator("p.line-through").count()) === 1);
  await axeBoth("the duplicates panel");
  await groups.first().locator("[data-memory-merge]").click();
  await page.waitForFunction(() => document.querySelector("[data-memory-note]")?.textContent?.includes("Merged"), null, { timeout: 5000 });
  const cardiff = (await memories()).filter((e) => /cardiff/i.test(e.text) && e.text.includes(RUN));
  check("merging leaves one entry, with both tags", cardiff.length === 1 && cardiff[0].tags.includes("home") && cardiff[0].tags.includes("place"), JSON.stringify(cardiff.map((c) => c.tags)));
  await mem2.locator("[data-memory-find-duplicates]").click();
  await page.waitForFunction(() => /No duplicates found/.test(document.querySelector("[data-memory-note]")?.textContent ?? "") || document.querySelector("[data-memory-dupe-group]"), null, { timeout: 3000 });
  await page.keyboard.press("Escape");

  // --- 85: notes -----------------------------------------------------------------------------------------------------------
  await page.locator("[data-chat-tools-button]").click();
  check("the tools menu has notes, none yet", (await page.locator('[data-tool="notes"]').count()) === 1 && !/written/.test(await page.locator('[data-tool="notes"]').innerText()));
  await page.locator('[data-tool="notes"]').click();
  const notes = page.locator("[data-chat-notes]");
  await notes.waitFor();
  check("the notes box starts empty and has the cursor", (await notes.locator("[data-notes-text]").inputValue()) === "" && (await page.evaluate(() => document.activeElement?.hasAttribute("data-notes-text"))));
  await notes.locator("[data-notes-text]").fill(`Decided: take the ferry.\nCheck the weather ${RUN}`);
  check("it counts what you've written", /^\d+ \/ 20,000$/.test((await notes.locator("[data-notes-count]").innerText()).trim()));
  await axeBoth("the chat notes dialog");
  await notes.locator("[data-notes-save]").click();
  check("saving says so", /Notes saved with this chat/.test(await banner(/Notes saved/)));
  await page.waitForTimeout(300);
  const stored = (await json(`/api/chats/${chat.id}`)).chat;
  check("they are stored with the chat", stored.notes === `Decided: take the ferry.\nCheck the weather ${RUN}`);
  check("the list knows the chat has notes, without carrying them", (await json("/api/chats")).chats.find((c) => c.id === chat.id).hasNotes === true && !JSON.stringify((await json("/api/chats")).chats).includes("take the ferry"));
  const md = await (await fetch(`${BASE}/api/chats/${chat.id}/export`)).text();
  const html = await (await fetch(`${BASE}/api/chats/${chat.id}/export?format=html`)).text();
  check("they are private: not in a Markdown or web-page export", !md.includes("take the ferry") && !html.includes("take the ferry"));
  await page.locator("[data-chat-tools-button]").click();
  check("the menu says they are written", /written/.test(await page.locator('[data-tool="notes"]').innerText()));
  await page.locator('[data-tool="notes"]').click();
  check("they come back when reopened", (await notes.locator("[data-notes-text]").inputValue()).startsWith("Decided: take the ferry."));
  await notes.locator("[data-notes-text]").fill("   ");
  await notes.locator("[data-notes-save]").click();
  await banner(/Notes cleared/);
  await page.waitForTimeout(300);
  check("blank notes clear them", (await json(`/api/chats/${chat.id}`)).chat.notes === undefined);
  check("a PATCH with notes that aren't text is refused", (await send(`/api/chats/${chat.id}`, "PATCH", { notes: 5 })).status === 400);

  // --- 86: colour labels ------------------------------------------------------------------------------------------------------
  const row1 = rail().locator(`[data-chat-row="${chat.id}"]`);
  await row1.hover();
  await row1.locator('button[title="More"]').click();
  const choices = page.locator("[data-color-choices]");
  await choices.waitFor();
  check("the chat menu offers six colours, none chosen", (await choices.locator("[data-color]").count()) === 6 && (await choices.locator('[aria-checked="true"]').count()) === 0);
  await axeBoth("the chat menu with colour labels");
  await choices.locator('[data-color="green"]').click();
  await page.waitForTimeout(400);
  check("choosing one marks the chat in the list, with a name for screen readers", (await row1.locator('[data-chat-color="green"]').getAttribute("aria-label")) === "Green label");
  check("and it is on the chat", (await json(`/api/chats/${chat.id}`)).chat.color === "green" && (await json("/api/chats")).chats.find((c) => c.id === chat.id).color === "green");
  await page.keyboard.press("Escape");
  await axeBoth("the chat list with a colour label");
  const branched = await (await send(`/api/chats/${chat.id}/branch`, "POST", {})).json();
  made.push(branched.chat.id);
  check("a copy keeps the colour", branched.chat.color === "green" && branched.chat.notes === undefined);
  await row1.hover();
  await row1.locator('button[title="More"]').click();
  check("the menu shows which is chosen, and choosing it again takes it off", (await choices.locator('[data-color="green"]').getAttribute("aria-checked")) === "true");
  await choices.locator('[data-color="green"]').click();
  await page.waitForTimeout(400);
  check("the dot goes", (await row1.locator("[data-chat-color]").count()) === 0 && (await json(`/api/chats/${chat.id}`)).chat.color === undefined);
  await page.keyboard.press("Escape");
  check("a colour that isn't one is refused", (await send(`/api/chats/${chat.id}`, "PATCH", { color: "mauve" })).status === 400);

  // --- 87 & 88: order and compact list --------------------------------------------------------------------------------------------
  const zed = await seedChat(`Zed ${RUN}`, [{ role: "user", content: "z" }, { role: "assistant", content: "z" }, { role: "user", content: "z" }, { role: "assistant", content: "z" }, { role: "user", content: "z" }, { role: "assistant", content: "z" }]);
  const alpha = await seedChat(`Alpha ${RUN}`, [{ role: "user", content: "a" }, { role: "assistant", content: "a" }]);
  await open();
  const order = () => rail().locator("[data-chat-row]").evaluateAll((rows) => rows.map((r) => r.querySelector("span.truncate")?.textContent ?? ""));
  const mine = async () => (await order()).filter((t) => t.endsWith(RUN));
  check("by default chats are grouped by day, newest first", (await rail().locator("[data-chat-section]").first().getAttribute("data-chat-section")) !== "sorted" && (await mine())[0].startsWith("Alpha"));
  await rail().locator("[data-sort-button]").click();
  const sortNow = await rail().locator("[data-sort-button]").getAttribute("data-sort-button");
  check("pressing it once goes from recent to oldest", sortNow === "oldest", sortNow ?? "");
  check("a flat list says how it is ordered", /oldest first/i.test(await rail().locator('[data-chat-section="sorted"]').innerText()));
  check("and no longer has day headings", (await rail().locator('[data-chat-section="Today"]').count()) === 0);
  const oldest = await mine();
  check("oldest first: the earlier of my chats comes first", oldest.indexOf(`Organising ${RUN}`) < oldest.indexOf(`Alpha ${RUN}`), oldest.join(" | "));
  await rail().locator("[data-sort-button]").click();
  const byTitle = await mine();
  check("by title, A to Z", byTitle.indexOf(`Alpha ${RUN}`) < byTitle.indexOf(`Organising ${RUN}`) && byTitle.indexOf(`Organising ${RUN}`) < byTitle.indexOf(`Zed ${RUN}`), byTitle.join(" | "));
  await rail().locator("[data-sort-button]").click();
  const longest = await mine();
  check("longest first", longest[0].startsWith("Zed"), longest.join(" | "));
  check("the choice is remembered across a reload", await (async () => { await page.reload({ waitUntil: "networkidle" }); return (await rail().locator("[data-sort-button]").getAttribute("data-sort-button")) === "messages"; })());
  await axeBoth("the chat list in a flat order");
  dialog = await openSettings();
  const prefs = dialog.locator("[data-prefs-settings]");
  await prefs.scrollIntoViewIfNeeded();
  check("Settings shows the same choice", (await prefs.locator('[data-choice="chatSort"] [data-value="messages"]').getAttribute("aria-checked")) === "true");
  await prefs.locator('[data-choice="chatSort"] [data-value="recent"]').click();
  check("and putting it back to recent returns the day groups", (await rail().locator('[data-chat-section="sorted"]').count()) === 0 && (await rail().locator('[data-chat-section="Today"]').count()) === 1);
  const secondLine = () => rail().locator(`[data-chat-row="${zed.id}"]`).innerText();
  check("each row shows its time and message count", /6 msg/.test(await secondLine()));
  await prefs.locator("[data-pref=compactList]").check();
  check("compact hides them, leaving the title", !/msg/.test(await secondLine()) && /Zed/.test(await secondLine()));
  await axeBoth("Settings with the chat list options");
  await prefs.locator("[data-pref=compactList]").uncheck();
  await page.keyboard.press("Escape");
  check("and unchecking brings them back", /6 msg/.test(await secondLine()));

  // --- 89 & 90: storage --------------------------------------------------------------------------------------------------------------
  const big = await seedChat(`Big ${RUN}`, [{ role: "user", content: "x".repeat(60_000) }, { role: "assistant", content: "ok" }]);
  const api = await json("/api/storage?largest=5");
  check("the storage API sizes each kind of thing", ["chats", "pictures", "trash", "backups", "memory", "other"].every((id) => api.rows.some((r) => r.id === id)) && api.totalBytes === api.rows.reduce((n, r) => n + r.bytes, 0) && api.rows.find((r) => r.id === "chats").bytes > 60_000);
  check("and lists the biggest chats, biggest first", api.largest[0].id === big.id && api.largest.length <= 5 && api.largest.every((c, i, a) => i === 0 || a[i - 1].bytes >= c.bytes));
  dialog = await openSettings();
  const storage = dialog.locator("[data-storage]");
  await storage.scrollIntoViewIfNeeded();
  await storage.locator('[data-storage-row="chats"]').waitFor();
  check("Settings shows each row with its size", /KB|MB/.test(await storage.locator('[data-storage-row="chats"] [data-storage-bytes]').innerText()) && (await storage.locator("[data-storage-row]").count()) === 6);
  check("a total, and the disk's free space", /in .*data/.test(await storage.locator("[data-storage-total]").innerText()) && /free on this disk/.test(await storage.locator("[data-storage-total]").innerText()));
  check("the biggest chat is at the top of its list", /Big /.test(await storage.locator("[data-storage-chat]").first().innerText()));
  await axeBoth("the storage view");
  await page.screenshot({ path: `${OUT}/organising-storage.png` });
  const bigRow = storage.locator(`[data-storage-chat="${big.id}"]`);
  await bigRow.locator("[data-storage-trash]").click();
  check("moving one to the trash asks first", (await bigRow.locator("[data-storage-confirm]").count()) === 1 && (await json("/api/chats")).chats.some((c) => c.id === big.id));
  await bigRow.locator("[data-storage-confirm]").click();
  await page.waitForFunction((id) => !document.querySelector(`[data-storage-chat="${id}"]`), big.id, { timeout: 5000 });
  check("then it is gone from the list and into the trash, where it can be restored", !(await json("/api/chats")).chats.some((c) => c.id === big.id) && (await json("/api/trash")).chats.some((c) => c.id === big.id));
  await page.keyboard.press("Escape");

  check("no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await cleanMemory();
  for (const id of made.filter(Boolean)) {
    await send(`/api/chats/${id}`, "DELETE", {}).catch(() => {});
    await fetch(`${BASE}/api/trash?id=${id}`, { method: "DELETE" }).catch(() => {});
  }
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
