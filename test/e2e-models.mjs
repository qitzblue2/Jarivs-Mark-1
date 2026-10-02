/**
 * Models and memory, in a real browser: persona presets, the context meter,
 * favourite models, regenerating with a different model, memory search, tags,
 * export and import, and unit conversion through the calculator — plus an axe
 * scan of the new panels in both themes.
 * Same setup as test/e2e.mjs (mock provider + a server pointed at it).
 *
 * Seeds its own chats and memory and removes every one it made.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const madeChats = [];
const madeMemory = [];
async function seedChat(title, messages) {
  const { chat } = await (await send("/api/chats", "POST", { title })).json();
  madeChats.push(chat.id);
  await send(`/api/chats/${chat.id}`, "PATCH", {
    messages: messages.map((m, i) => ({ id: `${chat.id}-${i}`, createdAt: Date.now() + i, ...m })),
  });
  await new Promise((r) => setTimeout(r, 30));
  return chat;
}
async function seedMemory(text, tags = []) {
  await send("/api/memory", "POST", { text, tags });
  const entry = (await json("/api/memory")).entries.find((e) => e.text === text);
  madeMemory.push(entry.id);
  return entry;
}

const regen = await seedChat(`Which model ${RUN}`, [
  { role: "user", content: "which model are you?" },
  { role: "assistant", content: "I am mock-fast-8b.", provider: "groq", model: "mock-fast-8b" },
]);
const memories = [
  await seedMemory(`Atlas ${RUN} is the Rust project`, ["work", "always"]),
  await seedMemory(`Atlas ${RUN} deadline is in March`, ["work"]),
  await seedMemory(`Prefers dark roast ${RUN}`, ["food"]),
  await seedMemory(`Untagged note ${RUN}`, []),
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });
page.on("dialog", (d) => d.accept());

const composer = () => page.getByLabel("Message");
async function openChat(title) {
  await page.locator("[data-chat-row]").filter({ has: page.getByText(title, { exact: true }) }).first().click({ position: { x: 20, y: 10 } });
}
async function openSettings() {
  await page.locator('button[title="Settings"]').first().click();
  const dialog = page.locator('[role="dialog"][aria-labelledby="settings-title"]');
  await dialog.waitFor({ timeout: 5000 });
  return dialog;
}
async function closeSettings(dialog) {
  await dialog.getByRole("button", { name: "Close" }).click();
  await dialog.waitFor({ state: "detached" });
}
async function ask(text, waitFor) {
  await composer().fill(text);
  await page.keyboard.press("Enter");
  await page.getByText(waitFor).first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector(".streaming-caret"), null, { timeout: 20000 });
}
async function axe(label) {
  if ((await page.evaluate(() => typeof window.axe)) === "undefined") await page.addScriptTag({ path: AXE });
  await page.addStyleTag({ content: "[data-msg] .opacity-0 { opacity: 1 !important } *, *::before, *::after { transition: none !important; }" });
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

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("header button", { hasText: /mock-/ }).first().waitFor({ timeout: 10000 });
  await openChat(`Which model ${RUN}`);
  await page.getByText("I am mock-fast-8b.").first().waitFor({ timeout: 10000 });
  const pickerButton = () => page.locator("header button", { hasText: /mock-/ }).first();

  // --- 37: persona presets -----------------------------------------------------
  let dialog = await openSettings();
  const picker = dialog.locator("[data-persona-picker] select");
  const persona = dialog.getByLabel("Persona", { exact: true });
  check("the persona starts as the default preset", (await picker.inputValue()) === "jarvis");
  const options = await picker.locator("option").allInnerTexts();
  check("the presets are offered by name", ["JARVIS", "Brief", "Teacher", "Code reviewer", "Editor", "Brainstorm"].every((n) => options.some((o) => o.startsWith(n))), options.join(" | "));
  await picker.selectOption("teacher");
  check("choosing one fills the box", (await persona.inputValue()).startsWith("You are JARVIS, a patient teacher."));
  check("and keeps the rules about tools, memory and code", (await persona.inputValue()).includes("Code: always fence with a language tag"));
  await persona.press("End");
  await persona.type(" Be kind.");
  check("editing it makes it your own", (await picker.inputValue()) === "" && (await picker.locator("option:checked").innerText()) === "Custom");
  await picker.selectOption("teacher");
  check("and choosing a preset again puts it back", !(await persona.inputValue()).includes("Be kind."));
  await page.screenshot({ path: `${OUT}/models-persona.png` });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.locator("button", { hasText: "New chat" }).first().click();
  await ask("teach me something", "Let's start from what you already know");
  check("the preset reaches the model", true);

  // Back to the default, so nothing later depends on this.
  dialog = await openSettings();
  await dialog.locator("[data-persona-picker] select").selectOption("jarvis");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "detached" });

  await openChat(`Which model ${RUN}`);
  await page.getByText("I am mock-fast-8b.").first().waitFor({ timeout: 10000 });
  await page.locator("[data-chat-instructions]").click();
  const instructions = page.locator('[role="dialog"][aria-label="Chat instructions"]');
  await instructions.waitFor();
  check("a chat's own instructions have the presets too", (await instructions.locator("[data-persona-picker] select option").count()) >= 6);
  check("starting from 'use the Settings instructions'", (await instructions.locator("[data-persona-picker] select option:checked").innerText()).startsWith("Use the Settings"));
  await instructions.locator("[data-persona-picker] select").selectOption("reviewer");
  check("a preset fills them", (await instructions.getByLabel("Instructions for this chat").inputValue()).startsWith("You are JARVIS, a blunt senior code reviewer."));
  await instructions.getByRole("button", { name: "Cancel" }).click();
  await instructions.waitFor({ state: "detached" });

  // --- 38: the context meter ---------------------------------------------------
  const meter = page.locator("[data-context-meter]");
  await meter.waitFor({ timeout: 5000 });
  check("a chat shows how full the request is", (await meter.getAttribute("role")) === "meter");
  const limit = Number(await meter.getAttribute("aria-valuemax"));
  const baseline = Number(await meter.getAttribute("aria-valuenow"));
  check("measured against the request budget, not the window (Groq's is 3,500)", limit === 3500, String(limit));
  check("with the instructions and tool list already counted", baseline > 800 && baseline < limit, `${baseline} of ${limit}`);
  check("and the label says so in words", (await meter.innerText()).includes("/ 3.5k"), await meter.innerText());
  const levelOf = () => meter.getAttribute("data-level");
  const startLevel = await levelOf();
  const room = limit - baseline;
  await composer().fill("x".repeat(Math.round(room * 4 * 0.85)));
  await page.waitForFunction(() => document.querySelector("[data-context-meter]")?.getAttribute("data-level") === "warn", null, { timeout: 3000 });
  check("what you are typing counts, and it warns past 70%", (await meter.innerText()).includes("getting long"), await meter.innerText());
  await page.screenshot({ path: `${OUT}/models-meter-warn.png` });
  await composer().fill("x".repeat(Math.round(room * 4 * 1.6)));
  await page.waitForFunction(() => document.querySelector("[data-context-meter]")?.getAttribute("data-level") === "full", null, { timeout: 3000 });
  check("past the ceiling it says older messages are being left out", (await meter.innerText()).includes("older messages are being left out"), await meter.innerText());
  check("and the value stops at the limit", Number(await meter.getAttribute("aria-valuenow")) === limit);
  await composer().fill("");
  await page.waitForFunction((l) => document.querySelector("[data-context-meter]")?.getAttribute("data-level") === l, startLevel, { timeout: 3000 });
  check("clearing the box brings it back", Number(await meter.getAttribute("aria-valuenow")) === baseline);

  // --- 39: favourite models ------------------------------------------------------
  await pickerButton().click();
  const list = page.locator("[data-model-list]");
  await list.waitFor();
  check("no favourites, no favourites section", (await list.locator("[data-model-favorites]").count()) === 0);
  const star = list.locator('[data-favorite-toggle="groq:mock-smart-120b"]');
  check("each model has a star", (await star.getAttribute("aria-pressed")) === "false" && /Add mock-smart-120b to favourites/.test((await star.getAttribute("aria-label")) ?? ""));
  await star.click();
  check("starring one lists it at the top", (await list.locator("[data-model-favorites] [data-favorite-row]").innerText()).includes("mock-smart-120b"));
  check("and the star shows as pressed", (await star.getAttribute("aria-pressed")) === "true");
  await page.screenshot({ path: `${OUT}/models-favorites.png` });
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "networkidle" });
  await pickerButton().click();
  check("a favourite survives a reload", (await page.locator("[data-model-favorites] [data-favorite-row]").count()) === 1);
  await page.locator("[data-model-favorites] [data-favorite-row]").click();
  check("choosing it from there selects it", (await page.locator("header button", { hasText: /mock-smart-120b/ }).count()) >= 1);
  await page.reload({ waitUntil: "networkidle" });
  await pickerButton().click();
  await page.locator('[data-favorite-toggle="groq:mock-smart-120b"]').click();
  check("starring again removes it", (await page.locator("[data-model-favorites]").count()) === 0);
  await page.keyboard.press("Escape");
  // A star for a model that is gone is ignored rather than offered.
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem("jarvis.settings.v1") ?? "{}");
    settings.favorites = ["groq:retired-model-9000", "nokey:whatever"];
    localStorage.setItem("jarvis.settings.v1", JSON.stringify(settings));
  });
  await page.reload({ waitUntil: "networkidle" });
  await pickerButton().click();
  check("a star for a model that no longer exists is not offered", (await page.locator("[data-model-favorites]").count()) === 0);
  await page.keyboard.press("Escape");

  // --- 40: regenerate with a different model ----------------------------------------
  await openChat(`Which model ${RUN}`);
  await page.getByText("I am mock-fast-8b.").first().waitFor({ timeout: 10000 });
  const last = page.locator("[data-msg]").last();
  await last.hover();
  const chevron = last.locator("[data-regenerate-with]");
  check("the last reply offers 'regenerate with another model'", (await chevron.count()) === 1 && (await chevron.getAttribute("aria-label")) === "Regenerate with another model");
  await chevron.click();
  const menu = last.locator("[data-model-list]");
  await menu.waitFor();
  check("a list of models opens, labelled", (await menu.getAttribute("aria-label")) === "Regenerate with another model");
  check("without the probe and footnote that belong to the header picker", (await menu.getByText("Can this model use tools?").count()) === 0);
  check("and without providers that have no key — this isn't the place to be asked for one", (await menu.getByText("No key yet").count()) === 0 && (await menu.getByText("Groq").count()) === 1);
  const menuBox = await menu.boundingBox();
  const viewport = page.viewportSize();
  check("the list is fully on screen (a reply near the top can't push it off)", menuBox.y >= 0 && menuBox.y + menuBox.height <= viewport.height && menuBox.x >= 0 && menuBox.x + menuBox.width <= viewport.width, JSON.stringify(menuBox));
  check("and its models can be reached by scrolling the list, not the page", (await menu.locator("[data-model-row]").count()) >= 3);
  await page.screenshot({ path: `${OUT}/models-regenerate.png` });
  await menu.locator('[data-model-row]', { hasText: "mock-smart-120b" }).click();
  await page.getByText("I am mock-smart-120b.").first().waitFor({ timeout: 20000 });
  check("the other model answered, and was told as itself", true);
  await page.waitForFunction(() => !document.querySelector(".streaming-caret"), null, { timeout: 20000 });
  check("the new reply names the model that wrote it", (await page.locator("[data-msg]").last().innerText()).includes("mock-smart-120b"));
  check("it replaced the old one rather than adding to it", (await page.locator("[data-msg]").count()) === 2);
  check("and the picker moved to it", (await page.locator("header button", { hasText: /mock-smart-120b/ }).count()) >= 1);
  const saved = (await json(`/api/chats/${regen.id}`)).chat;
  check("the chat remembers it", saved.messages.length === 2 && saved.messages[1].model === "mock-smart-120b" && saved.model === "mock-smart-120b", `${saved.messages[1]?.model} / ${saved.model}`);

  // --- 43: units through the calculator ----------------------------------------------
  await page.locator("button", { hasText: "New chat" }).first().click();
  await ask("convert 72 F in C", "22.22222");
  check("a conversion goes through calculate and comes back", (await page.locator("[data-msg]").last().innerText()).includes("72 °F = 22.22222 °C"));
  await ask("convert 5 km to kg", "Can't convert length");
  check("one that makes no sense says why", true);
  await ask("calculate 6*7", "The calculator says");
  check("and arithmetic is as before", true);

  // --- 41, 42: memory ---------------------------------------------------------------------
  dialog = await openSettings();
  const memory = dialog.locator("[data-memory]");
  await memory.scrollIntoViewIfNeeded();
  const rows = () => memory.locator("[data-memory-entry]");
  const search = memory.locator("[data-memory-search]");
  check("the memory section shows the count", Number(await memory.locator("[data-memory-count]").innerText()) >= 4);
  await search.fill(`atlas ${RUN}`);
  check("searching narrows to matching entries", (await rows().count()) === 2, String(await rows().count()));
  check("and says how many of how many", /2 of \d+/.test(await memory.locator("[data-memory-matches]").innerText()));
  await search.fill(`${RUN} march`);
  check("every word must match, in any order", (await rows().count()) === 1);
  await search.fill(`zebra ${RUN}`);
  check("no match says so", (await memory.getByText("Nothing matches.").count()) === 1);
  await search.fill(RUN);
  check("all four of ours carry the run id", (await rows().count()) === 4);

  const workChip = memory.locator('[data-memory-tag="work"]');
  check("tags are listed with counts", /#work\s*2/.test(await workChip.innerText()), await workChip.innerText());
  await workChip.click();
  check("a tag chip filters to it", (await rows().count()) === 2 && (await workChip.getAttribute("aria-pressed")) === "true");
  await memory.locator('[data-memory-tag="food"]').click();
  check("choosing another switches", (await rows().count()) === 1);
  await memory.locator('[data-memory-tag="food"]').click();
  check("choosing it again clears the filter", (await rows().count()) === 4);
  await page.screenshot({ path: `${OUT}/models-memory.png` });

  await search.fill(`deadline ${RUN}`);
  await rows().first().hover();
  await rows().first().getByRole("button", { name: /^Edit:/ }).click();
  const tagBox = rows().first().getByLabel("Tags, separated by commas");
  check("editing shows the tags to change", (await tagBox.inputValue()) === "work");
  await rows().first().getByLabel("Edit what is remembered").fill(`Atlas ${RUN} deadline is in April`);
  await tagBox.fill("work, urgent");
  await tagBox.press("Enter");
  await page.waitForFunction((t) => [...document.querySelectorAll("[data-memory-entry]")].some((e) => e.textContent.includes(t)), "in April", { timeout: 5000 });
  const edited = (await json("/api/memory")).entries.find((e) => e.id === memories[1].id);
  check("an edit changes the words and the tags", edited.text.endsWith("in April") && JSON.stringify(edited.tags) === '["work","urgent"]', JSON.stringify(edited.tags));
  // The old bug: editing text alone wiped tags — including the one that keeps it in every chat.
  await search.fill(`rust ${RUN}`);
  await rows().first().hover();
  await rows().first().getByRole("button", { name: /^Edit:/ }).click();
  await rows().first().getByLabel("Edit what is remembered").fill(`Atlas ${RUN} is the Rust project (v2)`);
  await rows().first().getByLabel("Edit what is remembered").press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-memory-entry]")].some((e) => e.textContent.includes("(v2)")), null, { timeout: 5000 });
  const pinned = (await json("/api/memory")).entries.find((e) => e.id === memories[0].id);
  check("an edit never loses the 'always' tag", JSON.stringify(pinned.tags) === '["work","always"]', JSON.stringify(pinned.tags));
  await search.fill("");

  const [download] = await Promise.all([page.waitForEvent("download"), memory.locator("[data-memory-export]").click()]);
  check("Export downloads a JSON file named for the day", /^jarvis-memory-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), download.suggestedFilename());
  const exportPath = `${OUT}/models-export.json`;
  await download.saveAs(exportPath);
  const exported = JSON.parse(readFileSync(exportPath, "utf8"));
  check("it says what it is", exported.format === "jarvis-memory" && exported.version === 1);
  check("holds the entries, with tags", exported.entries.some((e) => e.text.includes("(v2)") && e.tags.includes("always")));
  check("and nothing about this install", !JSON.stringify(exported).includes(memories[0].id) && exported.entries.every((e) => !("id" in e)));

  const incoming = `${OUT}/models-import.json`;
  writeFileSync(incoming, JSON.stringify({
    format: "jarvis-memory", version: 1,
    entries: [
      { text: `Prefers DARK roast ${RUN}`, tags: [] },
      { text: `Imported fact ${RUN}`, tags: ["Trip"] },
      { text: `Imported pinned fact ${RUN}`, tags: ["always"] },
      { text: "   " },
    ],
  }));
  await memory.locator("[data-memory-import]").setInputFiles(incoming);
  const note = memory.locator("[data-memory-note]");
  await note.waitFor({ timeout: 5000 });
  check("importing reports what was added", (await note.innerText()).startsWith("Added 2"), await note.innerText());
  check("what it skipped, and why", /1 already remembered/.test(await note.innerText()) && /1 unusable/.test(await note.innerText()));
  check("and flags what is pinned into every chat", /1 is tagged "always"/.test(await note.innerText()));
  const afterImport = (await json("/api/memory")).entries;
  for (const e of afterImport.filter((x) => x.text.includes(`Imported`) && x.text.includes(RUN))) madeMemory.push(e.id);
  check("the new entries are there, tags cleaned", afterImport.some((e) => e.text === `Imported fact ${RUN}` && JSON.stringify(e.tags) === '["trip"]'));
  check("the duplicate was not added again", afterImport.filter((e) => e.text.toLowerCase() === `prefers dark roast ${RUN}`).length === 1);
  await page.screenshot({ path: `${OUT}/models-import.png` });

  writeFileSync(incoming, "{this is not json");
  await memory.locator("[data-memory-import]").setInputFiles(incoming);
  await page.waitForFunction(() => document.querySelector("[data-memory-note]")?.textContent?.includes("valid JSON"), null, { timeout: 5000 });
  check("a file that isn't JSON is refused, kindly", (await note.innerText()).includes("isn't valid JSON"), await note.innerText());
  writeFileSync(incoming, JSON.stringify({ format: "jarvis-settings", version: 1 }));
  await memory.locator("[data-memory-import]").setInputFiles(incoming);
  await page.waitForFunction(() => document.querySelector("[data-memory-note]")?.textContent?.includes("memory file"), null, { timeout: 5000 });
  check("and so is the wrong kind of file", (await note.innerText()).includes("doesn't look like a JARVIS memory file"));
  await closeSettings(dialog);

  // --- accessibility of what is new ------------------------------------------------------------
  dialog = await openSettings();
  await axe("dark, Settings with presets and memory");
  await closeSettings(dialog);
  await pickerButton().click();
  await page.locator('[data-favorite-toggle="groq:mock-smart-120b"]').click();
  await axe("dark, the model picker with a favourite");
  await page.locator('[data-favorite-toggle="groq:mock-smart-120b"]').click();
  await page.keyboard.press("Escape");
  await openChat(`Which model ${RUN}`);
  await page.locator("[data-msg]").last().hover();
  await page.locator("[data-msg]").last().locator("[data-regenerate-with]").click();
  await page.locator("[data-msg]").last().locator("[data-model-list]").waitFor();
  await axe("dark, the regenerate menu");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem("jarvis.appearance") ?? "{}");
    localStorage.setItem("jarvis.appearance", JSON.stringify({ ...a, theme: "light" }));
  });
  await page.reload({ waitUntil: "networkidle" });
  dialog = await openSettings();
  await axe("light, Settings with presets and memory");
  await closeSettings(dialog);
  await pickerButton().click();
  await axe("light, the model picker");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${OUT}/models-light.png` });

  check("no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  for (const id of madeChats) {
    await send(`/api/chats/${id}`, "DELETE", {}).catch(() => {});
    await fetch(`${BASE}/api/trash?id=${id}`, { method: "DELETE" }).catch(() => {});
  }
  for (const id of madeMemory) await fetch(`${BASE}/api/memory?id=${id}`, { method: "DELETE" }).catch(() => {});
  // Any chat the run started by clicking "New chat" is titled from its first message.
  for (const c of (await json("/api/chats").catch(() => ({ chats: [] }))).chats) {
    if (/^(teach me something|convert 72 F)/.test(c.title)) {
      await send(`/api/chats/${c.id}`, "DELETE", {}).catch(() => {});
      await fetch(`${BASE}/api/trash?id=${c.id}`, { method: "DELETE" }).catch(() => {});
    }
  }
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
