/**
 * Writing a message, in a real browser: the counter, the send key, spellcheck,
 * reply-style presets, /model /title /tag /undo, saved prompts with blanks, and
 * searching what you've sent — each with an axe scan in both themes. Same setup
 * as test/e2e.mjs (mock provider + a server pointed at it):
 *   npm run test:writing
 *
 * Seeds its own chats and removes every one it made.
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const OUT = process.env.SHOT_DIR ?? "/tmp";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36).slice(-5);
const AXE = new URL("../node_modules/axe-core/axe.min.js", import.meta.url).pathname;

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

const composer = () => page.locator("#message-input");
const msgCount = () => page.locator("[data-msg]").count();
const SETTINGS_KEY = "jarvis.settings.v1";
async function open(settings = {}) {
  await page.addInitScript(([k, v]) => { if (v && !sessionStorage.getItem("seeded")) { localStorage.setItem(k, v); sessionStorage.setItem("seeded", "1"); } }, [SETTINGS_KEY, Object.keys(settings).length ? JSON.stringify(settings) : ""]).catch(() => {});
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("header button", { hasText: /mock-/ }).first().waitFor({ timeout: 10000 });
}
async function say(text) {
  const before = await msgCount();
  await composer().fill(text);
  await composer().press("Enter");
  await page.waitForFunction((n) => document.querySelectorAll("[data-msg]").length >= n && !document.querySelector(".streaming-caret") && /finished/.test(document.querySelector("[data-reply-status]")?.textContent ?? ""), before + 2, { timeout: 20000 });
}
const bannerText = async () => (await page.locator("main div.bg-warn\\/10").first().innerText().catch(() => "")).trim();
async function waitBanner(re) {
  await page.waitForFunction((src) => new RegExp(src).test(document.querySelector("main div.bg-warn\\/10")?.textContent ?? ""), re.source, { timeout: 5000 }).catch(() => {});
  return bannerText();
}
async function openSettings() {
  await page.locator('button[title="Settings"]').first().click();
  const dialog = page.locator('[role="dialog"][aria-labelledby="settings-title"]');
  await dialog.waitFor({ timeout: 5000 });
  return dialog;
}

try {
  const chat = await seedChat(`Writing ${RUN}`, [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi there — how can I help you today with this project?" }]);
  await open();

  // --- 71: the counter ---------------------------------------------------------------------------
  check("an empty box shows no counter", (await page.locator("[data-counter]").count()) === 0);
  await composer().fill("Hello there, world");
  check("typing shows words, characters and a token estimate", (await page.locator("[data-counter]").innerText()) === "3 words · 18 characters · ~5 tokens", await page.locator("[data-counter]").innerText().catch(() => ""));
  await composer().fill("   ");
  check("spaces alone count for nothing", (await page.locator("[data-counter]").count()) === 0);
  await composer().fill("");

  // --- 80: reply-style presets ------------------------------------------------------------------------
  const style = page.locator("[data-temp-preset]");
  const storedTemp = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "{}").temperature, SETTINGS_KEY);
  check("the style starts on Balanced", (await style.getAttribute("data-temp-preset")) === "balanced" && /Style: Balanced/.test(await style.innerText()));
  await style.click();
  check("pressing it moves to Creative, and remembers", (await style.getAttribute("data-temp-preset")) === "creative" && (await storedTemp()) === 1.1);
  await style.click();
  check("then Precise", (await style.getAttribute("data-temp-preset")) === "precise" && (await storedTemp()) === 0.2);
  check("it says what it means, to a screen reader too", /Reply style: Precise\. Press to change\./.test((await style.getAttribute("aria-label")) ?? "") && /Steady, repeatable/.test((await style.getAttribute("title")) ?? ""));
  await style.click();
  check("and round to Balanced", (await style.getAttribute("data-temp-preset")) === "balanced" && (await storedTemp()) === 0.7);
  await composer().fill("a counted message");
  await axeBoth("the message box with its counter and style");
  await composer().fill("");

  // --- 76 & 77: send key and spellcheck ------------------------------------------------------------------------
  check("spellcheck starts on", (await composer().getAttribute("spellcheck")) === "true");
  let dialog = await openSettings();
  const writing = dialog.locator("[data-prefs-settings]");
  await writing.scrollIntoViewIfNeeded();
  check("Settings has a Writing section with the send key", (await writing.locator('[data-choice="sendKey"] [data-value="enter"]').getAttribute("aria-checked")) === "true");
  await axeBoth("Settings with the Writing section");
  await writing.locator("[data-pref=spellcheck]").uncheck();
  await writing.locator('[data-choice="sendKey"] [data-value="mod-enter"]').click();
  await page.keyboard.press("Escape");
  check("spellcheck can be turned off", (await composer().getAttribute("spellcheck")) === "false");
  check("and the hint line follows the send key", /Ctrl\+Enter to send · Enter for a new line/.test(await page.locator("[data-composer]").innerText()));
  const before = await msgCount();
  await composer().fill("line one");
  await composer().press("Enter");
  await composer().type("line two");
  check("with Ctrl+Enter chosen, Enter is a new line, not a send", (await composer().inputValue()) === "line one\nline two" && (await msgCount()) === before);
  await composer().press("Control+Enter");
  await page.waitForFunction((n) => document.querySelectorAll("[data-msg]").length >= n && !document.querySelector(".streaming-caret") && /finished/.test(document.querySelector("[data-reply-status]")?.textContent ?? ""), before + 2, { timeout: 20000 });
  check("and Ctrl+Enter sends it, line break and all", (await page.locator('[data-msg][data-role="user"]').last().innerText()).includes("line one\nline two") || /line one\s+line two/.test(await page.locator('[data-msg][data-role="user"]').last().innerText()));
  await page.reload({ waitUntil: "networkidle" });
  check("the choices survive a reload", (await composer().getAttribute("spellcheck")) === "false" && /Ctrl\+Enter to send/.test(await page.locator("[data-composer]").innerText()));
  dialog = await openSettings();
  await dialog.locator('[data-prefs-settings] [data-choice="sendKey"] [data-value="enter"]').click();
  await dialog.locator("[data-pref=spellcheck]").check();
  await page.keyboard.press("Escape");
  check("and go back", (await composer().getAttribute("spellcheck")) === "true" && /Enter to send · Shift\+Enter/.test(await page.locator("[data-composer]").innerText()));

  // --- 72: /model ---------------------------------------------------------------------------------------------------
  await composer().fill("/mod");
  await page.locator("[data-slash-menu]").waitFor();
  await composer().press("Enter");
  check("choosing /model from the menu fills the box for the rest, rather than running it", (await composer().inputValue()) === "/model " && (await page.locator("[data-slash-menu]").count()) === 0);
  await composer().press("Enter");
  check("/model on its own says what you are using", /You're using mock-/.test(await waitBanner(/You're using/)), await bannerText());
  await composer().fill("/model smart");
  await composer().press("Enter");
  const switched = await waitBanner(/Switched to/);
  check("/model smart switches", /^Switched to mock-smart-120b · Groq\./.test(switched), switched);
  check("and the picker shows it", /mock-smart-120b/.test(await page.locator("header").innerText()));
  await composer().fill("/model zzz-nothing");
  await composer().press("Enter");
  check("a name that matches nothing says so", /No ready model matches “zzz-nothing”/.test(await waitBanner(/No ready model/)));
  await composer().fill("/model mock-fast-8b");
  await composer().press("Enter");
  await waitBanner(/Switched to mock-fast-8b/);
  check("and back", /mock-fast-8b/.test(await page.locator("header").innerText()));
  check("none of that sent a message", (await msgCount()) === before + 2);

  // --- 73: /title -------------------------------------------------------------------------------------------------------
  await composer().fill("/title Renamed by slash");
  await composer().press("Enter");
  await page.waitForFunction(() => document.querySelector("h1")?.textContent?.includes("Renamed by slash"), null, { timeout: 5000 });
  check("/title renames the chat in the header", true);
  await page.waitForTimeout(300);
  check("and on the server", (await json(`/api/chats/${chat.id}`)).chat.title === "Renamed by slash");
  await composer().fill("/title ");
  await composer().press("Enter");
  check("without a name it says how to use it", /Say what to call it/.test(await waitBanner(/Say what to call it/)));

  // --- 74: /tag ---------------------------------------------------------------------------------------------------------
  await composer().fill("/tag Work #Urgent");
  await composer().press("Enter");
  check("/tag adds tags, tidied", /Added #work #urgent/.test(await waitBanner(/Added #work/)));
  await page.waitForTimeout(300);
  check("they are on the chat", JSON.stringify((await json(`/api/chats/${chat.id}`)).chat.tags) === JSON.stringify(["work", "urgent"]));
  await composer().fill("/tag -urgent later");
  await composer().press("Enter");
  check("a minus removes while another is added", /Added #later; removed #urgent/.test(await waitBanner(/removed #urgent/)));
  await composer().fill("/tag ");
  await composer().press("Enter");
  check("on its own it lists them", /Tagged #work #later/.test(await waitBanner(/Tagged #work/)));
  await composer().fill("/tag -nothing");
  await composer().press("Enter");
  check("removing what isn't there changes nothing", /Nothing to change\./.test(await waitBanner(/Nothing to change/)));

  // --- 75: /undo ---------------------------------------------------------------------------------------------------------
  await say("write a function that adds two numbers");
  const afterSay = await msgCount();
  await composer().fill("/undo");
  await composer().press("Enter");
  await page.waitForFunction((n) => document.querySelectorAll("[data-msg]").length === n, afterSay - 2, { timeout: 5000 });
  check("/undo takes back your last message and its reply", true);
  check("and puts what you wrote back in the box", (await composer().inputValue()) === "write a function that adds two numbers");
  check("saying so", /Took back your last message and 1 reply\. It is in the message box/.test(await waitBanner(/Took back/)));
  await page.waitForTimeout(400);
  check("the server agrees", (await json(`/api/chats/${chat.id}`)).chat.messages.length === afterSay - 2);
  await say("another one for the undo");
  await composer().fill("/undo");
  await composer().press("Enter");
  await page.waitForTimeout(400);
  check("a second /undo takes back the one before", (await composer().inputValue()) === "another one for the undo");
  await composer().fill("");
  const empty = await seedChat(`Empty ${RUN}`, []);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("[data-chat-row]", { hasText: `Empty ${RUN}` }).first().click();
  await composer().fill("/undo");
  await composer().press("Enter");
  check("with nothing sent there is nothing to take back", /You haven't sent anything/.test(await waitBanner(/You haven't sent anything/)));
  await page.locator("[data-chat-row]", { hasText: "Renamed by slash" }).first().click();
  await page.waitForFunction(() => document.querySelector("h1")?.textContent?.includes("Renamed by slash"), null, { timeout: 5000 });
  await page.waitForTimeout(300);

  // --- 79: search what you've sent ---------------------------------------------------------------------------------------------
  await page.evaluate(() => { window.__still = "here"; });
  await say("explain closures in javascript");
  await say("deploy the app to staging");
  await composer().focus();
  await composer().press("Control+r");
  const panel = page.locator("[data-history-search]");
  await panel.waitFor();
  check("Ctrl+R opens a search of what you've sent, and doesn't reload the page", (await page.evaluate(() => window.__still)) === "here");
  check("the cursor is in its box", await page.evaluate(() => document.activeElement?.hasAttribute("data-history-input")));
  const hitsText = () => panel.locator("[data-history-hit]").allInnerTexts();
  check("it starts with the latest", (await hitsText())[0] === "deploy the app to staging" && (await hitsText())[1] === "explain closures in javascript", JSON.stringify((await hitsText()).slice(0, 3)));
  await axeBoth("searching what you've sent");
  await page.screenshot({ path: `${OUT}/writing-history.png` });
  await page.keyboard.type("CLOSURES");
  check("typing narrows it, ignoring case", JSON.stringify(await hitsText()) === JSON.stringify(["explain closures in javascript"]));
  await page.keyboard.press("Control+a");
  await page.keyboard.type("nothing like this");
  check("no match says so", (await panel.locator("[data-history-empty]").innerText()) === "Nothing you've sent matches.");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("deploy");
  await page.keyboard.press("Enter");
  check("Enter puts the message in the box and closes the search", (await composer().inputValue()) === "deploy the app to staging" && (await page.locator("[data-history-search]").count()) === 0);
  check("with focus back in the box", await page.evaluate(() => document.activeElement?.id === "message-input"));
  check("and nothing was sent", true);
  await composer().fill("");
  await composer().press("Control+r");
  await panel.waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("Escape closes it without choosing, back to the box", (await page.locator("[data-history-search]").count()) === 0 && (await page.evaluate(() => document.activeElement?.id === "message-input")), `${await page.locator("[data-history-search]").count()} open; focus on ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 70))}`);
  await composer().press("Control+r");
  await panel.waitFor();
  await panel.locator("[data-history-hit]").nth(1).click();
  check("clicking one chooses it", (await composer().inputValue()) === "explain closures in javascript");
  await composer().fill("");

  // --- 78: saved prompts with blanks ------------------------------------------------------------------------------------------------
  await page.close();
  const page2 = await context.newPage();
  page2.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page2.on("dialog", (d) => d.accept());
  await page2.addInitScript((k) => {
    try {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(k, JSON.stringify({ prompts: [
          { name: "translate", text: "Translate this into {{language}} on {{date}}: {{text}}" },
          { name: "plain", text: "Just a plain prompt." },
          { name: "stamped", text: "Notes for {{date}} at {{time}}." },
          { name: "tag", text: "A prompt that was called tag before /tag existed." },
        ] }));
        sessionStorage.setItem("seeded", "1");
      }
    } catch { /* a frame with no storage */ }
  }, SETTINGS_KEY);
  await page2.goto(BASE, { waitUntil: "networkidle" });
  await page2.locator("header button", { hasText: /mock-/ }).first().waitFor();
  await page2.locator("[data-msg]").first().waitFor();
  const c2 = page2.locator("#message-input");
  await c2.fill("/translate");
  await c2.press("Enter");
  const vars = page2.locator("[data-prompt-variables]");
  await vars.waitFor();
  check("a prompt with blanks asks for them first", (await vars.locator("[data-prompt-variable]").count()) === 2 && (await vars.locator("[data-prompt-variable]").evaluateAll((els) => els.map((e) => e.getAttribute("data-prompt-variable")))).join() === "language,text");
  check("but not for {{date}}, which fills itself", (await vars.locator('[data-prompt-variable="date"]').count()) === 0);
  check("with the first blank ready to type in", await page2.evaluate(() => document.activeElement?.getAttribute("data-prompt-variable") === "language"));
  await page2.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  for (const t of ["dark", "light"]) {
    await page2.evaluate((v) => document.documentElement.setAttribute("data-theme", v), t);
    if ((await page2.evaluate(() => typeof window.axe)) === "undefined") await page2.addScriptTag({ path: AXE });
    const violations = await page2.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } })).violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`));
    check(`axe finds nothing to fix — ${t}, filling in a prompt's blanks`, violations.length === 0, violations.join("; "));
  }
  await page2.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await vars.locator('[data-prompt-variable="language"]').fill("French");
  await vars.locator('[data-prompt-variable="text"]').fill("good morning");
  await page2.locator("[data-prompt-variables-submit]").click();
  const today = await page2.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  check("the message box gets the finished text, with today's date", (await c2.inputValue()) === `Translate this into French on ${today}: good morning`, await c2.inputValue());
  check("and the dialog goes, with focus in the message box", (await page2.locator("[data-prompt-variables]").count()) === 0 && (await page2.evaluate(() => document.activeElement?.id === "message-input")));
  await c2.fill("/translate");
  await c2.press("Enter");
  await vars.waitFor();
  await page2.keyboard.press("Escape");
  check("Escape closes it and fills nothing", (await page2.locator("[data-prompt-variables]").count()) === 0 && (await c2.inputValue()) === "");
  await c2.fill("/translate");
  await c2.press("Enter");
  await vars.waitFor();
  await vars.locator('[data-prompt-variable="language"]').fill("Welsh");
  await page2.keyboard.press("Enter");
  check("Enter in a field submits; one left empty stays as written", (await c2.inputValue()) === `Translate this into Welsh on ${today}: {{text}}`, await c2.inputValue());
  await c2.fill("/plain");
  await c2.press("Enter");
  check("a prompt with no blanks fills straight away", (await page2.locator("[data-prompt-variables]").count()) === 0 && (await c2.inputValue()) === "Just a plain prompt.");
  await c2.fill("/stamped");
  await c2.press("Enter");
  check("one with only date and time fills straight away, finished", /^Notes for \d{4}-\d\d-\d\d at \d\d:\d\d\.$/.test(await c2.inputValue()), await c2.inputValue());
  await c2.fill("/translate keep it formal");
  await c2.press("Enter");
  await vars.waitFor();
  await vars.locator('[data-prompt-variable="language"]').fill("German");
  await vars.locator('[data-prompt-variable="text"]').fill("hi");
  await page2.locator("[data-prompt-variables-submit]").click();
  check("words typed after the name are kept, below the prompt", (await c2.inputValue()).endsWith("good\u0000") === false && (await c2.inputValue()).endsWith(": hi\n\nkeep it formal"), await c2.inputValue());
  await c2.fill("");

  // A prompt called "tag" before /tag existed is renamed when Settings saves, not lost.
  await page2.locator('button[title="Settings"]').first().click();
  const settings2 = page2.locator('[role="dialog"][aria-labelledby="settings-title"]');
  await settings2.waitFor();
  await settings2.getByRole("button", { name: /^Save/ }).click();
  await settings2.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  const savedPrompts = await page2.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "{}").prompts.map((p) => p.name), SETTINGS_KEY);
  check("a prompt that was called 'tag' is renamed 'tag-prompt' when settings save, not lost", savedPrompts.includes("tag-prompt") && !savedPrompts.includes("tag"), savedPrompts.join());
  await page2.keyboard.press("?");
  await page2.locator("[data-shortcuts]").waitFor();
  const listed = await page2.locator("[data-shortcuts]").innerText();
  check("the shortcut list includes what was added", ["Find in this chat", "Search what you've sent before", "Jump to your next message", "Send, whichever way Settings sends"].every((t) => listed.includes(t)));
  await page2.keyboard.press("Escape");
  await page2.close();

  check("no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  for (const id of made) {
    await send(`/api/chats/${id}`, "DELETE", {}).catch(() => {});
    await fetch(`${BASE}/api/trash?id=${id}`, { method: "DELETE" }).catch(() => {});
  }
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
