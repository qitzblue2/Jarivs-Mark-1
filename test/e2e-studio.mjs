/**
 * Personalities, pictures and the tabbed Settings, in a real browser: the
 * tabs (keyboard, remembered, search across them), the personality dials and
 * saved personalities, /persona, the image studio and /image against the keyless
 * service, the Draw button, the gallery search — each with an axe scan in both
 * themes. Same setup as test/e2e.mjs (mock provider + a server pointed at it),
 * plus the free picture service pointed at the mock:
 *   JARVIS_POLLINATIONS_URL=http://localhost:8899 npm start
 *   npm run test:studio
 *
 * Seeds its own chats and removes every one it made (pictures it makes stay in
 * the gallery of the test data folder only).
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36).slice(-5);
const AXE = new URL("../node_modules/axe-core/axe.min.js", import.meta.url).pathname;
const SETTINGS_KEY = "jarvis.settings.v1";

let failed = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
};
const json = (path) => fetch(`${BASE}${path}`).then((r) => r.json());
const send = (path, method, body) => fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const made = [];
async function seedChat(title, messages) {
  const { chat } = await (await send("/api/chats", "POST", { title })).json();
  made.push(chat.id);
  await send(`/api/chats/${chat.id}`, "PATCH", { messages: messages.map((m, i) => ({ id: `${chat.id}-${i}`, createdAt: Date.now() + i, ...m })) });
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
const chatBodies = [];
page.on("request", (r) => { if (r.url().endsWith("/api/chat") && r.method() === "POST") { try { chatBodies.push(JSON.parse(r.postData() ?? "{}")); } catch { /* not json */ } } });

async function axe(label) {
  if ((await page.evaluate(() => typeof window.axe)) === "undefined") await page.addScriptTag({ path: AXE });
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
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
  await page.addInitScript(([sk, settings]) => {
    try {
      if (!sessionStorage.getItem("seeded")) {
        if (settings) localStorage.setItem(sk, settings);
        sessionStorage.setItem("seeded", "1");
      }
    } catch { /* a frame with no storage */ }
  }, [SETTINGS_KEY, seed.settings ? JSON.stringify(seed.settings) : ""]);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("header button", { hasText: /mock-/ }).first().waitFor({ timeout: 10000 });
}
const composer = () => page.locator("#message-input");
async function openSettings() {
  await page.locator('button[title="Settings"]').first().click();
  const dialog = page.locator('[role="dialog"][aria-labelledby="settings-title"]');
  await dialog.waitFor({ timeout: 5000 });
  return dialog;
}
const tab = (id) => page.locator(`[data-settings-tabs] [data-tab="${id}"]`);
const visible = (selector) => page.locator(selector).first().isVisible();

try {
  const chat = await seedChat(`Studio ${RUN}`, [{ role: "user", content: "hi" }, { role: "assistant", content: "Hello.", model: "mock-fast-8b" }]);
  await open({ settings: { keys: { groq: "gsk_test_key" } } });
  await page.getByText(`Studio ${RUN}`).first().click();
  await page.locator("[data-msg]").first().waitFor({ timeout: 5000 });

  // --- settings, as tabs ---------------------------------------------------------------------------
  let dialog = await openSettings();
  check("settings has seven tabs, the last showing everything", (await dialog.locator('[role="tab"]').count()) === 7 && (await tab("all").innerText()) === "Everything");
  check("it opens on keys and models, and only that tab's sections show", (await tab("models").getAttribute("aria-selected")) === "true" && (await visible("[data-model-settings]")) && !(await visible("[data-personality-settings]")) && !(await visible("[data-appearance]")));
  await tab("personality").click();
  check("choosing Personality shows its sections and hides the others", (await visible("[data-personality-settings]")) && !(await visible("[data-model-settings]")));
  await tab("personality").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  check("the right arrow moves to the next tab and focuses it", (await tab("pictures").getAttribute("aria-selected")) === "true" && (await page.evaluate(() => document.activeElement?.getAttribute("data-tab"))) === "pictures");
  await page.keyboard.press("End");
  check("End goes to the last tab, which shows every section", (await tab("all").getAttribute("aria-selected")) === "true" && (await visible("[data-about-settings]")) && (await visible("[data-model-settings]")) && (await visible("[data-personality-settings]")));
  await page.keyboard.press("ArrowRight");
  check("and the arrow wraps round to the first", (await tab("models").getAttribute("aria-selected")) === "true");
  check("only the chosen tab is in the tab order", (await dialog.locator('[role="tab"][tabindex="0"]').count()) === 1);
  await tab("look").click();
  check("Look has appearance and the look settings", (await visible("[data-appearance]")) && (await visible("[data-look-settings]")));
  await tab("assistant").click();
  check("Assistant has initiative and preferences", (await visible("[data-initiative-settings]")) && (await visible("[data-prefs-settings]")));
  await tab("models").click();
  await dialog.locator("[data-settings-search]").fill("quiet hours");
  check("searching looks through every tab, not just the one showing", (await visible("[data-initiative-settings]")) && !(await visible("[data-model-settings]")));
  await dialog.locator("[data-settings-search]").fill("");
  await tab("look").click();
  await page.keyboard.press("Escape");
  dialog = await openSettings();
  check("the tab you were on is remembered", (await tab("look").getAttribute("aria-selected")) === "true");
  await axeBoth("settings, Look tab");
  await tab("models").click();
  await axeBoth("settings, Keys & models tab");

  // --- personality -----------------------------------------------------------------------------------
  await tab("personality").click();
  await axeBoth("settings, Personality tab");
  const groups = await dialog.locator("[data-persona-picker] optgroup").evaluateAll((els) => els.map((e) => e.label));
  check("the picker is grouped", groups.join() === "Everyday,Work,Learning,Creative,Challenge", groups.join());
  check("twenty-one personalities in it", (await dialog.locator("[data-persona-picker] option").count()) === 21);
  await dialog.locator("[data-persona-picker] select").selectOption("socratic");
  check("choosing one fills the persona box", (await dialog.locator('textarea[aria-label="Persona"]').inputValue()).includes("Socratic guide"));
  const before = await dialog.locator('textarea[aria-label="Persona"]').inputValue();
  await dialog.locator("[data-persona-random]").click();
  check("Surprise me picks a different one", (await dialog.locator('textarea[aria-label="Persona"]').inputValue()) !== before);
  check("with nothing moved, the dials say nothing is added", ((await dialog.locator("[data-dial-preview]").innerText()) || "").includes("nothing is added"));
  await dialog.locator('[data-choice="dial-mood"] [data-value="buddy"]').click();
  check("a mood moves all four dials and says what is added", (await dialog.locator('[data-choice="dial-mood"] [data-value="buddy"]').getAttribute("aria-checked")) === "true" && (await dialog.locator('[data-dial="formality"]').inputValue()) === "0" && (await dialog.locator("[data-dial-preview]").innerText()).includes("Added to each reply"));
  await dialog.locator('[data-dial="detail"]').fill("4");
  check("moving a dial by hand leaves no mood selected", (await dialog.locator('[data-choice="dial-mood"] [aria-checked="true"]').count()) === 0);
  await dialog.locator("[data-persona-save-name]").fill("Pirate");
  await dialog.locator("[data-persona-save]").click();
  check("a personality can be kept under a name, and shows in the picker", (await dialog.locator("[data-persona-saved] li").count()) === 1 && (await dialog.locator('[data-persona-picker] optgroup[label="Yours"] option').count()) === 1);
  await dialog.locator("footer").getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });

  await composer().fill("Say something");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll("[data-msg]").length >= 4, null, { timeout: 15000 });
  const last = chatBodies.at(-1) ?? {};
  check("the dials travel as numbers, never as words", last.dials && last.dials.formality === 0 && last.dials.detail === 4 && typeof last.dials.humour === "number", JSON.stringify(last.dials));

  await page.waitForTimeout(1500); // the reply has finished; a command sent mid-stream is held back
  await composer().fill("/persona teacher");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  check("/persona teacher sets this chat's instructions", ((await json(`/api/chats/${chat.id}`)).chat.persona ?? "").includes("patient teacher"));
  await composer().fill("/persona zzzz");
  await page.keyboard.press("Enter");
  check("an unknown personality is said so, not guessed", (await page.getByText(/No single personality matches/).count()) >= 1);
  await composer().fill("/persona off");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  check("/persona off goes back to Settings", !(await json(`/api/chats/${chat.id}`)).chat.persona);

  // --- pictures --------------------------------------------------------------------------------------
  const bad = await send("/api/images/generate", "POST", { prompt: "x", count: 9 });
  const badStyle = await send("/api/images/generate", "POST", { prompt: "x", style: "nope" });
  const empty = await send("/api/images/generate", "POST", { prompt: " " });
  check("the picture route refuses a bad count, style or empty prompt", [bad.status, badStyle.status, empty.status].every((s) => s === 400), [bad.status, badStyle.status, empty.status].join());
  const status = await json("/api/images/generate");
  check("with no NanoGPT key the free service is what would draw", status.provider === "free");

  await composer().fill("hello there");
  check("no Draw button for ordinary text", (await page.locator("[data-draw-this]").count()) === 0);
  await composer().fill("draw a lighthouse in a storm");
  check("a message asking for a picture offers a Draw button", (await page.locator("[data-draw-this]").count()) === 1);
  await composer().fill("/image a red fox in the snow");
  await page.keyboard.press("Enter");
  const studio = page.locator("[data-image-studio]");
  await studio.waitFor({ timeout: 5000 });
  await studio.locator("[data-studio-result]").first().waitFor({ timeout: 20000 });
  check("/image opens the studio with the prompt and draws it", (await studio.locator("[data-studio-prompt]").inputValue()) === "a red fox in the snow" && (await studio.locator("[data-studio-result]").count()) === 1);
  check("the picture really loads", await studio.locator("[data-studio-result] img").first().evaluate((img) => img.complete && img.naturalWidth > 0));
  check("it says which service drew it", (await studio.locator("[data-studio-provider]").innerText()).includes("Free"));
  await axeBoth("the image studio with a result");

  await studio.locator('[data-choice="style"] [data-value="pixel"]').click();
  await studio.locator('[data-choice="shape"] [data-value="wide"]').click();
  await studio.locator('[data-choice="count"] [data-value="2"]').click();
  await studio.locator("[data-studio-prompt]").fill(`a tiny castle ${RUN}`);
  await studio.locator("#studio-avoid").fill("text");
  await studio.locator("[data-studio-make]").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-studio-result]").length === 2, null, { timeout: 30000 });
  const seeds = await studio.locator("[data-studio-result]").evaluateAll((els) => els.map((e) => e.textContent.match(/seed (\d+)/)?.[1]));
  check("two variations come back with different seeds", seeds.length === 2 && seeds[0] !== seeds[1], seeds.join());
  const gallery = await json("/api/images");
  const castle = gallery.images.filter((i) => i.prompt === `a tiny castle ${RUN}`);
  check("they are saved to the gallery with their style and seed", castle.length === 2 && castle.every((i) => i.style === "pixel" && typeof i.seed === "number"), JSON.stringify(castle.map((c) => [c.style, c.seed])));
  check("the choices are remembered for next time", await page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.studio.v1")).style === "pixel"));
  check("and the prompt appears under Recent", (await studio.locator("[data-studio-history] button").first().innerText()) === `a tiny castle ${RUN}`);

  await studio.getByRole("button", { name: "Close" }).click();
  await page.locator('button[title="Settings"]').first().click();
  dialog = page.locator('[role="dialog"][aria-labelledby="settings-title"]');
  await tab("pictures").click();
  check("Settings → Pictures says what draws", (await dialog.locator("[data-image-status]").innerText()).includes("Free"));
  await axeBoth("settings, Pictures tab");
  await dialog.locator("[data-open-studio]").click();
  check("and opens the studio", await studio.isVisible());
  await studio.getByRole("button", { name: "Open the gallery" }).click();
  const grid = page.locator('[role="dialog"][aria-label="Pictures"]');
  await grid.waitFor();
  await grid.locator("[data-picture]").first().waitFor();
  const total = await grid.locator("[data-picture]").count();
  await grid.locator("[data-gallery-search]").fill(`castle ${RUN}`);
  const filtered = await grid.locator("[data-picture]").count();
  check("the gallery filters by prompt", filtered === 2 && total > 2, `${filtered} of ${total}`);
  await grid.locator("[data-gallery-search]").fill("zzzz-nothing");
  check("and says when nothing matches", (await grid.locator("[data-gallery-none]").count()) === 1);
  await grid.locator("[data-gallery-search]").fill("");
  await axeBoth("the gallery");
  await grid.locator("[data-gallery-new]").click();
  check("New picture goes back to the studio", await studio.isVisible());

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
