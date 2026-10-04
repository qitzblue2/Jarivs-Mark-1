/**
 * The finishing touches, in a real browser: the command palette, searching
 * Settings, the diagnostics summary and its promise to hold no secrets, resetting
 * a browser, and how messages look — typeface, highlight colour, width, privacy
 * blur, always-visible buttons, folded code — each with an axe scan in both
 * themes. Same setup as test/e2e.mjs (mock provider + a server pointed at it):
 *   npm run test:polish
 *
 * Seeds its own chats and removes every one it made.
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const OUT = process.env.SHOT_DIR ?? "/tmp";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36).slice(-5);
const AXE = new URL("../node_modules/axe-core/axe.min.js", import.meta.url).pathname;
const SETTINGS_KEY = "jarvis.settings.v1";
const PREFS_KEY = "jarvis.prefs.v1";
const SECRET = "gsk_SECRET_do_not_print_9f8e7d";

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
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
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
async function open(seed = {}) {
  await page.addInitScript(([sk, settings, pk, prefs]) => {
    try {
      if (!sessionStorage.getItem("seeded")) {
        if (settings) localStorage.setItem(sk, settings);
        if (prefs) localStorage.setItem(pk, prefs);
        sessionStorage.setItem("seeded", "1");
      }
    } catch { /* a frame with no storage */ }
  }, [SETTINGS_KEY, seed.settings ? JSON.stringify(seed.settings) : "", PREFS_KEY, seed.prefs ? JSON.stringify(seed.prefs) : ""]);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("header button", { hasText: /mock-/ }).first().waitFor({ timeout: 10000 });
  await page.locator("[data-msg]").first().waitFor({ timeout: 5000 });
}
const composer = () => page.locator("#message-input");
const html = (attr) => page.evaluate((a) => document.documentElement.getAttribute(a), attr);
const css = (selector, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [selector, prop]);
async function openSettings() {
  await page.locator('button[title="Settings"]').first().click();
  const dialog = page.locator('[role="dialog"][aria-labelledby="settings-title"]');
  await dialog.waitFor({ timeout: 5000 });
  return dialog;
}
const setPref = async (patch) => {
  await page.evaluate(([k, p]) => {
    const now = JSON.parse(localStorage.getItem(k) ?? "{}");
    localStorage.setItem(k, JSON.stringify({ ...now, ...p }));
  }, [PREFS_KEY, patch]);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-msg]").first().waitFor();
};

try {
  await seedChat(`Kitchen plans ${RUN}`, [{ role: "user", content: "kitchen" }, { role: "assistant", content: "Sure." }]);
  const lines = Array.from({ length: 60 }, (_, i) => `line_${i + 1} = ${i + 1};`).join("\n");
  const chat = await seedChat(`Polish ${RUN}`, [
    { role: "user", content: "Show me a long block of code please." },
    { role: "assistant", content: `Here it is.\n\n\`\`\`js\n${lines}\n\`\`\`\n\nAnd a short one:\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n\nThat is all of it.`, model: "mock-fast-8b" },
    { role: "user", content: "Thanks." },
    { role: "assistant", content: "You are welcome.", model: "mock-fast-8b" },
  ]);
  await open({ settings: { keys: { groq: SECRET }, persona: "A very private persona text" } });

  // --- 101: the command palette ---------------------------------------------------------------------
  check("there is no palette until asked for", (await page.locator("[data-palette]").count()) === 0);
  await page.locator("h1").first().click();
  await page.keyboard.press("Control+Shift+P");
  const palette = page.locator("[data-palette]");
  await palette.waitFor();
  check("Ctrl+Shift+P opens it with the cursor in its box", await page.evaluate(() => document.activeElement?.hasAttribute("data-palette-input")));
  const ids = () => palette.locator("[data-palette-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-palette-id")));
  const first = await ids();
  check("with nothing typed it lists actions first", first[0] === "act:new" && first.every((id) => id.startsWith("act:")), first.slice(0, 3).join());
  await axeBoth("the command palette");
  await page.screenshot({ path: `${OUT}/polish-palette.png` });
  await page.keyboard.type("settings");
  check("typing narrows it, best first", (await ids())[0] === "act:settings");
  await page.keyboard.press("Enter");
  const settings = page.locator('[role="dialog"][aria-labelledby="settings-title"]');
  await settings.waitFor();
  check("Enter runs it, and the palette is gone", (await page.locator("[data-palette]").count()) === 0);
  await page.keyboard.press("Escape");
  await composer().fill("/palette");
  await composer().press("Enter");
  await palette.waitFor();
  check("/palette opens it too", true);
  await page.keyboard.type(`kitchen`);
  check("your chats are in it", (await ids()).includes((await json("/api/chats")).chats.filter((c) => c.title.startsWith("Kitchen"))[0] && `chat:${(await json("/api/chats")).chats.find((c) => c.title.startsWith("Kitchen")).id}`));
  await page.keyboard.press("Enter");
  await page.waitForFunction((t) => document.querySelector("h1")?.textContent?.includes(t), `Kitchen plans ${RUN}`, { timeout: 5000 });
  check("choosing one opens that chat", true);
  await page.keyboard.press("Control+Shift+P");
  await palette.waitFor();
  await page.keyboard.type("smart");
  check("a model can be found by part of its name", (await ids())[0].startsWith("model:groq:mock-smart"));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /mock-smart-120b/.test(document.querySelector("header")?.textContent ?? ""), null, { timeout: 4000 });
  check("and switched to", true);
  await page.keyboard.press("Control+Shift+P");
  await palette.waitFor();
  await page.keyboard.type("zzzzzz");
  check("nonsense says nothing matches", /Nothing matches “zzzzzz”/.test(await palette.locator("[data-palette-empty]").innerText()));
  await page.keyboard.press("Escape");
  check("Escape closes it", (await page.locator("[data-palette]").count()) === 0);
  await page.locator("[data-chat-row]", { hasText: `Polish ${RUN}` }).first().click();
  await page.waitForFunction((t) => document.querySelector("h1")?.textContent?.includes(t), `Polish ${RUN}`, { timeout: 5000 });
  await page.keyboard.press("Control+Shift+P");
  await palette.waitFor();
  await page.keyboard.type("find in");
  check("with a chat open, there are things to do with it", (await ids())[0] === "act:find");
  await page.keyboard.press("Enter");
  await page.locator("[data-find-bar]").waitFor({ timeout: 3000 });
  check("'Find in this chat' opens the find bar", true);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+P");
  await palette.waitFor();
  await page.keyboard.type("focus");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-focus-button]")?.getAttribute("data-focus-active") === "true", null, { timeout: 3000 });
  check("'Start a 25-minute focus timer' starts one", true);
  await page.keyboard.press("Control+Shift+P");
  await palette.waitFor();
  await page.keyboard.type("end the focus");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-focus-button]")?.getAttribute("data-focus-active") === null, null, { timeout: 3000 });
  check("and the same place ends it", true);
  const themeChoice = () => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.appearance") ?? "{}").theme ?? "system");
  const themeBefore = await themeChoice();
  await page.keyboard.press("Control+Shift+P");
  await palette.waitFor();
  await page.keyboard.type("switch theme");
  await page.keyboard.press("Enter");
  await page.waitForFunction((t) => (JSON.parse(localStorage.getItem("jarvis.appearance") ?? "{}").theme ?? "system") !== t, themeBefore, { timeout: 3000 }).catch(() => {});
  check("'Switch theme' moves to the next of system, dark, light", (await themeChoice()) !== themeBefore, `${themeBefore} → ${await themeChoice()}`);
  await page.evaluate(() => localStorage.setItem("jarvis.appearance", JSON.stringify({ theme: "dark" })));
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-msg]").first().waitFor();

  // --- 103: search settings ---------------------------------------------------------------------------------
  let dialog = await openSettings();
  const body = dialog.locator("[data-settings-search]");
  const visibleSections = () => dialog.locator("div.space-y-5 > :not([hidden]):not([data-filter-keep])").count();
  const totalSections = await visibleSections();
  check("Settings has a search box and lots of sections", totalSections >= 10, String(totalSections));
  await body.fill("tools");
  const filtered = await visibleSections();
  check("typing hides sections that don't mention it", filtered > 0 && filtered < totalSections, `${filtered} of ${totalSections}`);
  check("and says how many are left", /\d+ sections? match/.test(await dialog.locator("[data-settings-found]").innerText()));
  check("the one asked about is among them", (await dialog.locator("[data-tool-settings]:not([hidden])").count()) === 1 && (await dialog.locator("[data-appearance]:not([hidden])").count()) === 0);
  await axeBoth("Settings, filtered");
  await body.fill("zzzzzz nothing");
  check("a word nothing mentions says so", /No setting mentions “zzzzzz nothing”/.test(await dialog.locator("[data-settings-none]").innerText()) && (await visibleSections()) === 0);
  await body.fill("send enter");
  check("every word has to be there, in any order", (await dialog.locator("[data-prefs-settings]:not([hidden])").count()) === 1);
  await body.fill("");
  check("clearing brings everything back", (await visibleSections()) === totalSections && (await dialog.locator("[data-settings-found], [data-settings-none]").count()) === 0, `${await visibleSections()} of ${totalSections}, notes ${await dialog.locator("[data-settings-found], [data-settings-none]").count()}`);

  // --- 104: diagnostics ---------------------------------------------------------------------------------------
  const about = dialog.locator("[data-about-settings]");
  await about.scrollIntoViewIfNeeded();
  await about.locator("[data-show-diagnostics]").click();
  const report = about.locator("[data-diagnostics]");
  await report.waitFor();
  const text = await report.innerText();
  check("it shows the version, the counts, the providers and this browser", /JARVIS Mark 6 \d+\.\d+\.\d+/.test(text) && /\d+ chats/.test(text) && /Groq: ready, \d+ models/.test(text) && /Mozilla/.test(text), text.slice(0, 100));
  check("and which gates are open", /computer access: (yes|no)/.test(text) && /password set: (yes|no)/.test(text));
  check("it holds no key, no persona text and no address — though both are stored right here in this browser", !text.includes(SECRET) && !text.includes("gsk_") && !text.includes("private persona") && !/https?:\/\//.test(text));
  await about.locator("[data-copy-diagnostics]").click();
  await about.locator("[data-about-note]").waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check("Copy puts the same on the clipboard, and says what it holds", clip.includes("JARVIS Mark 6") && !clip.includes(SECRET) && /holds no keys/.test(await about.locator("[data-about-note]").innerText()));
  const server = await json("/api/diagnostics");
  check("the server's side is a short fixed list — nothing from the environment", Object.keys(server).sort().join() === "app,counts,dataDir,flags,node,platform,storage,uptimeSeconds" && !JSON.stringify(server).includes("GROQ") && server.dataDir.split("/").length <= 2);
  await axeBoth("Settings with diagnostics shown");

  // --- 110: reset this browser ---------------------------------------------------------------------------------
  await page.keyboard.press("Escape");
  await setPref({ font: "serif", accent: "rose" });
  await composer().fill("an unsent draft for the reset test");
  await page.waitForTimeout(300);
  dialog = await openSettings();
  await about.scrollIntoViewIfNeeded();
  await about.locator("[data-reset-start]").click();
  check("Reset asks first, and says what it does and doesn't touch", /Your chats are on the server/.test(await about.locator("[data-reset-confirm]").innerText()) && !(await about.locator("[data-reset-settings]").isChecked()));
  await axeBoth("the reset confirmation");
  await about.locator("[data-reset-go]").click();
  await page.waitForLoadState("networkidle");
  await page.locator("[data-msg]").first().waitFor();
  check("after it, looks and behaviour are back to the defaults", (await html("data-font")) === "sans" && (await html("data-accent")) === "sky");
  check("unsent drafts are gone", (await composer().inputValue()) === "");
  check("but Settings — the key and the persona — were kept", await page.evaluate(([k, s]) => { const v = JSON.parse(localStorage.getItem(k) ?? "{}"); return v.keys?.groq === s && v.persona === "A very private persona text"; }, [SETTINGS_KEY, SECRET]));
  await setPref({ font: "mono" });
  dialog = await openSettings();
  await about.scrollIntoViewIfNeeded();
  await about.locator("[data-reset-start]").click();
  await about.locator("[data-reset-settings]").check();
  await about.locator("[data-reset-go]").click();
  await page.waitForLoadState("networkidle");
  await page.locator("[data-msg]").first().waitFor();
  check("with 'also forget my Settings' ticked, those go as well", await page.evaluate((k) => localStorage.getItem(k) === null || !JSON.parse(localStorage.getItem(k)).keys?.groq, SETTINGS_KEY));

  // --- 105: typeface -----------------------------------------------------------------------------------------------
  const bodyFont = () => css('[data-msg][data-role="assistant"] .prose-jarvis', "fontFamily");
  check("messages start in the sans-serif the app uses", !/Georgia|Verdana/.test(await bodyFont()));
  dialog = await openSettings();
  const look = dialog.locator("[data-look-settings]");
  await look.scrollIntoViewIfNeeded();
  await look.locator('[data-choice="font"] [data-value="serif"]').click();
  check("Serif sets messages in a serif face, at once", /Georgia/.test(await bodyFont()) && (await html("data-font")) === "serif");
  check("while code stays monospaced", /ui-monospace|SF Mono|Menlo|Consolas|monospace/.test(await css('[data-msg] pre', "fontFamily")));
  check("and so does the message box", /Georgia/.test(await css("#message-input", "fontFamily")));
  await look.locator('[data-choice="font"] [data-value="readable"]').click();
  check("Easy to read uses a wide, open face", /Verdana/.test(await bodyFont()));
  await look.locator('[data-choice="font"] [data-value="mono"]').click();
  check("Monospace is monospace", /ui-monospace|monospace/.test(await bodyFont()));
  await axeBoth("Settings, messages and colour");
  await look.locator('[data-choice="font"] [data-value="sans"]').click();

  // --- 106: highlight colour -----------------------------------------------------------------------------------------
  const arc = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-arc").trim());
  check("the default accent is sky", (await arc()) === "#38bdf8" && (await html("data-accent")) === "sky");
  for (const [id, dark, light] of [["violet", "#a78bfa", "#5b21b6"], ["emerald", "#34d399", "#047857"], ["rose", "#fb7185", "#9f1239"], ["orange", "#fb923c", "#9a3412"]]) {
    await look.locator(`[data-choice="accent"] [data-value="${id}"]`).click();
    const darkArc = await arc();
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    const lightArc = await arc();
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    check(`${id}: the accent changes at once, with a deeper one for the light theme`, darkArc === dark && lightArc === light, `${darkArc} / ${lightArc}`);
  }
  await look.locator('[data-choice="accent"] [data-value="rose"]').click();
  check("buttons take the accent's fill — white text on it stays readable", (await page.evaluate(() => getComputedStyle(document.querySelector("[data-look-settings]")).getPropertyValue("--color-arc-solid").trim())) === "#be123c");
  await page.keyboard.press("Escape");
  for (const id of ["violet", "emerald", "rose", "orange"]) {
    await setPref({ accent: id });
    await axeBoth(`the ${id} accent, with a conversation open`);
  }
  await setPref({ accent: "sky" });

  // --- 107: width ----------------------------------------------------------------------------------------------------------
  const columnWidth = async () => Math.round((await page.locator('[data-msg] > div').first().boundingBox()).width);
  const normalWidth = await columnWidth();
  await setPref({ width: "narrow" });
  const narrow = await columnWidth();
  await setPref({ width: "wide" });
  const wide = await columnWidth();
  check("the conversation can be narrow, normal or wide", narrow < normalWidth && normalWidth < wide, `${narrow} < ${normalWidth} < ${wide}`);
  check("narrow is about 38rem and wide about 66rem (within the window)", narrow <= 610 && wide > 900);
  check("the message box follows the column", Math.round((await page.locator("[data-composer] > div").boundingBox()).width) === wide);
  await setPref({ width: "normal" });

  // --- 102: privacy blur ---------------------------------------------------------------------------------------------------
  const proseBlur = () => css('[data-msg][data-role="assistant"] .prose-jarvis', "filter");
  check("messages are readable by default", (await proseBlur()) === "none");
  await setPref({ privacyBlur: true });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  check("with the blur on, they are blurred", /blur\(7px\)/.test(await proseBlur()));
  check("and a message can be reached to lift it: focusable, and named for what it is", (await page.locator('[data-msg]').first().getAttribute("tabindex")) === "0" && /blurred until you point/.test((await page.locator("[data-msg]").first().getAttribute("aria-label")) ?? ""));
  await axeBoth("messages blurred");
  await page.locator('[data-msg][data-role="assistant"]').first().hover();
  await page.waitForTimeout(250);
  check("pointing at one lifts the blur on that one only", (await proseBlur()) === "none" && /blur/.test(await page.evaluate(() => getComputedStyle([...document.querySelectorAll('[data-msg][data-role="assistant"] .prose-jarvis')].at(-1)).filter)));
  await page.mouse.move(2, 2);
  await page.locator('[data-msg][data-role="assistant"]').first().focus();
  await page.waitForTimeout(250);
  check("so does focusing it (a tap, or Tab)", (await proseBlur()) === "none");
  await composer().focus();
  await page.waitForTimeout(250);
  check("and moving away puts it back", /blur\(7px\)/.test(await proseBlur()));
  await setPref({ privacyBlur: false });

  // --- 108: buttons always showing -------------------------------------------------------------------------------------
  await page.mouse.move(2, 2);
  const rowOpacity = () => css('[data-msg][data-role="assistant"] [data-no-find]', "opacity");
  check("the buttons under a message are hidden until you point at one", (await rowOpacity()) === "0");
  await setPref({ alwaysActions: true });
  await page.mouse.move(2, 2);
  check("with 'always show' they are there without pointing", (await rowOpacity()) === "1");
  await setPref({ alwaysActions: false });

  // --- 109: folding long code ---------------------------------------------------------------------------------------------
  check("by default a long block is shown whole", (await page.locator("[data-code-fold]").count()) === 0);
  await setPref({ collapseCode: 20 });
  const fold = page.locator("[data-code-fold]");
  check("with folding on, a 60-line block gets a button saying how many lines", (await fold.count()) === 1 && (await fold.innerText()) === "Show all 60 lines");
  check("the short block beside it is left alone", (await page.locator("[data-code-block]").count()) === 2);
  const heightFolded = Math.round((await page.locator("[data-code-block] pre").first().boundingBox()).height);
  check("the block is cut to about twenty lines", heightFolded < 60 * 20 * 0.9 && heightFolded > 20 * 14, String(heightFolded));
  check("and the button says it is collapsed, to a screen reader too", (await fold.getAttribute("aria-expanded")) === "false");
  await axeBoth("a folded code block");
  await fold.click();
  const heightOpen = Math.round((await page.locator("[data-code-block] pre").first().boundingBox()).height);
  check("pressing it opens the whole block", heightOpen > heightFolded * 2 && (await fold.innerText()) === "Show less" && (await fold.getAttribute("aria-expanded")) === "true");
  await fold.click();
  check("and again folds it", (await fold.innerText()) === "Show all 60 lines");
  await setPref({ collapseCode: 0 });

  check("no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  for (const id of made.filter(Boolean)) {
    await send(`/api/chats/${id}`, "DELETE", {}).catch(() => {});
    await fetch(`${BASE}/api/trash?id=${id}`, { method: "DELETE" }).catch(() => {});
  }
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
