/**
 * Appearance and accessibility, in a real browser: light/dark/system theme
 * with no flash, text size, density, the shortcuts dialog, the resizable chat
 * list, the skip link, focus rings and focus handling in dialogs, an axe scan
 * in both themes, the web app manifest, printing, and the offline banner.
 * Same setup as test/e2e.mjs (mock provider + a server pointed at it).
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
const send = (path, method, body) =>
  fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const made = [];
async function seed(title, messages) {
  const { chat } = await (await send("/api/chats", "POST", { title })).json();
  made.push(chat.id);
  await send(`/api/chats/${chat.id}`, "PATCH", {
    messages: messages.map(([role, content], i) => ({ id: `${chat.id}-${i}`, role, content, createdAt: Date.now() + i })),
  });
  await new Promise((r) => setTimeout(r, 30));
  return chat;
}

const reply = [
  "Here is a **bold** idea and a table:",
  "",
  "| Name | Score |",
  "|---|---|",
  "| Ada | 10 |",
  "| Grace | 9 |",
  "",
  "```js",
  "// hello.js",
  "console.log('hello');",
  "```",
].join("\n");
const long = await seed(`A long one ${RUN}`, Array.from({ length: 24 }, (_, i) => [
  i % 2 === 0 ? "user" : "assistant",
  Array.from({ length: 12 }, (_, l) => `message ${i + 1}, line ${l + 1}: the quick brown fox jumps over the lazy dog`).join("\n"),
]));

const chat = await seed(`Look and feel ${RUN}`, [
  ["user", `Show me something with a table and code ${RUN}`],
  ["assistant", reply],
]);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });
page.on("dialog", (d) => d.accept());

const html = (attr) => page.evaluate((a) => document.documentElement.getAttribute(a), attr);
const css = (selector, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [selector, prop]);
const bodyBg = () => css("body", "backgroundColor");
const asideWidth = async () => (await page.locator('aside[aria-label="Chats"]').boundingBox()).width;

async function openChat(title) {
  await page.locator("[data-chat-row]").filter({ has: page.getByText(title, { exact: true }) }).first().click({ position: { x: 20, y: 10 } });
}
async function openSettings() {
  await page.locator('button[title="Settings"]').first().click();
  const dialog = page.locator('[role="dialog"][aria-labelledby="settings-title"]');
  await dialog.waitFor({ timeout: 5000 });
  return dialog;
}
async function setAppearance(group, value) {
  const dialog = await openSettings();
  await dialog.locator(`[data-choice="${group}"] [data-value="${value}"]`).click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await dialog.waitFor({ state: "detached" });
}
async function axe(label) {
  if ((await page.evaluate(() => typeof window.axe)) === "undefined") await page.addScriptTag({ path: AXE });
  // The copy/save/branch row under a message is hidden until you hover it (and
  // always shown on a touch screen — checked below). Scan it as it looks when
  // revealed, with no fade in progress; axe would otherwise judge an invisible
  // control by the contrast of nothing.
  await page.addStyleTag({ content: "[data-msg] .opacity-0 { opacity: 1 !important } *, *::before, *::after { transition: none !important; }" });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(" ")} :: ${(n.any[0] ?? n.all[0] ?? n.none[0])?.message ?? ""}`.slice(0, 220)),
    }));
  });
  for (const v of violations) console.log(`     axe [${v.impact}] ${v.id}: ${v.help}\n${v.nodes.map((n) => `        ${n}`).join("\n")}`);
  check(`axe finds nothing to fix — ${label}`, violations.length === 0, violations.length ? `${violations.length} rule(s) violated` : "");
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("header button", { hasText: /mock-/ }).first().waitFor({ timeout: 10000 });
  await openChat(`Look and feel ${RUN}`);
  await page.getByText("Ada").first().waitFor({ timeout: 10000 });

  // --- 29: theme -----------------------------------------------------------
  check("the system's dark is followed by default", (await html("data-theme")) === "dark");
  check("and the page is dark", (await bodyBg()) === "rgb(10, 13, 19)", await bodyBg());
  await page.screenshot({ path: `${OUT}/appearance-dark.png` });

  await setAppearance("theme", "light");
  check("Light switches the page", (await html("data-theme")) === "light");
  check("the background is light", (await bodyBg()) === "rgb(246, 248, 251)", await bodyBg());
  check("and so are the panels", (await css('aside[aria-label="Chats"]', "backgroundColor")) === "rgb(255, 255, 255)");
  check("the browser's own controls follow", (await css("html", "colorScheme")) === "light");
  check("the title bar colour follows", (await page.locator('meta[name="theme-color"]').first().getAttribute("content")) === "#f6f8fb");
  await page.screenshot({ path: `${OUT}/appearance-light.png` });

  await page.reload({ waitUntil: "networkidle" });
  check("the choice survives a reload", (await html("data-theme")) === "light");

  // Before any script has run: stop the app's JavaScript from loading at all
  // and see what the page looks like from the inline script alone.
  const bare = await context.newPage();
  await bare.route("**/_next/static/**/*.js", (r) => r.abort());
  await bare.goto(BASE, { waitUntil: "domcontentloaded" });
  check(
    "the theme is set before the app loads, so it never flashes",
    (await bare.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "light" &&
      (await bare.evaluate(() => getComputedStyle(document.body).backgroundColor)) === "rgb(246, 248, 251)",
  );
  await bare.close();

  await setAppearance("theme", "system");
  const becomes = (value) => page.waitForFunction((v) => document.documentElement.getAttribute("data-theme") === v, value, { timeout: 3000 }).then(() => true, () => false);
  await page.emulateMedia({ colorScheme: "light" });
  check("System follows the OS to light", await becomes("light"));
  await page.emulateMedia({ colorScheme: "dark" });
  check("and back to dark, live, with no reload", await becomes("dark"));
  await page.emulateMedia({ colorScheme: "light" });
  await setAppearance("theme", "dark");
  check("a chosen theme ignores the OS", (await html("data-theme")) === "dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByLabel("Message").fill("/theme");
  await page.keyboard.press("Enter");
  check("/theme moves to the next one (dark → light)", (await html("data-theme")) === "light");
  await page.getByLabel("Message").fill("/theme");
  await page.keyboard.press("Enter");
  check("and the next (light → system)", (await html("data-theme")) === "dark" /* the OS is dark */);
  const dialog0 = await openSettings();
  check("Settings shows System as chosen", (await dialog0.locator('[data-choice="theme"] [data-value="system"]').getAttribute("aria-checked")) === "true");
  await dialog0.getByRole("button", { name: "Close" }).click();

  // --- 30: text size and density ---------------------------------------------
  const textPx = async () => parseFloat(await css("[data-msg] .chat-text", "fontSize"));
  const boxPx = async () => parseFloat(await css("#message-input", "fontSize"));
  check("normal text is 15px", (await textPx()) === 15 && (await boxPx()) === 15);
  const railPx = parseFloat(await css("[data-chat-row] button", "fontSize"));
  const sizes = { small: 13.5, large: 17.25, xlarge: 19.5 };
  for (const [size, px] of Object.entries(sizes)) {
    await setAppearance("textSize", size);
    check(`${size} text is ${px}px in messages and in the message box`, Math.abs((await textPx()) - px) < 0.1 && Math.abs((await boxPx()) - px) < 0.1, `${await textPx()} / ${await boxPx()}`);
  }
  const codePx = parseFloat(await css("pre code", "fontSize"));
  check("code scales with it", codePx > 0.82 * 16, `${codePx}px`);
  check("the chat list does not (the browser's zoom is for that)", parseFloat(await css("[data-chat-row] button", "fontSize")) === railPx, `${railPx}px`);
  await page.reload({ waitUntil: "networkidle" });
  check("the size survives a reload", Math.abs((await textPx()) - 19.5) < 0.1 && (await html("data-text")) === "xlarge");
  await setAppearance("textSize", "normal");

  const padTop = async () => parseFloat(await css("[data-msg]", "paddingTop"));
  const rowPad = async () => parseFloat(await css("[data-chat-row]", "paddingTop"));
  const [msgComfortable, rowComfortable] = [await padTop(), await rowPad()];
  await setAppearance("density", "compact");
  check("compact tightens messages", (await padTop()) < msgComfortable, `${msgComfortable}px → ${await padTop()}px`);
  check("and the chat list", (await rowPad()) < rowComfortable, `${rowComfortable}px → ${await rowPad()}px`);
  await setAppearance("density", "comfortable");
  check("Comfortable puts them back", (await padTop()) === msgComfortable);
  const dialog1 = await openSettings();
  await dialog1.locator('[data-choice="theme"] [data-value="light"]').click();
  await dialog1.locator('[data-choice="textSize"] [data-value="large"]').click();
  await dialog1.locator("[data-appearance]").getByRole("button", { name: "Reset" }).click();
  check("Reset puts it all back", (await html("data-theme")) === "dark" && (await html("data-text")) === "normal" && (await html("data-density")) === "comfortable");
  check("and the Reset button goes away", (await dialog1.locator("[data-appearance]").getByRole("button", { name: "Reset" }).count()) === 0);
  await dialog1.getByRole("button", { name: "Close" }).click();

  // --- 31: keyboard shortcuts --------------------------------------------------
  await page.locator("h1").first().click(); // focus on the page, not a field
  await page.keyboard.press("?");
  const shortcuts = page.locator("[data-shortcuts]");
  await shortcuts.waitFor({ timeout: 3000 });
  check("? lists the shortcuts", true);
  const listed = await shortcuts.innerText();
  check("they include the ones that exist", ["New chat", "Search every chat", "Voice mode", "Send", "This list"].every((t) => listed.includes(t)));
  check("keys are shown for this platform", listed.includes("Ctrl"));
  check("focus moved into the dialog", await page.evaluate(() => !!document.activeElement?.closest("[data-shortcuts]")));
  await page.screenshot({ path: `${OUT}/appearance-shortcuts.png` });
  await page.keyboard.press("Escape");
  await shortcuts.waitFor({ state: "detached" });
  check("Esc closes it", true);
  await page.keyboard.press("?");
  await shortcuts.waitFor({ timeout: 3000 });
  await page.keyboard.press("?");
  await shortcuts.waitFor({ state: "detached" });
  check("? again closes it", true);

  await page.getByLabel("Message").click();
  await page.keyboard.type("is this a question?");
  check("in the message box a ? is just a ?", (await page.getByLabel("Message").inputValue()) === "is this a question?" && (await shortcuts.count()) === 0);
  await page.getByLabel("Message").fill("/help");
  await page.keyboard.press("Enter");
  await shortcuts.waitFor({ timeout: 3000 });
  check("/help opens it too", true);
  check("and leaves the message box empty", (await page.getByLabel("Message").inputValue()) === "");
  await page.keyboard.press("Escape");
  await shortcuts.waitFor({ state: "detached" });
  check("focus goes back to the message box afterwards", (await page.evaluate(() => document.activeElement?.id)) === "message-input");

  // Press what the list says to press.
  await page.keyboard.press("Control+/");
  check("Ctrl+/ searches every chat", await page.evaluate(() => document.activeElement?.hasAttribute("data-chat-search")));
  await page.keyboard.press("Control+k");
  await page.locator("h2", { hasText: "JARVIS Mark 6" }).waitFor({ timeout: 3000 });
  check("Ctrl+K starts a new chat", true);
  await openChat(`Look and feel ${RUN}`);
  await page.getByText("Ada").first().waitFor({ timeout: 10000 });

  // --- 32: resizable chat list ---------------------------------------------------
  const handle = page.locator("[data-sidebar-resizer]");
  check("the chat list starts at 260px", Math.abs((await asideWidth()) - 260) < 1.5, `${await asideWidth()}`);
  const box = await handle.boundingBox();
  const mid = box.y + box.height / 2;
  const edge = box.x + box.width / 2;
  await page.mouse.move(edge, mid);
  await page.mouse.down();
  await page.mouse.move(edge + 60, mid, { steps: 4 });
  await page.mouse.move(edge + 100, mid, { steps: 4 });
  await page.mouse.up();
  check("dragging its edge widens it", Math.abs((await asideWidth()) - 360) < 3, `${await asideWidth()}`);
  check("the separator reports the width", (await handle.getAttribute("aria-valuenow")) === "360");
  await page.reload({ waitUntil: "networkidle" });
  check("the width survives a reload", Math.abs((await asideWidth()) - 360) < 3, `${await asideWidth()}`);
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  check("ArrowLeft narrows it by a step", Math.abs((await asideWidth()) - 344) < 2, `${await asideWidth()}`);
  await page.keyboard.press("Shift+ArrowRight");
  check("Shift+Arrow takes a bigger one", Math.abs((await asideWidth()) - 408) < 2, `${await asideWidth()}`);
  await page.keyboard.press("Home");
  check("Home goes to the narrowest", Math.abs((await asideWidth()) - 220) < 2, `${await asideWidth()}`);
  await page.keyboard.press("End");
  check("End goes to the widest", Math.abs((await asideWidth()) - 480) < 2, `${await asideWidth()}`);
  await page.keyboard.press("Enter");
  check("Enter resets it", Math.abs((await asideWidth()) - 260) < 2, `${await asideWidth()}`);
  const box2 = await handle.boundingBox();
  await page.mouse.move(box2.x + 1, box2.y + 200);
  await page.mouse.down();
  await page.mouse.move(box2.x + 900, box2.y + 200, { steps: 6 });
  await page.mouse.up();
  check("dragging too far stops at the limit", Math.abs((await asideWidth()) - 480) < 2, `${await asideWidth()}`);
  await handle.dblclick();
  check("a double-click resets it", Math.abs((await asideWidth()) - 260) < 2, `${await asideWidth()}`);
  const dragBox = await page.locator("main").boundingBox();
  check("the chat fills the rest", Math.abs(dragBox.x - 260) < 2 && Math.abs(dragBox.x + dragBox.width - 1440) < 2, `${dragBox.x}+${dragBox.width}`);

  // --- 33: accessibility -------------------------------------------------------------
  await page.reload({ waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  const skip = page.locator("[data-skip-link]");
  check("the first Tab lands on the skip link", await skip.evaluate((el) => el === document.activeElement));
  const skipBox = await skip.boundingBox();
  check("which shows itself", skipBox && skipBox.width > 100 && skipBox.height > 20 && skipBox.y >= 0, JSON.stringify(skipBox));
  await page.keyboard.press("Enter");
  check("and jumps to the message box", (await page.evaluate(() => document.activeElement?.id)) === "message-input");

  check("there is one main landmark", (await page.locator("main").count()) === 1);
  check("the chat list is a named landmark", (await page.locator('aside[aria-label="Chats"]').count()) === 1);
  check("the conversation is a labelled log", (await page.locator('[role="log"][aria-label="Conversation"]').count()) === 1);
  check("the message box has a name", (await page.getByLabel("Message").count()) === 1);

  // A reply is announced when it starts and when it ends — and the log itself
  // stays quiet while the words arrive.
  check("the conversation log doesn't announce every streamed word", (await page.locator('[role="log"]').getAttribute("aria-live")) === "off");
  await page.evaluate(() => {
    window.__announced = [];
    const status = document.querySelector("[data-reply-status]");
    new MutationObserver(() => window.__announced.push(status.textContent)).observe(status, { childList: true, characterData: true, subtree: true });
  });
  await page.getByLabel("Message").fill(`say hi ${RUN}`);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__announced.includes("JARVIS has finished replying"), null, { timeout: 20000 });
  check(
    "a screen reader is told when a reply starts and finishes, once each",
    JSON.stringify(await page.evaluate(() => window.__announced)) === JSON.stringify(["JARVIS is replying", "JARVIS has finished replying"]),
    JSON.stringify(await page.evaluate(() => window.__announced)),
  );

  // Every stop on the keyboard path shows where it is.
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("header button", { hasText: /mock-/ }).first().waitFor();
  const unringed = [];
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const visible = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
      return { visible, name: `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}[${el.getAttribute("aria-label") || el.getAttribute("title") || (el.textContent || "").trim().slice(0, 20)}]` };
    });
    if (info && !info.visible) unringed.push(info.name);
  }
  check("every one of the first 45 tab stops shows a focus ring", unringed.length === 0, unringed.join(", "));

  // Dialogs: focus goes in, stays in, and comes back.
  await page.locator('button[title="Settings"]').first().focus();
  await page.keyboard.press("Enter");
  const settings = page.locator('[role="dialog"][aria-labelledby="settings-title"]');
  await settings.waitFor();
  check("opening Settings moves focus into it", await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')));
  let escaped = 0;
  for (let i = 0; i < 70; i++) {
    await page.keyboard.press("Tab");
    if (!(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))) escaped++;
  }
  check("70 Tabs never leave it", escaped === 0, `${escaped} escaped`);
  for (let i = 0; i < 70; i++) await page.keyboard.press("Shift+Tab");
  check("nor 70 Shift+Tabs", await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')));
  await settings.getByRole("button", { name: "Close" }).click();
  await settings.waitFor({ state: "detached" });
  check("closing it returns focus to the button that opened it", await page.evaluate(() => document.activeElement?.getAttribute("title") === "Settings"));

  // Reduced motion.
  await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.id = "probe";
    probe.className = "flash";
    document.body.append(probe);
  });
  const animated = await css("#probe", "animationName");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const still = await css("#probe", "animationName");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  check("reduced motion stops the highlight animation", animated !== "none" && still === "none", `${animated} → ${still}`);
  await page.evaluate(() => document.getElementById("probe")?.remove());

  // axe, in both themes, with the app and then with dialogs open.
  await axe("dark, a chat with a table and code");
  await setAppearance("theme", "light");
  await axe("light, a chat with a table and code");
  // Every other panel, in the theme most likely to have something unreadable.
  const rail = page.locator('aside[aria-label="Chats"]');
  const panels = [
    [rail.locator('button[title="Usage"]'), "Usage", "light, Usage open"],
    [rail.locator('button[title="Pictures"]'), "Pictures", "light, Pictures open"],
    [rail.getByRole("button", { name: "Saved", exact: true }), "Saved messages", "light, Saved open"],
    [rail.getByRole("button", { name: "Trash", exact: true }), "Trash", "light, Trash open"],
  ];
  for (const [opener, name, label] of panels) {
    await opener.first().click();
    await page.locator(`[role="dialog"][aria-label="${name}"]`).waitFor({ timeout: 5000 });
    await page.waitForTimeout(400);
    await axe(label);
    await page.keyboard.press("Escape");
    await page.locator(`[role="dialog"][aria-label="${name}"]`).waitFor({ state: "detached" });
  }
  await page.locator('button[title="Toggle code canvas"]').click();
  await page.waitForTimeout(500);
  await axe("light, code canvas open");
  await page.locator('button[title="Toggle code canvas"]').click();

  const settingsLight = await openSettings();
  await axe("light, Settings open");
  await settingsLight.getByRole("button", { name: "Close" }).click();
  await page.locator("h1").first().click();
  await page.keyboard.press("?");
  await page.locator("[data-shortcuts]").waitFor();
  await axe("light, shortcuts open");
  await page.keyboard.press("Escape");
  await setAppearance("theme", "dark");
  const settingsDark = await openSettings();
  await axe("dark, Settings open");
  await settingsDark.getByRole("button", { name: "Close" }).click();

  // --- 34: installable ---------------------------------------------------------------------
  const linked = await page.locator('link[rel="manifest"]').getAttribute("href");
  check("the page links a manifest", linked === "/manifest.webmanifest", String(linked));
  const manifest = await json("/manifest.webmanifest");
  check("it names the app and opens it standalone", manifest.name === "JARVIS Mark 6" && manifest.display === "standalone");
  const types = [];
  for (const icon of manifest.icons) {
    const res = await fetch(`${BASE}${icon.src}`);
    types.push(`${res.status} ${res.headers.get("content-type")}`);
  }
  check("every icon in it is served as a PNG", types.every((t) => t === "200 image/png"), types.join(", "));
  check("there is a tab icon and a home-screen icon", (await page.locator('link[rel="icon"]').count()) >= 1 && (await page.locator('link[rel="apple-touch-icon"]').count()) === 1);
  const tab = await fetch(`${BASE}${await page.locator('link[rel="icon"]').first().getAttribute("href")}`);
  check("and they load", tab.status === 200 && (tab.headers.get("content-type") ?? "").startsWith("image/png"));
  check("the title bar colour follows the theme back to dark", (await page.locator('meta[name="theme-color"]').first().getAttribute("content")) === "#0a0d13");

  // --- 35: printing -------------------------------------------------------------------------------
  await openChat(`A long one ${RUN}`);
  await page.getByText("message 24, line 12").first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${OUT}/appearance-before-print.png` });
  await page.emulateMedia({ media: "print" });
  const shown = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].some((el) => getComputedStyle(el).display !== "none"), sel);
  check("printing hides the chat list", !(await shown('aside[aria-label="Chats"]')));
  check("and the message box", !(await shown("[data-composer]")));
  check("and the buttons", !(await shown("header button")) && !(await shown("[data-msg] button")));
  check("the page is white, in print, whatever the theme", (await bodyBg()) === "rgb(255, 255, 255)", await bodyBg());
  check("with black text", (await css("[data-msg] .chat-text", "color")) === "rgb(0, 0, 0)", await css("[data-msg] .chat-text", "color"));
  check(
    "the conversation is let out of its scroll box",
    await page.evaluate(() => {
      const log = document.querySelector('[role="log"]');
      return getComputedStyle(log).overflowY === "visible" && log.scrollHeight <= log.clientHeight + 2;
    }),
  );
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  check("so the whole chat is laid out, not one screenful", pageHeight > 4000, `${pageHeight}px`);
  check("a message is kept whole on a page when it can be", (await css("[data-msg]", "breakInside")) === "avoid");
  const pdf = await page.pdf({ format: "A4" });
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  check("it prints as a PDF over several pages", pdf.subarray(0, 5).toString() === "%PDF-" && pages >= 4, `${pages} pages, ${pdf.length} bytes`);
  await page.emulateMedia({ media: "screen" });
  check("and the screen is untouched afterwards", (await shown('aside[aria-label="Chats"]')) && (await shown("[data-composer]")));

  // --- 36: offline ------------------------------------------------------------------------------------
  const banner = page.locator("[data-connection-banner]");
  check("online, there is no banner", (await banner.count()) === 0);
  await context.setOffline(true);
  await banner.waitFor({ timeout: 5000 });
  check("going offline shows a banner", (await banner.innerText()).includes("offline"), await banner.innerText());
  check("announced politely to a screen reader", (await page.locator("[data-connection-status]").getAttribute("role")) === "status");
  await page.screenshot({ path: `${OUT}/appearance-offline.png` });
  // Coming back online triggers a health check of its own; let it finish, or it
  // is still in flight (and swallows the next nudge) when the server is "stopped" below.
  const settledCheck = page.waitForResponse((r) => r.url().endsWith("/api/health"), { timeout: 10000 });
  await context.setOffline(false);
  await banner.waitFor({ state: "detached", timeout: 5000 });
  check("coming back takes it away", true);
  await settledCheck;

  await page.route("**/api/health", (route) => route.abort());
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await banner.waitFor({ timeout: 15000 });
  check("a server that stops answering shows one too", (await banner.innerText()).includes("Can't reach"), await banner.innerText());
  await page.unroute("**/api/health");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await banner.waitFor({ state: "detached", timeout: 15000 });
  check("and it goes when the server is back", true);

  // --- small screens ---------------------------------------------------------------------------------------------
  await setAppearance("theme", "light");
  await setAppearance("textSize", "xlarge");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload({ waitUntil: "networkidle" });
  check("no horizontal overflow at 390px, light and extra large", (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await page.screenshot({ path: `${OUT}/appearance-mobile.png` });
  check("the resize handle is for desktops only", !(await page.locator("[data-sidebar-resizer]").first().isVisible()));

  // A touch screen has no hover, so what hover reveals has to be there already.
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "light" });
  const phone = await touch.newPage();
  await phone.goto(BASE, { waitUntil: "networkidle" });
  await phone.locator("[data-msg]").first().waitFor({ timeout: 10000 });
  const rows = await phone.evaluate(() =>
    [...document.querySelectorAll("[data-msg] time")].map((t) => getComputedStyle(t.parentElement).opacity),
  );
  check("on a touch screen the message actions and times are always shown", rows.length > 0 && rows.every((o) => o === "1"), rows.join(","));
  await touch.close();

  check("no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  for (const id of made) await send(`/api/chats/${id}`, "DELETE", {}).catch(() => {});
  for (const id of made) await fetch(`${BASE}/api/trash?id=${id}`, { method: "DELETE" }).catch(() => {});
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
