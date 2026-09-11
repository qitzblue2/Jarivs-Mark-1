/**
 * Voice-mode browser test.
 *
 * Chromium's fake-audio-capture flag feeds a WAV in place of a real mic, so
 * the whole pipeline — AudioWorklet, ONNX wake-word scoring, recording,
 * transcription, TTS — runs headlessly. speechSynthesis is stubbed so the
 * exact greeting can be asserted.
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const WAV = process.env.FAKE_AUDIO ?? "/tmp/speech.wav";
const check = (label, ok, extra = "") =>
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);

const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${WAV}%noloop`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

// Capture everything spoken, and make speech instant.
await page.addInitScript(() => {
  window.__spoken = [];
  // speechSynthesis is a read-only accessor — plain assignment is silently
  // ignored, leaving the native engine (which has no voices headless).
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      getVoices: () => [],
      cancel() {},
      speak(u) {
        window.__spoken.push(u.text);
        setTimeout(() => u.onend && u.onend(), 10);
      },
      addEventListener() {},
      removeEventListener() {},
    },
  });
  window.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; }
  };
});

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
check("app loads", (await page.title()) === "JARVIS Mark 3");

// --- push-to-talk: skips the wake word, records, transcribes, answers ---
await page.locator('button[title="Speak a question"]').click();
await page.getByText("Listening", { exact: false }).first().waitFor({ timeout: 20000 });
check("voice mode opens and starts listening", true);

const orb = await page.locator("div.fixed.inset-0.z-50").count();
check("voice overlay rendered", orb === 1);

// The fake WAV goes quiet after ~1.2s, so the silence gate should close it.
await page.waitForFunction(
  () => document.body.innerText.includes("what is two plus two"),
  { timeout: 30000 },
);
check("audio captured, uploaded and transcribed", true);

await page.waitForFunction(() => (window.__spoken ?? []).length > 0, { timeout: 30000 });
const spoken = await page.evaluate(() => window.__spoken);
check("JARVIS spoke the answer", spoken.length > 0, JSON.stringify(spoken).slice(0, 90));

await page.screenshot({ path: "/tmp/mark3-voice.png" });

// Close and WAIT for the overlay to detach — clicking through it otherwise
// races the unmount.
await page.keyboard.press("Escape");
await page.locator("div.fixed.inset-0.z-50").waitFor({ state: "detached", timeout: 10000 });
check("Escape exits voice mode", true);

// --- wake-word mode: the ONNX pipeline must actually load and score ---
await page.evaluate(() => { window.__spoken = []; });
await page.locator('button[title^="Voice mode"]').click();

// Reaching "Say \"Hey JARVIS\"" means all three ONNX models loaded in wasm.
await page.getByText('Say "Hey JARVIS"').waitFor({ timeout: 60000 });
check("wake-word models loaded and scoring in-browser", true);

// The live confidence readout proves frames are flowing through the models.
await page.waitForFunction(() => {
  const el = [...document.querySelectorAll("span")].find((s) => /^\d\.\d\d$/.test(s.textContent ?? ""));
  return el !== undefined;
}, { timeout: 20000 });
const score = await page.evaluate(() => {
  const el = [...document.querySelectorAll("span")].find((s) => /^\d\.\d\d$/.test(s.textContent ?? ""));
  return el?.textContent;
});
check("live wake-word score rendered", score !== undefined, `score=${score}`);

const continuous = page.locator("button", { hasText: /Single question|Continuous/ });
check("per-session continuous toggle present", (await continuous.count()) === 1);
await continuous.click();
check("toggle flips to continuous", (await continuous.innerText()).includes("Continuous"));

await page.screenshot({ path: "/tmp/mark3-wake.png" });
await page.keyboard.press("Escape");
await page.locator("div.fixed.inset-0.z-50").waitFor({ state: "detached", timeout: 10000 });

check("no console or page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(errors.length ? 1 : 0);
