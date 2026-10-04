/**
 * Emotion and initiative, in a real browser: the mood dot, cards that suggest and
 * interrupt (and every way to make them stop), the focus timer, the inbox,
 * results from the server, tone matching, follow-up buttons, "Remember that?",
 * and 👍/👎 — each with an axe scan in both themes. Same setup as
 * test/e2e.mjs (mock provider + a server pointed at it), plus the server's
 * data folder, because a result "from the server" is put there the way a
 * finished scheduled task would put it:
 *   JARVIS_DATA_DIR=<the folder the server was started with> npm run test:initiative
 *
 * Seeds its own chats and notes and removes every one it made. One check waits
 * for the real scheduler (it wakes once a minute), so the whole run takes a
 * minute and a half.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const OUT = process.env.SHOT_DIR ?? "/tmp";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DATA = process.env.JARVIS_DATA_DIR ?? "data";
const RUN = Date.now().toString(36).slice(-5);
const AXE = new URL("../node_modules/axe-core/axe.min.js", import.meta.url).pathname;
const KEY = "jarvis.initiative.v1";
const MIN = 60_000;

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

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const errors = [];

/** A fresh tab whose initiative storage starts as `seed` (merged over the defaults). Once per tab: reloads keep what the app saved. */
async function openApp(seed = {}, { reuse } = {}) {
  const page = reuse ?? (await context.newPage());
  if (!reuse) {
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });
    page.on("dialog", (d) => d.accept());
    await page.addInitScript(([k, v]) => {
      // Runs in every frame, including the sandboxed code preview, where storage throws.
      try {
        if (!sessionStorage.getItem("seeded")) {
          localStorage.setItem(k, v);
          sessionStorage.setItem("seeded", "1");
        }
      } catch {
        /* a frame with no storage has nothing to seed */
      }
    }, [KEY, JSON.stringify(seed)]);
  }
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("header button", { hasText: /mock-/ }).first().waitFor({ timeout: 10000 });
  return page;
}

const composer = (page) => page.locator("#message-input");
const msgCount = (page) => page.locator("[data-msg]").count();
async function say(page, text) {
  const before = await msgCount(page);
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await page.waitForFunction(
    (n) => document.querySelectorAll("[data-msg]").length >= n && !document.querySelector(".streaming-caret") && /finished/.test(document.querySelector("[data-reply-status]")?.textContent ?? ""),
    before + 2,
    { timeout: 20000 },
  );
}
const mood = (page) => page.locator("[data-mood]").getAttribute("data-mood");
const toast = (page, rule) => page.locator(`[data-nudges] [data-nudge="${rule}"]`);
const badge = async (page) => (await page.locator("[data-inbox-badge]").count()) ? (await page.locator("[data-inbox-badge]").innerText()).trim() : "";
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "{}"), KEY);

async function openSettings(page) {
  await page.locator('button[title="Settings"]').first().click();
  const dialog = page.locator('[role="dialog"][aria-labelledby="settings-title"]');
  await dialog.waitFor({ timeout: 5000 });
  return dialog;
}

async function axe(page, label) {
  if ((await page.evaluate(() => typeof window.axe)) === "undefined") await page.addScriptTag({ path: AXE });
  await page.addStyleTag({ content: "[data-msg] .opacity-0 { opacity: 1 !important } *, *::before, *::after { transition: none !important; animation: none !important; }" });
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
/** Both themes, without a reload (a reload would take the card on screen away). */
async function axeBoth(page, label) {
  for (const t of ["dark", "light"]) {
    await page.evaluate((v) => document.documentElement.setAttribute("data-theme", v), t);
    await axe(page, `${t}, ${label}`);
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
}

/** Enough text in the message box that the next request is almost full. */
async function nearlyFull(page) {
  const meter = page.locator("[data-context-meter]");
  await meter.waitFor({ timeout: 5000 });
  const limit = Number(await meter.getAttribute("aria-valuemax"));
  const baseline = Number(await meter.getAttribute("aria-valuenow"));
  await composer(page).fill("x".repeat(Math.round((limit - baseline) * 4 * 0.9)));
  await page.waitForFunction(() => document.querySelector("[data-context-meter]")?.getAttribute("data-level") === "warn", null, { timeout: 3000 });
}

const memoryTexts = async () => (await json("/api/memory")).entries.map((e) => e.text);
async function cleanMemory() {
  for (const e of (await json("/api/memory")).entries) {
    if (/Dana|Rowan/.test(e.text)) await fetch(`${BASE}/api/memory?id=${e.id}`, { method: "DELETE" }).catch(() => {});
  }
}

const inboxFile = `${DATA}/inbox.json`;
const inboxBefore = existsSync(inboxFile) ? readFileSync(inboxFile, "utf8") : null;

try {
  // --- 51: the mood dot, and what the defaults are --------------------------------
  const chatA = await seedChat(`Mood ${RUN}`, [{ role: "user", content: "hello there" }, { role: "assistant", content: "Hi — what shall we work on today?" }]);
  let page = await openApp();
  check("the bar is there: mood, focus timer and inbox", (await page.locator("[data-initiative-bar] [data-mood]").count()) === 1 && (await page.locator("[data-focus-button]").count()) === 1 && (await page.locator("[data-inbox-button]").count()) === 1);
  check("a quiet start is calm, with no badge", (await mood(page)) === "calm" && (await badge(page)) === "");
  const label = await page.locator("[data-mood]").getAttribute("aria-label");
  check("the mood is read out as a summary, not a feeling", /^Mood: calm\. Nothing in particular\.$/.test(label ?? ""), label ?? "");
  check("and the tooltip says so", /not a feeling/.test((await page.locator("[data-mood]").getAttribute("title")) ?? ""));

  const settings = await openSettings(page);
  const section = settings.locator("[data-initiative-settings]");
  await section.scrollIntoViewIfNeeded();
  check("the defaults are the gentle ones: on, balanced", (await section.locator('[data-initiative-switch="enabled"]').isChecked()) && (await section.locator('[data-choice="level"] [data-value="balanced"]').getAttribute("aria-checked")) === "true");
  check("no desktop notifications and no speech until asked for", !(await section.locator('[data-initiative-switch="desktop"]').isChecked()) && !(await section.locator('[data-initiative-switch="speak"]').isChecked()));
  check("quiet hours are on, 22:30 to 07:00", (await section.locator('[data-initiative-switch="quiet-hours"]').isChecked()) && (await section.locator("[data-quiet-from]").inputValue()) === "22:30" && (await section.locator("[data-quiet-to]").inputValue()) === "07:00");
  check("every kind of suggestion starts on", (await section.locator('[data-initiative-switch^="rule-"]:checked').count()) === 7);
  check("it says plainly that nothing is sent for you", /never sends\s+anything for you/.test(await section.innerText()));
  await axeBoth(page, "Settings with the Initiative section");
  await page.keyboard.press("Escape");

  // --- 60: 👍 and 👎 ---------------------------------------------------------------
  await say(page, "write a function that adds two numbers");
  const lastReply = () => page.locator("[data-msg]").last();
  await lastReply().hover();
  await lastReply().locator('[data-react="up"]').click();
  await page.waitForFunction(() => document.querySelector("[data-mood]")?.getAttribute("data-mood") === "pleased", null, { timeout: 3000 });
  check("a 👍 makes it pleased", (await mood(page)) === "pleased");
  check("and marks the reply", (await lastReply().locator('[data-reaction-mark="up"]').count()) === 1 && (await lastReply().locator('[data-react="up"]').getAttribute("aria-pressed")) === "true");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-msg]").last().waitFor();
  check("the rating survives a reload, and so does the mood", (await lastReply().locator('[data-reaction-mark="up"]').count()) === 1 && (await mood(page)) === "pleased");
  check("it is counted under stats", (await json("/api/stats")).reactions.up >= 1);
  await lastReply().hover();
  await lastReply().locator('[data-react="up"]').click();
  check("pressing it again takes it back", (await lastReply().locator("[data-reaction-mark]").count()) === 0);
  check("taking it back doesn't change the mood", (await mood(page)) === "pleased");

  // --- 58: follow-up buttons ----------------------------------------------------------
  const chips = page.locator("[data-suggestions] [data-suggestion]");
  check("a code reply offers follow-ups", (await chips.count()) >= 2, String(await chips.count()));
  const countBefore = await msgCount(page);
  await chips.first().click();
  const filled = await composer(page).inputValue();
  check("pressing one fills the message box", filled.length > 5, filled);
  await page.waitForTimeout(300);
  check("and sends nothing", (await msgCount(page)) === countBefore);
  check("with the cursor after the text", (await page.evaluate(() => document.activeElement?.id === "message-input" && document.activeElement.selectionStart === document.activeElement.value.length)));
  await composer(page).fill("");
  await axeBoth(page, "a reply with follow-ups and a rating");
  await page.locator('[data-suggestions] button[aria-label="Hide suggestions"]').click();
  check("they can be hidden", (await page.locator("[data-suggestions]").count()) === 0);
  await say(page, "ask me a question about it");
  check("a reply that ends in a question gets none", (await page.locator("[data-suggestions]").count()) === 0);
  await say(page, "write a function that subtracts");
  check("a later reply gets its own", (await page.locator("[data-suggestions] [data-suggestion]").count()) >= 2);
  await page.close();

  // --- 60: a 👎 from a settled start --------------------------------------------------
  await seedChat(`Down ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Here is a long enough answer for the buttons to appear under it." }]);
  page = await openApp();
  await page.locator("[data-msg]").last().hover();
  await page.locator("[data-msg]").last().locator('[data-react="down"]').click();
  await page.waitForFunction(() => document.querySelector("[data-mood]")?.getAttribute("data-mood") === "apologetic", null, { timeout: 3000 });
  check("a 👎 makes it sorry", (await mood(page)) === "apologetic" && /Mood: sorry/.test((await page.locator("[data-mood]").getAttribute("aria-label")) ?? ""));
  check("and the reply is marked", (await page.locator('[data-reaction-mark="down"]').count()) === 1);
  await page.locator("button:has-text('New chat')").first().click();
  await page.waitForFunction(() => document.querySelector("[data-mood]")?.getAttribute("data-mood") !== "apologetic", null, { timeout: 3000 });
  check("a new chat is a fresh start, halfway back to calm", (await mood(page)) !== "apologetic");
  await page.close();

  // --- 57: matching your tone -----------------------------------------------------------
  await seedChat(`Tone ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi there — how can I help you today with this project?" }]);
  page = await openApp();
  await say(page, "this is broken again, it never works!!!");
  check("a frustrated message reaches the server as guidance: the reply is direct", /\(direct\)/.test(await page.locator("[data-msg]").last().innerText()));
  check("it makes things a little busier", ["focused", "calm"].includes(await mood(page)));
  await say(page, "ok that is better, thanks!");
  check("a thank-you is noticed", ["pleased", "focused", "calm"].includes(await mood(page)));
  await say(page, "I need this ASAP, deadline is today");
  check("a rushed message gets the short route", /\(short\)/.test(await page.locator("[data-msg]").last().innerText()));
  await say(page, "I feel so hopeless today");
  check("a low message gets the gentle one", /\(gentle\)/.test(await page.locator("[data-msg]").last().innerText()));
  check("and no follow-up buttons after it", (await page.locator("[data-suggestions]").count()) === 0);
  const s1 = await stored(page);
  check("it holds cards back for hours afterwards", s1.distressUntil > Date.now() + 90 * MIN, `${Math.round((s1.distressUntil - Date.now()) / MIN)} min`);
  check("and the tone isn't stored anywhere", !JSON.stringify(s1).includes("hopeless") && !JSON.stringify(s1).includes("broken again"));
  // Distress, in the same way — the words are a test fixture for the safety posture.
  await say(page, "I want to die");
  check("a message about self-harm gets the gentle reply", /\(gentle\)/.test(await page.locator("[data-msg]").last().innerText()));
  const s2 = await stored(page);
  check("and a longer quiet: six hours", s2.distressUntil > Date.now() + 5.5 * 60 * MIN, `${Math.round((s2.distressUntil - Date.now()) / MIN)} min`);
  // A card that would otherwise appear is held back.
  const dlg = await openSettings(page);
  await dlg.locator("[data-initiative-test]").click();
  check("a card is held in the inbox rather than put in front of someone who just said that", /Held in the inbox instead \(quiet after a hard message\)/.test(await dlg.locator("[data-initiative-note]").innerText()));
  // Turned off, tone isn't read.
  await dlg.locator('[data-initiative-switch="adapt-tone"]').uncheck();
  await page.keyboard.press("Escape");
  await say(page, "this is ridiculous, it still doesn't work");
  check("with 'Match my tone' off, nothing is read or sent", !/\(direct\)/.test(await page.locator("[data-msg]").last().innerText()));
  await page.close();

  // --- 59: "Remember that?" ---------------------------------------------------------------
  await cleanMemory();
  await seedChat(`Remember ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi there — how can I help you today with this project?" }]);
  page = await openApp();
  await say(page, "My name is Dana, by the way");
  await toast(page, "remember-offer").waitFor({ timeout: 16000 });
  check("a lasting fact is offered to memory after the reply", (await toast(page, "remember-offer").innerText()).includes("User's name is Dana"));
  check("nothing is saved until you press it", !(await memoryTexts()).some((t) => t.includes("Dana")));
  check("the card doesn't take focus", (await page.evaluate(() => !document.activeElement?.closest("[data-nudges]"))));
  await axeBoth(page, "a card with two buttons");
  await toast(page, "remember-offer").locator('[data-nudge-action="remember"]').first().click();
  await page.locator("text=Remembered.").first().waitFor({ timeout: 5000 });
  check("pressing Remember saves it", (await memoryTexts()).includes("User's name is Dana"));
  check("and the card goes", (await toast(page, "remember-offer").count()) === 0);
  await page.close();

  // Pressing it for a fact already known doesn't add a second note.
  const dup = await send("/api/memory", "POST", { text: "User's name is Dana", dedupe: true });
  check("the same fact again is noted as already known", (await dup.json()).duplicate === true && (await memoryTexts()).filter((t) => t === "User's name is Dana").length === 1);
  await send("/api/memory", "POST", { text: "User's name is Dana", dedupe: true, tags: ["always"] });
  check("asking to always keep it in mind pins the existing note", (await json("/api/memory")).entries.find((e) => e.text === "User's name is Dana").tags.includes("always"));
  await cleanMemory();

  // --- 52 & 53: cards that suggest, and the way to say stop -------------------------------------
  await seedChat(`Long ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi there — how can I help you today with this project?" }]);
  page = await openApp();
  await nearlyFull(page);
  check("while you are typing, no card appears", (await toast(page, "long-chat").count()) === 0);
  await toast(page, "long-chat").waitFor({ timeout: 15000 });
  check("a nearly full chat suggests a summary — once you stop typing", (await toast(page, "long-chat").innerText()).includes("This chat is getting long"));
  const cardBox = await toast(page, "long-chat").boundingBox();
  const composerBox = await page.locator("[data-composer]").boundingBox();
  check("the card sits above the message box, never over it", cardBox.y + cardBox.height <= composerBox.y + 1, `card ends ${Math.round(cardBox.y + cardBox.height)}, box starts ${Math.round(composerBox.y)}`);
  await page.screenshot({ path: `${OUT}/initiative-card.png` });
  check("it is announced politely, not forced on you", (await page.locator("[data-nudges]").getAttribute("aria-live")) === "polite" && (await page.locator("[data-nudges]").getAttribute("role")) === "region");
  await axeBoth(page, "a suggestion card over the chat");
  await composer(page).fill("");
  const before = await msgCount(page);
  await toast(page, "long-chat").locator('[data-nudge-action="fill"]').click();
  check("'Summarise it' fills the box and doesn't send", (await composer(page).inputValue()).startsWith("Summarize our conversation") && (await msgCount(page)) === before);
  check("and the card goes", (await toast(page, "long-chat").count()) === 0);

  // Stop suggesting this.
  await composer(page).fill("");
  await page.close();
  await seedChat(`Mute ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi there — how can I help you today with this project?" }]);
  page = await openApp({ gate: { dismissals: { "long-chat": [Date.now() - 1000, Date.now() - 2000] } } });
  await nearlyFull(page);
  await toast(page, "long-chat").waitFor({ timeout: 15000 });
  await toast(page, "long-chat").locator("[data-nudge-dismiss]").click();
  await page.locator("text=you waved it away three times").first().waitFor({ timeout: 3000 });
  check("a third wave-away mutes that kind, and says so", (await stored(page)).gate.learnedMutes.includes("long-chat"));
  const set2 = await openSettings(page);
  const rule = set2.locator('[data-initiative-switch="rule-long-chat"]');
  check("Settings shows it stopped, and why", !(await rule.isChecked()) && /stopped because you waved it away/.test(await set2.locator("[data-initiative-settings]").innerText()));
  await set2.locator("[data-initiative-forget]").click();
  check("one button lets it back", (await rule.isChecked()) && (await stored(page)).gate.learnedMutes.length === 0);
  await rule.uncheck();
  check("a switch turns one kind off by hand", (await stored(page)).config.rules["long-chat"] === false);
  await rule.check();
  await page.keyboard.press("Escape");
  await page.close();

  // "Stop suggesting this" on the card itself.
  await seedChat(`Stop ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi there — how can I help you today with this project?" }]);
  page = await openApp();
  await nearlyFull(page);
  await toast(page, "long-chat").waitFor({ timeout: 15000 });
  await toast(page, "long-chat").locator("[data-nudge-mute]").click();
  await page.locator("text=Won't suggest").first().waitFor({ timeout: 3000 });
  check("'Stop suggesting this' turns the kind off", (await stored(page)).config.rules["long-chat"] === false);
  await composer(page).fill("");
  await page.close();

  // Escape and the clock.
  await seedChat(`Escape ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi there — how can I help you today with this project?" }]);
  page = await openApp();
  await nearlyFull(page);
  await toast(page, "long-chat").waitFor({ timeout: 15000 });
  await toast(page, "long-chat").locator("[data-nudge-action]").first().focus();
  await page.keyboard.press("Escape");
  check("Escape waves the focused card away", (await toast(page, "long-chat").count()) === 0 && (await stored(page)).gate.dismissals["long-chat"]?.length === 1);
  await page.close();

  // A card left alone goes by itself and waits, unread, in the inbox.
  await seedChat(`Timeout ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi there — how can I help you today with this project?" }]);
  page = await openApp();
  await nearlyFull(page);
  await toast(page, "long-chat").waitFor({ timeout: 15000 });
  await page.mouse.move(5, 5);
  await toast(page, "long-chat").waitFor({ state: "detached", timeout: 20000 });
  check("a card nobody touched goes by itself, and counts for nothing against its kind", !(await stored(page)).gate.dismissals["long-chat"]);
  check("but stays unread in the inbox", (await badge(page)) === "1");
  await page.close();

  // --- 52: provider trouble and welcome back ---------------------------------------------------------
  await seedChat(`Trouble ${RUN}`, [
    { role: "user", content: "one" }, { role: "assistant", content: "", error: "429 rate limited", provider: "groq", model: "mock-fast-8b" },
    { role: "user", content: "two" }, { role: "assistant", content: "", error: "429 rate limited", provider: "groq", model: "mock-fast-8b" },
  ]);
  page = await openApp();
  await toast(page, "provider-trouble").waitFor({ timeout: 12000 });
  check("two failures in a row are noticed", (await toast(page, "provider-trouble").innerText()).includes("mock-fast-8b keeps failing"));
  check("with nowhere else to go, it says so rather than offer nothing", /No other model is ready/.test(await toast(page, "provider-trouble").innerText()));
  check("a card with no button has 'Got it'", (await toast(page, "provider-trouble").locator("[data-nudge-ok]").count()) === 1);
  await page.close();

  const welcomeChat = await seedChat(`Welcome ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi there — how can I help you today with this project?" }]);
  page = await openApp({ lastSeen: Date.now() - 6 * 60 * MIN });
  await toast(page, "welcome-back").waitFor({ timeout: 12000 });
  check("after hours away it says welcome back, naming the chat", (await toast(page, "welcome-back").innerText()).includes(`Welcome ${RUN}`));
  await toast(page, "welcome-back").locator('[data-nudge-action="open-chat"]').click();
  check("'Pick it up' in the chat that is already open offers a recap", (await composer(page).inputValue()) === "Where did we leave off? Give me a quick recap.");
  await composer(page).fill("");
  await page.close();

  // --- 54 & 55: focus, and what it holds back ---------------------------------------------------------------
  await seedChat(`Focus ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi there — how can I help you today with this project?" }]);
  page = await openApp();
  await page.locator("[data-focus-button]").click();
  await axeBoth(page, "the focus timer menu");
  await page.locator('[data-focus-start="15"]').click();
  check("starting focus shows a countdown", (await page.locator("[data-focus-button]").getAttribute("data-focus-active")) === "true" && /^1[45]:\d\d$/.test((await page.locator("[data-focus-clock]").innerText()).trim()));
  await page.waitForFunction(() => /^Focus: 1[45] minutes left$/.test(document.querySelector("[data-focus-button]")?.getAttribute("aria-label") ?? ""), null, { timeout: 3000 }).catch(() => {});
  check("the button says how long is left, in words", /^Focus: 1[45] minutes left$/.test((await page.locator("[data-focus-button]").getAttribute("aria-label")) ?? ""), (await page.locator("[data-focus-button]").getAttribute("aria-label")) ?? "");
  await nearlyFull(page);
  await page.waitForTimeout(11000);
  check("during focus nothing pops up", (await page.locator("[data-nudges] [data-nudge]").count()) === 0);
  check("the card is waiting behind a badge instead", (await badge(page)) === "1" && /Inbox, 1 unread/.test((await page.locator("[data-inbox-button]").getAttribute("aria-label")) ?? ""));
  await composer(page).fill("");
  await page.locator("[data-inbox-button]").click();
  const inbox = page.locator("[data-inbox]");
  await inbox.waitFor();
  check("the inbox lists it, marked new, with its buttons still working", (await inbox.locator('[data-inbox-card="long-chat"]').count()) === 1 && /new/i.test(await inbox.locator('[data-inbox-card="long-chat"]').innerText()) && (await inbox.locator('[data-inbox-action="fill"]').count()) === 1);
  check("and says it was held back", /Held back for later/.test(await inbox.locator('[data-inbox-card="long-chat"]').innerText()));
  await axeBoth(page, "the inbox with a held suggestion");
  await inbox.locator('[data-inbox-action="fill"]').click();
  check("a held card's button works from the inbox, and the inbox closes", (await composer(page).inputValue()).startsWith("Summarize our conversation") && (await page.locator("[data-inbox]").count()) === 0);
  check("closing it read what was in it", (await badge(page)) === "");
  await composer(page).fill("");
  await page.locator("[data-focus-button]").click();
  await page.locator("[data-focus-end]").click();
  check("focus can be ended by hand", (await page.locator("[data-focus-button]").getAttribute("data-focus-active")) === null);
  await page.close();

  // The timer running out says so.
  await seedChat(`Focus over ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi there — how can I help you today with this project?" }]);
  page = await openApp({ focus: { startedAt: Date.now() - 25 * MIN, until: Date.now() + 9000 } });
  check("a focus timer that is running is still running after a reload", (await page.locator("[data-focus-button]").getAttribute("data-focus-active")) === "true");
  await toast(page, "focus-over").waitFor({ timeout: 15000 });
  check("when it runs out, a card says so — yours, so it always appears", /Focus time's up/.test(await toast(page, "focus-over").innerText()));
  check("and the timer is over", (await page.locator("[data-focus-button]").getAttribute("data-focus-active")) === null);
  check("a card you asked for can't be muted — there is no 'stop suggesting'", (await toast(page, "focus-over").locator("[data-nudge-mute]").count()) === 0);
  await toast(page, "focus-over").locator('[data-nudge-action="open-inbox"]').click();
  await page.locator("[data-inbox]").waitFor();
  check("its button opens the inbox", true);
  await page.keyboard.press("Escape");
  await page.close();

  // --- 53: the controls --------------------------------------------------------------------------------------
  await seedChat(`Controls ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi there — how can I help you today with this project?" }]);
  page = await openApp();
  let d = await openSettings(page);
  const note = () => d.locator("[data-initiative-note]").innerText();
  await d.locator("[data-initiative-test]").click();
  check("a test card says it will wait while Settings is open — a card behind a dialog would be missed", /Waiting for a calm moment \(a dialog is open\)\. Close Settings and it will appear\./.test(await note()), await note());
  await page.keyboard.press("Escape");
  await toast(page, "inbox").waitFor({ timeout: 3000 });
  check("and appears bottom right", (await toast(page, "inbox").innerText()).includes("This is what a card looks like"));
  await toast(page, "inbox").locator("[data-nudge-action]").click();
  check("its button fills the message box with a line", (await composer(page).inputValue()).startsWith("Hello — this was filled in"));
  await composer(page).fill("");

  d = await openSettings(page);
  await d.locator('[data-choice="level"] [data-value="quiet"]').click();
  await d.locator("[data-initiative-test]").click();
  check("at 'Quiet', even a test card waits in the inbox", /Held in the inbox instead \(quiet level\)/.test(await note()));
  await d.locator('[data-choice="level"] [data-value="chatty"]').click();
  check("the choice is remembered", (await stored(page)).config.level === "chatty");
  await d.locator('[data-initiative-switch="enabled"]').uncheck();
  check("with the master switch off the level buttons are disabled", (await d.locator('[data-choice="level"] [data-value="chatty"]').isDisabled()));
  await d.locator("[data-initiative-test]").click();
  check("off means off: even this waits in the inbox", /Held in the inbox instead \(off\)/.test(await note()));
  await d.locator('[data-initiative-switch="enabled"]').check();
  await d.locator('[data-choice="level"] [data-value="balanced"]').click();

  await d.locator("[data-quiet-from]").fill("21:15");
  await d.locator("[data-quiet-to]").fill("06:30");
  await d.locator('[data-initiative-switch="quiet-hours"]').uncheck();
  check("quiet hours can be changed or turned off", (await stored(page)).config.quietHours.on === false && (await stored(page)).config.quietHours.from === "21:15" && (await stored(page)).config.quietHours.to === "06:30");
  check("and the times can't be edited while it is off", await d.locator("[data-quiet-from]").isDisabled());
  await d.locator('[data-initiative-switch="quiet-hours"]').check();

  await d.locator('[data-initiative-switch="desktop"]').click();
  await page.waitForTimeout(500);
  check("desktop notifications need the browser's permission, and say so when it is refused", !(await d.locator('[data-initiative-switch="desktop"]').isChecked()) && /didn't allow notifications|can't show desktop/.test(await note()), await note());
  // The browser's answer, as it would be if the person had said yes.
  await page.evaluate(() => Object.defineProperty(Notification, "permission", { get: () => "granted", configurable: true }));
  await d.locator('[data-initiative-switch="desktop"]').click();
  await page.waitForTimeout(500);
  check("with permission it turns on", (await stored(page)).config.desktop === true);
  await d.locator('[data-initiative-switch="desktop"]').uncheck();

  await d.locator('[data-initiative-switch="mood"]').uncheck();
  check("the mood dot can be hidden", (await page.locator("[data-mood]").count()) === 0);
  await d.locator('[data-initiative-switch="mood"]').check();
  await d.locator('[data-initiative-switch="follow-ups"]').uncheck();
  check("follow-up buttons can be turned off", (await page.locator("[data-suggestions]").count()) === 0);
  await d.locator('[data-initiative-switch="follow-ups"]').check();
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "networkidle" });
  check("settings survive a reload", (await stored(page)).config.quietHours.from === "21:15" && (await stored(page)).config.level === "balanced");
  await page.close();

  // --- 56: what the server has to say ---------------------------------------------------------------------------
  await seedChat(`Server ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi there — how can I help you today with this project?" }]);
  const now = Date.now();
  mkdirSync(DATA, { recursive: true });
  writeFileSync(inboxFile, JSON.stringify({ items: [
    { id: `e2e-a-${RUN}`, at: now - 2000, kind: "scheduled", title: `Morning briefing ${RUN}`, body: "Three things today:\n1. Ship the batch\n2. Water the plants\n3. Call back", read: false },
    { id: `e2e-b-${RUN}`, at: now - 1000, kind: "backup", title: "Daily backup failed", body: "The disk is full.", read: false },
  ] }));
  page = await openApp();
  await toast(page, "inbox").first().waitFor({ timeout: 8000 });
  check("a result from the server interrupts, as a card", (await page.locator('[data-nudges] [data-nudge="inbox"]').count()) === 2);
  check("with its title and what it said", /Daily backup failed/.test(await page.locator("[data-nudges]").innerText()) && /Morning briefing/.test(await page.locator("[data-nudges]").innerText()));
  check("and the badge counts both", (await badge(page)) === "2");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  check("after a reload they aren't announced a second time", (await page.locator('[data-nudges] [data-nudge="inbox"]').count()) === 0);
  check("but are still in the inbox, unread", (await badge(page)) === "2");
  await page.locator("[data-inbox-button]").click();
  const box = page.locator("[data-inbox]");
  await box.waitFor();
  check("the inbox has both, scheduled and backup, with the full text", (await box.locator('[data-inbox-item="scheduled"]').count()) === 1 && (await box.locator('[data-inbox-item="backup"]').count()) === 1 && /Water the plants/.test(await box.innerText()));
  check("marked new while you read", (await box.getByText("New", { exact: true }).count()) >= 2);
  await axeBoth(page, "the inbox with results from the server");
  await page.screenshot({ path: `${OUT}/initiative-inbox.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("closing it marks them read, here and on the server", (await badge(page)) === "" && (await json("/api/inbox")).unread === 0);
  await page.locator("[data-inbox-button]").click();
  await box.locator('[data-inbox-clear-server]').click();
  await page.waitForFunction(() => document.querySelector("[data-inbox-empty]"), null, { timeout: 4000 });
  check("clearing empties it, and the empty inbox says what it is for", /scheduled task finishes/.test(await box.innerText()) && (await json("/api/inbox")).items.length === 0);
  await page.keyboard.press("Escape");
  await page.close();

  // The real thing: a scheduled task, run by the scheduler, lands in the inbox.
  const made = await send("/api/schedule", "POST", { kind: "once", at: Date.now() + 2000, prompt: `Say hello for the inbox test ${RUN}`, label: `Inbox test ${RUN}` });
  const madeTask = (await made.json()).task;
  if (madeTask) madeTasks.push(madeTask.id);
  check("a task is scheduled", Boolean(madeTask));
  let arrived = null;
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline && !arrived) {
    await new Promise((r) => setTimeout(r, 3000));
    arrived = (await json("/api/inbox")).items.find((i) => i.kind === "scheduled" && i.title.includes(`Inbox test ${RUN}`));
  }
  check("when the scheduler runs it, the answer is waiting in the inbox", Boolean(arrived), arrived ? `${arrived.title}: ${arrived.body.slice(0, 40)}` : "nothing arrived in 100 seconds");
  check("and it can't be forged from a page: there is no way to add an item", (await send("/api/inbox", "POST", { action: "add", title: "x", body: "y" })).status === 400);
  await send("/api/inbox", "POST", { action: "clear" });

  // --- layout on a phone ------------------------------------------------------------------------------------------
  await seedChat(`Phone ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi there — how can I help you today with this project?" }]);
  page = await openApp();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload({ waitUntil: "networkidle" });
  check("on a phone the bar fits: nothing scrolls sideways", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  check("and the mood dot, timer and bell are all there", (await page.locator("[data-mood]").isVisible()) && (await page.locator("[data-focus-button]").isVisible()) && (await page.locator("[data-inbox-button]").isVisible()));
  await nearlyFull(page);
  await toast(page, "long-chat").waitFor({ timeout: 15000 });
  const rect = await toast(page, "long-chat").boundingBox();
  check("a card fits inside the screen", rect.x >= 0 && rect.x + rect.width <= 390, JSON.stringify(rect));
  const phoneComposer = await page.locator("[data-composer]").boundingBox();
  check("and, on a phone too, above the message box", rect.y + rect.height <= phoneComposer.y + 1, `card ends ${Math.round(rect.y + rect.height)}, box starts ${Math.round(phoneComposer.y)}`);
  await page.screenshot({ path: `${OUT}/initiative-mobile.png` });
  await composer(page).fill("");
  await page.close();

  check("no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  for (const id of madeChats) {
    await send(`/api/chats/${id}`, "DELETE", {}).catch(() => {});
    await fetch(`${BASE}/api/trash?id=${id}`, { method: "DELETE" }).catch(() => {});
  }
  for (const id of madeTasks) await fetch(`${BASE}/api/schedule?id=${id}`, { method: "DELETE" }).catch(() => {});
  await cleanMemory();
  if (inboxBefore !== null) writeFileSync(inboxFile, inboxBefore);
  else await send("/api/inbox", "POST", { action: "clear" }).catch(() => {});
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
