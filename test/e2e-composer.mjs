/**
 * Messages and the composer, in a real browser: timestamps, response stats,
 * saved messages, folding long ones, table CSV, code download, drafts, the up
 * arrow, slash commands, saved prompts, and reading a reply aloud.
 * Same setup as test/e2e.mjs (mock provider + a server pointed at it).
 *
 * Seeds one chat of its own and removes every chat it made.
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const OUT = process.env.SHOT_DIR ?? "/tmp";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36).slice(-5);

let failed = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
};
const json = (path) => fetch(`${BASE}${path}`).then((r) => r.json());
const send = (path, method, body) =>
  fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// A chat that exists before the run, older than the one under test, so that
// after a reload the app opens the chat under test and not this one.
const { chat: other } = await (await send("/api/chats", "POST", { title: `Other chat ${RUN}` })).json();
await send(`/api/chats/${other.id}`, "PATCH", {
  messages: [{ id: `${other.id}-1`, role: "user", content: "an older conversation", createdAt: Date.now() - 1000 }],
});
await new Promise((r) => setTimeout(r, 50));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
page.on("dialog", (d) => d.accept());

// Headless Chromium has no voice. A stand-in that records what it is asked to
// say and "finishes" after a moment lets read-aloud be tested for real: the
// Listen button, the markdown stripping, stopping on a second press.
await page.addInitScript(() => {
  // Runs in every frame, including the sandboxed code preview, where touching
  // localStorage is (rightly) forbidden — stay out of there.
  if (window.top !== window) return;
  window.__spoken = [];
  let timer;
  const synth = {
    speaking: false,
    speak(u) {
      window.__spoken.push(u.text);
      timer = setTimeout(() => u.onend && u.onend(new Event("end")), 1500);
    },
    cancel() { clearTimeout(timer); },
    getVoices: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  if (!localStorage.getItem("jarvis.settings.v1")) {
    localStorage.setItem("jarvis.settings.v1", JSON.stringify({ ttsEngine: "browser" }));
  }
});

const composer = () => page.getByLabel("Message");
// A reply is finished when it has been saved, not when the caret is absent —
// before the stream starts there is no caret either, and typing into a box
// whose last message is still on its way is exactly the race to avoid.
let asked = 0;
async function settled() {
  asked += 2;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const chat = (await json("/api/chats")).chats.find((c) => c.title.includes(`show me a table ${RUN}`));
    if (chat) {
      const full = (await json(`/api/chats/${chat.id}`)).chat;
      const last = full.messages[full.messages.length - 1];
      if (full.messages.length >= asked && last.role === "assistant" && last.content) break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForFunction(() => !document.querySelector(".streaming-caret"), null, { timeout: 20000 });
}

async function ask(text, waitFor) {
  await composer().fill(text);
  await page.keyboard.press("Enter");
  await page.getByText(waitFor).first().waitFor({ timeout: 20000 });
  await settled();
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByLabel("Message").waitFor({ timeout: 10000 });
  await page.locator("button", { hasText: "New chat" }).first().click();

  // --- 22: a table, copied as CSV ---
  await ask(`show me a table ${RUN}`, "Ada, Countess");
  const table = page.locator("table").first();
  await table.hover();
  await page.locator("[data-copy-csv]").first().click();
  const csv = await page.evaluate(() => navigator.clipboard.readText());
  const rows = csv.split("\r\n");
  check("a table copies as CSV with a header row", rows[0] === "Name,Score", rows[0]);
  check("a cell with a comma is quoted", rows[1] === '"Ada, Countess",10', rows[1]);
  check("a spreadsheet formula in a cell is neutralised", rows[2].startsWith(`"'=HYPERLINK(`), rows[2]);
  check("a negative number is left a number", rows[2].endsWith(",-5"), rows[2]);

  // --- 19 + 18: stats and timestamps ---
  const stats = await page.locator("[data-stats]").first().innerText();
  check("a reply shows how long it took", /\d+(\.\d)?m?s/.test(stats), stats);
  check("including the wait for the first word", /first word/.test(stats), stats);
  const stamp = page.locator("[data-message-time]").first();
  check("messages carry a time", /\d{1,2}:\d{2}/.test(await stamp.innerText()), await stamp.innerText());
  check("with the full date on hover", (await stamp.getAttribute("title"))?.length > 8);
  check("machine-readable too", !Number.isNaN(Date.parse(await stamp.getAttribute("datetime"))));

  // --- 23: code blocks ---
  await ask(`bouncing ball ${RUN}`, "runs standalone");
  const block = page.locator("[data-code-block]").first();
  await block.hover();
  const pre = block.locator("pre");
  check("long lines scroll by default", (await pre.getAttribute("class")).includes("overflow-x-auto"));
  await block.getByRole("button", { name: "Wrap" }).click();
  check("Wrap turns on wrapping", (await pre.getAttribute("class")).includes("whitespace-pre-wrap"));
  await block.getByRole("button", { name: "Wrap" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), block.locator("[data-code-download]").click()]);
  check("Download saves it under the name in its first-line comment", download.suggestedFilename() === "bounce.html", download.suggestedFilename());

  // --- 20: saved messages ---
  const chatId = (await json("/api/chats")).chats.find((c) => c.title.includes(`show me a table ${RUN}`)).id;
  const before = (await json("/api/chats")).chats.find((c) => c.id === chatId).updatedAt;
  const reply = page.locator("div.group", { hasText: "runs standalone" }).first();
  await reply.hover();
  await reply.getByRole("button", { name: "Save" }).click();
  await reply.getByRole("button", { name: "Saved" }).waitFor({ timeout: 5000 });
  check("a message can be saved", true);
  await page.waitForTimeout(400);
  const after = (await json("/api/chats")).chats.find((c) => c.id === chatId).updatedAt;
  check("saving isn't activity: the chat keeps its place", before === after, `${before} vs ${after}`);
  const starred = await json("/api/starred");
  check("it is listed by the API", starred.items.some((i) => i.chatId === chatId));
  // The sidebar's link, not the message's own "Saved" toggle, which also matches.
  await page.locator('aside[aria-label="Chats"]').getByRole("button", { name: /Saved/ }).click();
  const saved = page.locator('[role="dialog"][aria-label="Saved messages"]');
  await saved.locator("[data-saved-list]").waitFor({ timeout: 5000 });
  check("the Saved panel shows it, with its chat", (await saved.innerText()).includes("show me a table"));
  await page.screenshot({ path: `${OUT}/composer-saved.png` });
  await saved.getByRole("button").filter({ hasText: "show me a table" }).first().click();
  await page.waitForFunction(() => document.querySelector(".flash"), null, { timeout: 5000 });
  check("opening one jumps to the message and flashes it", true);

  // --- 21: a long message is folded ---
  const longText = Array.from({ length: 30 }, (_, i) => `line ${i + 1} of a pasted log ${RUN}`).join("\n");
  await composer().fill(longText);
  await page.keyboard.press("Enter");
  await page.getByText(`line 30 of a pasted log`).first().waitFor({ timeout: 20000 });
  await settled();
  const folded = page.locator("[data-collapsed='true']");
  check("a 30-line message is folded", (await folded.count()) === 1);
  await page.getByRole("button", { name: /Show all \(30 lines\)/ }).click();
  check("and opens on request", (await page.locator("[data-collapsed='true']").count()) === 0);
  check("the button then offers to fold it again", (await page.getByRole("button", { name: "Show less" }).count()) === 1);
  check("short messages are never folded", (await page.locator("div.group", { hasText: `show me a table ${RUN}` }).locator("[data-collapsed]").count()) === 0);

  // --- 25: the up arrow ---
  await ask(`the last short message ${RUN}`, "runs standalone");
  await composer().click();
  await page.keyboard.press("ArrowUp");
  check("up recalls the last message", (await composer().inputValue()) === `the last short message ${RUN}`);
  await page.keyboard.press("ArrowUp");
  const second = await composer().inputValue();
  check("and up again, the one before", second.startsWith("line 1 of a pasted log"), JSON.stringify(second.slice(0, 40)));
  await page.keyboard.press("ArrowDown");
  check("down comes back", (await composer().inputValue()) === `the last short message ${RUN}`);
  await page.keyboard.press("ArrowDown");
  const last = await composer().inputValue();
  check("and finally to an empty box", last === "", JSON.stringify(last.slice(0, 40)));
  await composer().fill("typed, not recalled");
  await page.keyboard.press("ArrowUp");
  check("up never steals a cursor from text being typed", (await composer().inputValue()) === "typed, not recalled");
  await composer().fill("");

  // --- 24: drafts ---
  await composer().fill(`half-written ${RUN}`);
  await page.locator("[data-chat-row]").filter({ has: page.getByText(`Other chat ${RUN}`, { exact: true }) }).first().click({ position: { x: 20, y: 10 } });
  await page.getByText("an older conversation").first().waitFor({ timeout: 10000 });
  check("another chat has its own, empty, box", (await composer().inputValue()) === "");
  await page.locator("[data-chat-row]").filter({ has: page.getByText(`show me a table ${RUN}`, { exact: true }) }).first().click({ position: { x: 20, y: 10 } });
  await page.getByText("Ada, Countess").first().waitFor({ timeout: 10000 });
  check("coming back, the half-written message is there", (await composer().inputValue()) === `half-written ${RUN}`);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Ada, Countess").first().waitFor({ timeout: 10000 });
  check("and it survives a reload", (await composer().inputValue()) === `half-written ${RUN}`);
  await composer().fill("");

  // --- 26: slash commands ---
  await composer().fill("/");
  const menu = page.locator("[data-slash-menu]");
  await menu.waitFor({ timeout: 3000 });
  check("a slash opens a menu of commands", (await menu.getByRole("option").count()) >= 6);
  await page.screenshot({ path: `${OUT}/composer-slash.png` });
  await page.keyboard.type("summ");
  check("it narrows as you type", (await menu.getByRole("option").count()) === 1);
  await page.keyboard.press("Enter");
  check("a text command fills the box and doesn't send", (await composer().inputValue()).startsWith("Summarize our conversation"));
  const sentBefore = (await json(`/api/chats/${chatId}`)).chat.messages.length;
  await composer().fill("");
  await composer().fill("/usr/bin/env is missing");
  check("a file path opens no menu", (await page.locator("[data-slash-menu]").count()) === 0);
  await page.keyboard.press("Enter");
  await page.getByText("/usr/bin/env is missing").first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector(".streaming-caret"), null, { timeout: 20000 });
  // The save lands just after the stream ends.
  let sentAfter = 0;
  for (let i = 0; i < 20 && sentAfter !== sentBefore + 2; i++) {
    sentAfter = (await json(`/api/chats/${chatId}`)).chat.messages.length;
    if (sentAfter !== sentBefore + 2) await page.waitForTimeout(150);
  }
  check("and is sent as the ordinary message it is", sentAfter === sentBefore + 2, `${sentBefore} -> ${sentAfter}`);
  await composer().fill("/pin");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  check("/pin pins this chat", (await json("/api/chats")).chats.find((c) => c.id === chatId).pinned === true);
  await composer().fill("/pin");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  check("and again unpins it", !(await json("/api/chats")).chats.find((c) => c.id === chatId).pinned);
  check("a command leaves the box empty", (await composer().inputValue()) === "");
  await composer().fill("/new");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("h1")?.textContent?.includes("JARVIS Mark 6"), null, { timeout: 5000 });
  check("/new starts a new chat", true);

  // --- 27: saved prompts ---
  await page.locator('button[title="Settings"]').first().click();
  const settings = page.locator("div.fixed", { hasText: "Settings" }).first();
  const editor = settings.locator("[data-prompts-editor]");
  await editor.getByRole("button", { name: "Add" }).click();
  await editor.getByLabel("Prompt name").fill("new");
  await editor.getByLabel("Prompt text").fill("anything");
  check("a name that is a built-in command is flagged", (await editor.innerText()).includes("taken by a built-in command"));
  await editor.getByLabel("Prompt name").fill("Code Review");
  await editor.getByLabel("Prompt name").blur();
  check("a name is tidied when you leave the field", (await editor.getByLabel("Prompt name").inputValue()) === "code-review");
  await editor.getByLabel("Prompt text").fill("Review this code for bugs, then for clarity.");
  await settings.getByRole("button", { name: /^Save$/ }).click();
  await composer().fill("/code");
  await page.locator("[data-slash-menu]").waitFor({ timeout: 3000 });
  check("a saved prompt appears in the menu, marked as one", /prompt/i.test(await page.locator("[data-slash-menu]").innerText()));
  await page.keyboard.press("Enter");
  check("choosing it puts its text in the box", (await composer().inputValue()) === "Review this code for bugs, then for clarity.");
  await composer().fill("/code-review the login flow");
  await page.keyboard.press("Enter");
  check("words after it are added", (await composer().inputValue()) === "Review this code for bugs, then for clarity.\n\nthe login flow");
  await composer().fill("");
  const saved2 = await page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.settings.v1")).prompts);
  check("it is kept in settings", saved2.length === 1 && saved2[0].name === "code-review");

  // --- 28: read aloud ---
  await page.locator("[data-chat-row]").filter({ has: page.getByText(`show me a table ${RUN}`, { exact: true }) }).first().click({ position: { x: 20, y: 10 } });
  const target = page.locator("div.group", { hasText: "Here's a bouncing ball" }).first();
  await target.waitFor({ timeout: 10000 });
  await target.hover();
  await target.getByRole("button", { name: "Listen" }).click();
  await target.getByRole("button", { name: "Stop" }).waitFor({ timeout: 5000 });
  check("Listen starts reading, and offers Stop", true);
  const spoken = await page.evaluate(() => window.__spoken.join(" "));
  check("what is read is the words, not the markdown or the code", spoken.includes("bouncing ball") && !spoken.includes("```") && !spoken.includes("<html"), spoken.slice(0, 60));
  await page.screenshot({ path: `${OUT}/composer-listen.png` });
  await target.getByRole("button", { name: "Stop" }).click();
  await target.getByRole("button", { name: "Listen" }).waitFor({ timeout: 5000 });
  check("a second press stops it", true);
  await target.getByRole("button", { name: "Listen" }).click();
  await target.getByRole("button", { name: "Stop" }).waitFor({ timeout: 5000 });
  await target.getByRole("button", { name: "Listen" }).waitFor({ timeout: 15000 });
  check("and left alone, it finishes by itself", true);

  // --- phone ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no horizontal overflow at 390px", overflow === 0, `${overflow}px`);
} finally {
  const list = (await json("/api/chats")).chats;
  const mine = list.filter((c) => c.title.includes(RUN));
  for (const c of mine) {
    await send(`/api/chats/${c.id}`, "DELETE").catch(() => {});
    await fetch(`${BASE}/api/trash?id=${c.id}`, { method: "DELETE" }).catch(() => {});
  }
}

check("no console or page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
