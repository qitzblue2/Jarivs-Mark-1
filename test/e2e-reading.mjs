/**
 * Reading and moving around chats, in a real browser: find in a chat, the
 * outline, jumping between your messages, quoting, copying as plain text,
 * reading time, selecting several chats, exporting as a web page or a folder of
 * Markdown, and importing a chat from a file — each with an axe scan in both
 * themes. Same setup as test/e2e.mjs (mock provider + a server pointed at it):
 *   npm run test:reading
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", acceptDownloads: true });
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
async function open() {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("header button", { hasText: /mock-/ }).first().waitFor({ timeout: 10000 });
  await page.locator("[data-msg]").first().waitFor({ timeout: 5000 });
}
const composer = () => page.locator("#message-input");
const findCount = () => page.locator("[data-find-count]").innerText();
const highlightSize = (name) => page.evaluate((n) => CSS.highlights.get(n)?.size ?? 0, name);

const words = (n, w = "alpha") => Array.from({ length: n }, () => w).join(" ");
const BODY = "Here is the plan.\n\nFirst, **gather** the _tools_ and check [the docs](https://example.com/docs).\n\n- one thing\n- another thing\n\n```js\nconst needle = 1; // needle again\n```\n\n" + words(150, "padding") + ".";

try {
  // --- the chat everything below reads ----------------------------------------------------------
  const chat = await seedChat(`Reading ${RUN}`, [
    { role: "user", content: "What is the plan for the trip?" },
    { role: "assistant", content: BODY, model: "mock-fast-8b" },
    { role: "user", content: "And what should I pack? needle" },
    { role: "assistant", content: "Pack light. A needle and thread, a map, and water.", model: "mock-fast-8b" },
    ...Array.from({ length: 6 }, (_, i) => [{ role: "user", content: `Filler question ${i + 1} ${words(30)}` }, { role: "assistant", content: `Filler answer ${i + 1} ${words(60, "beta")}`, model: "mock-fast-8b" }]).flat(),
    { role: "user", content: "Last question: <b>thanks</b> & goodbye" },
    { role: "assistant", content: "You are welcome. Safe travels.", model: "mock-fast-8b" },
  ]);
  await open();

  // --- 61: find in this chat -------------------------------------------------------------------------
  check("find isn't showing until asked for", (await page.locator("[data-find-bar]").count()) === 0);
  await page.keyboard.press("Control+Shift+F");
  await page.locator("[data-find-input]").waitFor();
  check("Ctrl+Shift+F opens it with the cursor in the box", await page.evaluate(() => document.activeElement?.hasAttribute("data-find-input")));
  await page.keyboard.type("needle");
  await page.waitForFunction(() => /of/.test(document.querySelector("[data-find-count]")?.textContent ?? ""), null, { timeout: 3000 });
  check("typing counts the matches — code included", (await findCount()).trim() === "1 of 4", await findCount());
  check("each is marked on the page, and the current one differently", (await highlightSize("find-match")) === 4 && (await highlightSize("find-current")) === 1);
  await page.keyboard.press("Enter");
  check("Enter goes to the next", (await findCount()).trim() === "2 of 4");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.press("Shift+Enter");
  check("Shift+Enter goes back, and wraps round the other way", (await findCount()).trim() === "4 of 4");
  await page.keyboard.press("Enter");
  check("and forward wraps to the first", (await findCount()).trim() === "1 of 4");
  const inView = await page.evaluate(() => {
    const range = CSS.highlights.get("find-current").values().next().value;
    const rect = range.getBoundingClientRect();
    const box = document.getElementById("conversation").getBoundingClientRect();
    return rect.top >= box.top - 2 && rect.bottom <= box.bottom + 2;
  });
  check("the current match is scrolled into view", inView);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Copy");
  await page.waitForTimeout(200);
  check("the buttons under messages aren't searched", (await findCount()).trim() === "No matches", await findCount());
  check("no matches, no marks", (await highlightSize("find-match")) === 0);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("THE PLAN");
  await page.waitForTimeout(200);
  check("case doesn't matter", (await findCount()).trim() === "1 of 2", await findCount());
  await page.keyboard.press("Control+A");
  await page.keyboard.type("padd");
  await page.waitForTimeout(150);
  await page.keyboard.type("ing");
  await page.waitForTimeout(250);
  check("as the words grow the marks grow with them — even when the count stays the same", await page.evaluate(() => [...CSS.highlights.get("find-match")].every((r) => r.toString() === "padding") && CSS.highlights.get("find-match").size === 150));
  await axeBoth("find in this chat, with matches marked");
  await page.screenshot({ path: `${OUT}/reading-find.png` });
  await page.keyboard.press("Escape");
  check("Escape closes it, clears the marks and goes back to the message box", (await page.locator("[data-find-bar]").count()) === 0 && (await highlightSize("find-match")) === 0 && (await page.evaluate(() => document.activeElement?.id === "message-input")));

  // --- 62: the outline, and the tools menu --------------------------------------------------------------------
  await page.locator("[data-chat-tools-button]").click();
  check("the tools button opens a menu", (await page.locator('[data-chat-tools] [role="group"]').count()) === 1);
  await axeBoth("the chat tools menu");
  await page.locator('[data-tool="outline"]').click();
  const items = page.locator("[data-outline-item]");
  check("the outline lists every question you asked", (await items.count()) === 9, String(await items.count()));
  check("each as a short line", /What is the plan for the trip\?/.test(await items.first().innerText()) && /Last question/.test(await items.last().innerText()));
  await axeBoth("the outline open");
  await page.evaluate(() => document.getElementById("conversation").scrollTo({ top: 0 }));
  await items.last().click();
  await page.waitForFunction(() => {
    const last = [...document.querySelectorAll('[data-msg][data-role="user"]')].at(-1);
    const box = document.getElementById("conversation").getBoundingClientRect();
    const r = last?.getBoundingClientRect();
    return r && r.top < box.bottom - 40 && r.bottom > box.top + 20;
  }, null, { timeout: 3000 });
  check("choosing one scrolls to it, and the menu closes", (await page.locator("[data-chat-tools] [role=group]").count()) === 0);

  // --- 63: Alt+arrows between your messages -----------------------------------------------------------------------
  // Landing near the bottom re-pins the conversation to it a moment later; let that settle before moving the scroll.
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById("conversation").scrollTo({ top: 0 }));
  await page.waitForTimeout(300);
  await composer().evaluate((el) => el.blur());
  const topOfUserMessage = () => page.evaluate(() => {
    const box = document.getElementById("conversation").getBoundingClientRect();
    return [...document.querySelectorAll('[data-msg][data-role="user"]')].map((el) => Math.round(el.getBoundingClientRect().top - box.top));
  });
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(150);
  let tops = await topOfUserMessage();
  check("Alt+Down moves to your next message", tops.some((t) => Math.abs(t) <= 12) && tops[1] !== undefined && Math.abs(tops[1]) <= 12, tops.slice(0, 3).join(","));
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(150);
  tops = await topOfUserMessage();
  check("and the one after", Math.abs(tops[2]) <= 12, tops.slice(0, 4).join(","));
  await page.keyboard.press("Alt+ArrowUp");
  await page.waitForTimeout(150);
  tops = await topOfUserMessage();
  check("Alt+Up goes back", Math.abs(tops[1]) <= 12, tops.slice(0, 3).join(","));
  await composer().fill("something typed");
  const before = await page.evaluate(() => document.getElementById("conversation").scrollTop);
  await composer().press("Alt+ArrowDown");
  await page.waitForTimeout(150);
  check("in the box with text in it, the keys are left to the text", (await page.evaluate(() => document.getElementById("conversation").scrollTop)) === before);
  await composer().fill("");

  // --- 64: quote ---------------------------------------------------------------------------------------------------------
  const assistantTwo = page.locator('[data-msg][data-role="assistant"]').nth(1);
  await assistantTwo.hover();
  await assistantTwo.locator("[data-quote]").click();
  check("Quote starts your message with theirs, line by line", (await composer().inputValue()) === "> Pack light. A needle and thread, a map, and water.\n\n");
  check("with the cursor after it", await page.evaluate(() => document.activeElement?.id === "message-input" && document.activeElement.selectionStart === document.activeElement.value.length));
  await composer().type("Is that enough?");
  const assistantOne = page.locator('[data-msg][data-role="assistant"]').first();
  await assistantOne.hover();
  await assistantOne.locator("[data-quote]").click();
  const quoted = await composer().inputValue();
  check("a second quote goes below what you've typed", quoted.startsWith("> Pack light.") && quoted.includes("Is that enough?\n\n> Here is the plan."), quoted.slice(0, 160));
  check("a long reply is cut", quoted.includes("…"));
  const countBefore = await page.locator("[data-msg]").count();
  await page.waitForTimeout(200);
  check("and nothing is sent", (await page.locator("[data-msg]").count()) === countBefore);
  await composer().fill("");

  // --- 65: copy as plain text -----------------------------------------------------------------------------------------------
  await assistantOne.scrollIntoViewIfNeeded();
  await assistantOne.hover();
  await assistantOne.locator("[data-copy-text]").click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check("Copy text drops the markup", !/\*\*|^#|```|\]\(/m.test(clip) && clip.includes("gather the tools and check the docs (https://example.com/docs).") && clip.includes("• one thing"), clip.slice(0, 120));
  check("but keeps code as it was", clip.includes("const needle = 1; // needle again"));
  check("and the button says it copied", /Copied/.test(await assistantOne.locator("[data-copy-text]").innerText()));
  check("the first user message has no 'Copy text' — it is already plain", (await page.locator('[data-msg][data-role="user"]').first().locator("[data-copy-text]").count()) === 0);

  // --- 66: reading time ---------------------------------------------------------------------------------------------------------
  check("a long reply says how long it takes to read", /^~1 min read · 1\d\d words$/.test(((await assistantOne.locator("[data-reading]").innerText()) ?? "").trim()), await assistantOne.locator("[data-reading]").innerText().catch(() => "none"));
  check("a short one doesn't", (await assistantTwo.locator("[data-reading]").count()) === 0);

  // --- 68: export as a web page ------------------------------------------------------------------------------------------------------
  const html = await (await fetch(`${BASE}/api/chats/${chat.id}/export?format=html`)).text();
  const htmlHead = await fetch(`${BASE}/api/chats/${chat.id}/export?format=html`);
  check("the page download is HTML, as an attachment, with a policy that forbids everything but its own styles", /text\/html/.test(htmlHead.headers.get("content-type") ?? "") && /attachment; filename="reading-[a-z0-9]+\.html"/.test(htmlHead.headers.get("content-disposition") ?? "") && /default-src 'none'/.test(htmlHead.headers.get("content-security-policy") ?? ""));
  check("it holds the conversation", html.includes("What is the plan for the trip?") && html.includes("Pack light."));
  check("what a message says is never markup", html.includes("&lt;b&gt;thanks&lt;/b&gt; &amp; goodbye") && !html.includes("<b>thanks</b>"));
  check("code is in a block", html.includes("<pre data-lang=\"js\"><code>const needle = 1; // needle again</code></pre>"));
  check("it has no scripts and no outside links", !/<script/i.test(html) && !/(src|href)=/i.test(html));
  await page.locator("[data-chat-tools-button]").click();
  check("the menu has the link", (await page.locator('[data-tool="html"]').getAttribute("href")) === `/api/chats/${chat.id}/export?format=html`);
  await page.keyboard.press("Escape");

  // --- 67: select several chats --------------------------------------------------------------------------------------------------------
  const a = await seedChat(`Bulk A ${RUN}`, [{ role: "user", content: "a" }, { role: "assistant", content: "a" }]);
  const b = await seedChat(`Bulk B ${RUN}`, [{ role: "user", content: "b" }, { role: "assistant", content: "b" }]);
  const c = await seedChat(`Bulk C ${RUN}`, [{ role: "user", content: "c" }, { role: "assistant", content: "c" }]);
  await open();
  const rail = page.locator('aside[aria-label="Chats"]');
  const titleBefore = await page.locator("h1").first().innerText();
  await rail.locator("[data-select-mode]").click();
  check("select mode shows a box on every chat and a bar below", (await rail.locator("[data-select-chat]").count()) >= 4 && (await page.locator("[data-bulk-bar]").count()) === 1);
  check("with nothing picked, the actions are off", await rail.locator('[data-bulk="trash"]').isDisabled());
  const countText = () => rail.locator("[data-bulk-count]").innerText();
  check("and it says what to do", /Pick the chats/.test(await countText()));
  await rail.locator(`[data-select-chat="${a.id}"]`).click();
  await rail.locator(`[data-chat-row="${b.id}"] button`).nth(1).click();
  check("a box, or the title, picks a chat", /2 selected/.test(await countText()) && (await rail.locator(`[data-select-chat="${a.id}"]`).getAttribute("aria-checked")) === "true");
  check("picking doesn't open the chat", (await page.locator("h1").first().innerText()) === titleBefore);
  await axeBoth("choosing several chats");
  await rail.locator('[data-bulk="tag"]').click();
  await rail.locator("[data-bulk-tag-input]").fill("Trip Plans");
  await rail.locator("[data-bulk-tag-input]").press("Enter");
  await page.locator("text=Tagged 2 chats #trip-plans.").first().waitFor({ timeout: 5000 });
  check("tagging adds a tag to each, tidied", (await json("/api/chats")).chats.filter((x) => [a.id, b.id].includes(x.id)).every((x) => x.tags?.includes("trip-plans")));
  check("and leaves select mode", (await page.locator("[data-bulk-bar]").count()) === 0);
  await rail.locator("[data-select-mode]").click();
  await rail.locator(`[data-select-chat="${b.id}"]`).click();
  await rail.locator(`[data-select-chat="${c.id}"]`).click();
  await rail.locator('[data-bulk="archive"]').click();
  await page.locator("text=Archived 2 chats.").first().waitFor({ timeout: 5000 });
  check("archiving moves them out of the list", (await json("/api/chats")).chats.filter((x) => [b.id, c.id].includes(x.id)).every((x) => x.archived === true));
  await rail.locator("[data-select-mode]").click();
  await rail.locator(`[data-select-chat="${a.id}"]`).click();
  await rail.locator('[data-bulk="trash"]').click();
  await page.locator("text=Moved 1 chat to the trash").first().waitFor({ timeout: 5000 });
  check("trashing moves them to the trash, where they can be restored", !(await json("/api/chats")).chats.some((x) => x.id === a.id) && (await json("/api/trash")).chats.some((x) => x.id === a.id));

  // --- 69: import a chat ------------------------------------------------------------------------------------------------------------------
  const exported = await (await fetch(`${BASE}/api/chats/${chat.id}/export?format=json`)).text();
  await page.locator('aside[aria-label="Chats"] button[title="Settings"], button[title="Settings"]').first().click();
  const dialog = page.locator('[role="dialog"][aria-labelledby="settings-title"]');
  await dialog.waitFor();
  const dataSection = dialog.locator("[data-data-settings]");
  await dataSection.scrollIntoViewIfNeeded();
  await dataSection.locator("[data-import-file]").setInputFiles({ name: "export.json", mimeType: "application/json", buffer: Buffer.from(exported) });
  await dataSection.locator("[data-data-note]").waitFor({ timeout: 8000 });
  const note = await dataSection.locator("[data-data-note]").innerText();
  check("an exported chat can be imported", /^Imported “Reading [a-z0-9]+” — 18 messages/.test(note), note);
  const chatsNow = (await json("/api/chats")).chats;
  const imported = chatsNow.filter((x) => x.title === `Reading ${RUN}` && x.id !== chat.id);
  imported.forEach((x) => made.push(x.id));
  check("as a new chat, beside the original", imported.length === 1 && chatsNow.some((x) => x.id === chat.id));
  await page.waitForFunction((t) => [...document.querySelectorAll("[data-chat-row]")].filter((r) => r.textContent.includes(t)).length >= 2, `Reading ${RUN}`, { timeout: 5000 });
  check("and it shows in the list without a reload", true);
  await dataSection.locator("[data-import-file]").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"nope":true}') });
  await page.waitForFunction(() => /no messages/.test(document.querySelector("[data-data-note]")?.textContent ?? ""), null, { timeout: 5000 });
  check("a file that isn't a chat is refused, with a reason", true);
  await dataSection.locator("[data-import-file]").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("not json at all") });
  await page.waitForFunction(() => /valid JSON/.test(document.querySelector("[data-data-note]")?.textContent ?? ""), null, { timeout: 5000 });
  check("and so is one that isn't JSON", true);
  check("a page on another site can't post here: it needs application/json", (await fetch(`${BASE}/api/chats/import`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: exported })).status === 415);
  const hostile = await send("/api/chats/import", "POST", { chat: { title: "../../etc/passwd", id: "../../x", messages: [{ role: "user", content: "hi", id: "../y" }] } });
  const hostileBody = await hostile.json();
  made.push(hostileBody.chat?.id);
  check("a hostile file can only add a chat: ids and titles are not paths", hostile.status === 201 && /^[A-Za-z0-9_-]{1,128}$/.test(hostileBody.chat.id) && hostileBody.chat.id !== "../../x");
  await axeBoth("Settings with the chat import and export");

  // --- 70: every chat as Markdown --------------------------------------------------------------------------------------------------------
  const zip = await fetch(`${BASE}/api/export/markdown`);
  const bytes = Buffer.from(await zip.arrayBuffer());
  check("every chat can be downloaded as a zip", zip.status === 200 && /application\/zip/.test(zip.headers.get("content-type") ?? "") && bytes.subarray(0, 2).toString() === "PK" && /jarvis-chats-\d{4}-\d\d-\d\d\.zip/.test(zip.headers.get("content-disposition") ?? ""));
  const text = bytes.toString("latin1");
  check("with one dated, titled .md file per chat", new RegExp(`chats/\\d{4}-\\d\\d-\\d\\d-reading-${RUN}\\.md`).test(text) && text.includes(`chats/`) && (text.match(new RegExp(`reading-${RUN}(-2)?\\.md`, "g")) ?? []).length >= 2);
  check("holding the Markdown itself", text.includes("## You") && text.includes("What is the plan for the trip?"));
  await page.keyboard.press("Escape");

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
