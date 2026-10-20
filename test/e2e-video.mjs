/**
 * Video, end to end in a real browser against the mock standing in for Google's
 * Veo: no key means no video; with one, the studio composes the prompt (scene,
 * speech, sound, realism), makes one job at a time, plays the result, seeks it
 * with Range requests, keeps a library and refuses a second and a past-limit
 * video. Needs the server started with:
 *   JARVIS_GEMINI_VIDEO_URL=http://localhost:8899 \
 *   JARVIS_VIDEO_POLL_MS=300 JARVIS_VIDEO_DAILY_LIMIT=50 npm start
 *   npm run test:video
 * The server needs no Gemini key of its own: the suite sends one the way
 * Settings does (a header), and checks that without it nothing can be made.
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36).slice(-5);
const AXE = new URL("../node_modules/axe-core/axe.min.js", import.meta.url).pathname;
const MOCK_LOG = process.env.MOCK_LOG ?? new URL("./.mock.log", import.meta.url).pathname;

let failed = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
};
const KEY = { "x-jarvis-keys": JSON.stringify({ gemini: "test-gemini" }) };
const json = (path, init) => fetch(`${BASE}${path}`, init).then((r) => r.json());
const post = (path, body, headers = {}) => fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
await context.addInitScript(() => { try { localStorage.setItem("jarvis.settings-tab", "all"); } catch { /* storage blocked */ } });
const errors = [];
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });

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

const made = [];
try {
  // --- the API on its own ---------------------------------------------------------------------------
  const nokey = await json("/api/videos/generate");
  check("with no Gemini key, video is unavailable and says what to do", nokey.available === false && /Gemini key/.test(nokey.note), JSON.stringify(nokey));
  check("and starting one is refused, not attempted", (await post("/api/videos/generate", { scene: "x" })).status === 503);
  const status = await json("/api/videos/generate", { headers: KEY });
  check("with a key the server reports the model and that a key is present", status.available === true && status.model === "veo-3.0-generate-001" && typeof status.limit === "number", JSON.stringify(status));
  const bads = await Promise.all([post("/api/videos/generate", { scene: " " }, KEY), post("/api/videos/generate", { scene: "x", seconds: 5 }, KEY), post("/api/videos/generate", { scene: "x", aspect: "1:1" }, KEY)]);
  check("it refuses an empty scene, a bad length and a bad shape", bads.every((r) => r.status === 400), bads.map((r) => r.status).join());
  check("it won't make up a job that isn't there", (await fetch(`${BASE}/api/videos/jobs/nope`)).status === 404);
  check("a bad video id is refused, not looked up", (await fetch(`${BASE}/api/videos/..%2Fetc`)).status >= 400);

  // --- the studio -------------------------------------------------------------------------------------
  await page.addInitScript(() => { try { localStorage.setItem("jarvis.settings.v1", JSON.stringify({ keys: { groq: "gsk_test", gemini: "test-gemini" } })); } catch { /* no storage */ } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("header button", { hasText: /mock-/ }).first().waitFor({ timeout: 10000 });

  const composer = page.locator("#message-input");
  await composer.fill("/video a fisherman mends a net");
  await page.keyboard.press("Enter");
  const studio = page.locator("[data-video-studio]");
  await studio.waitFor({ timeout: 5000 });
  check("/video opens the studio with the words in it, and does NOT start anything", (await studio.locator("[data-video-scene]").inputValue()) === "a fisherman mends a net" && (await studio.locator("[data-video-progress]").count()) === 0 && (await json("/api/videos/generate", { headers: KEY })).running === null);
  check("it says it is a paid model", (await studio.locator("[data-video-status]").innerText()).toLowerCase().includes("paid"));
  check("1080p is unavailable until the clip is eight seconds of landscape", await studio.locator('[data-choice="quality"] [data-value="1080p"]').isDisabled() === false);
  await studio.locator('[data-choice="seconds"] [data-value="6"]').click();
  check("choosing six seconds switches 1080p off", await studio.locator('[data-choice="quality"] [data-value="1080p"]').isDisabled());
  await studio.locator('[data-choice="seconds"] [data-value="8"]').click();
  await axeBoth("the video studio");

  await studio.locator("[data-video-speech]").fill("Good catch today.");
  await studio.locator("[data-video-sound]").fill("gulls, water lapping");
  await studio.locator('[data-choice="aspect"] [data-value="9:16"]').click();
  await studio.locator("[data-video-make]").click();
  await studio.locator("[data-video-progress]").waitFor({ timeout: 5000 });
  check("a progress message and a clock appear while it is made", /Sending|Filming/.test(await studio.locator("[data-video-progress]").innerText()));
  check("a second video can't be started while one runs", (await post("/api/videos/generate", { scene: "another" }, KEY)).status === 429);
  await studio.locator("[data-video-player] video").waitFor({ timeout: 30000 });
  check("when it finishes the video is shown in a player with controls", await studio.locator("[data-video-player] video").evaluate((v) => v.controls === true && v.src.includes("/api/videos/")));
  const src = await studio.locator("[data-video-player] video").getAttribute("src");
  const log = readFileSync(MOCK_LOG, "utf8");
  const sent = log.split("\n").filter((l) => l.includes("[mock] video")).at(-1) ?? "";
  check("the model was sent the scene, the spoken words in quotes, the sounds and the realism wording", sent.includes("fisherman") && sent.includes('Dialogue, spoken aloud') && sent.includes("gulls") , sent.slice(0, 160));
  check("with the shape and length asked for, and a key", sent.includes('"aspectRatio":"9:16"') && sent.includes('"durationSeconds":8') && sent.includes("key=yes"), sent.slice(0, 200));
  check("the key is never in the page", !(await page.content()).includes("test-gemini"));

  const full = await fetch(`${BASE}${src}`);
  const body = Buffer.from(await full.arrayBuffer());
  check("it is served as video/mp4 and says it can be seeked", full.headers.get("content-type") === "video/mp4" && full.headers.get("accept-ranges") === "bytes" && body.slice(4, 8).toString() === "ftyp");
  const part = await fetch(`${BASE}${src}`, { headers: { Range: "bytes=0-99" } });
  check("a Range request gets 206 and exactly those bytes", part.status === 206 && (await part.arrayBuffer()).byteLength === 100 && part.headers.get("content-range") === `bytes 0-99/${body.length}`);
  check("a Range past the end is 416", (await fetch(`${BASE}${src}`, { headers: { Range: `bytes=${body.length + 5}-` } })).status === 416);
  check("download asks for a save dialog", (await fetch(`${BASE}${src}?download=1`)).headers.get("content-disposition")?.startsWith("attachment"));

  const lib = await json("/api/videos");
  const mine = lib.videos.find((v) => v.scene === "a fisherman mends a net");
  if (mine) made.push(mine.id);
  check("it is saved with how it was made", mine && mine.aspect === "9:16" && mine.seconds === 8 && mine.speech === "Good catch today." && mine.sound === "gulls, water lapping", JSON.stringify(mine));
  check("and listed in the studio's library", (await studio.locator(`[data-video-item="${mine?.id}"]`).count()) === 1);
  await axeBoth("the video studio with a result");

  // --- a refusal from the model is shown, not swallowed -----------------------------------------------
  await studio.locator("[data-video-scene]").fill("BLOCKME something");
  await studio.locator("[data-video-make]").click();
  await studio.locator("[data-video-error]").waitFor({ timeout: 30000 });
  check("a refused scene shows the model's reason", (await studio.locator("[data-video-error]").innerText()).includes("declined"));
  check("and the button is usable again", await studio.locator("[data-video-make]").isEnabled());

  // --- stop waiting ------------------------------------------------------------------------------------
  const started = await post("/api/videos/generate", { scene: "a long one" }, KEY);
  const jobId = (await started.json()).job?.id;
  const cancel = await fetch(`${BASE}/api/videos/jobs/${jobId}`, { method: "DELETE" });
  await new Promise((r) => setTimeout(r, 900));
  const after = await json(`/api/videos/jobs/${jobId}`);
  check("a job can be stopped, and says the provider may still charge", cancel.ok && after.job.status === "cancelled" && /charged/.test(after.job.error ?? ""), JSON.stringify(after.job));

  // --- settings and the palette ------------------------------------------------------------------------
  await studio.getByRole("button", { name: "Close" }).click();
  await page.locator('button[title="Settings"]').first().click();
  const settings = page.locator('[role="dialog"][aria-labelledby="settings-title"]');
  await settings.waitFor();
  await page.waitForFunction(() => !/Checking/.test(document.querySelector("[data-video-settings-status]")?.textContent ?? "Checking"), null, { timeout: 5000 });
  check("Settings → Pictures & video says what makes video and the daily count", /Veo|paid/i.test(await settings.locator("[data-video-settings-status]").innerText()));
  await settings.locator("[data-open-video-studio]").click();
  check("and opens the video studio", await studio.isVisible());

  // --- delete -------------------------------------------------------------------------------------------
  if (mine) {
    await studio.locator(`[data-video-item="${mine.id}"] button[aria-label^="Delete"]`).click();
    await page.waitForTimeout(500);
    check("a video can be deleted from the library", (await fetch(`${BASE}${src}`)).status === 404 && (await studio.locator(`[data-video-item="${mine.id}"]`).count()) === 0);
    made.length = 0;
  }
  check("no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  for (const id of made) await fetch(`${BASE}/api/videos/${id}`, { method: "DELETE" }).catch(() => {});
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
