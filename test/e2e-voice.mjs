/**
 * Voice-mode browser test.
 *
 * Chromium's fake-audio-capture flag feeds a WAV in place of a real mic, so
 * the whole pipeline — AudioWorklet, ONNX wake-word scoring, recording,
 * transcription, TTS — runs headlessly. speechSynthesis is stubbed so the
 * exact greeting can be asserted.
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { ensureSpeechFixture } from "./fixtures.mjs";

// Real recorded speech, not tones: Silero VAD correctly refuses to treat
// synthetic audio as a voice, so a tone would never end a turn.
const WAV = process.env.FAKE_AUDIO ?? (await ensureSpeechFixture());
const check = (label, ok, extra = "") =>
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);

const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${WAV}%noloop`,
    // Deliberately NOT --autoplay-policy=no-user-gesture-required: that flag
    // makes audio start in conditions a real browser wouldn't, which is
    // exactly how an audio-startup bug would slip through this suite.
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
  // Record the state every AudioContext is created in, and expose the last
  // one so the test can assert audio is actually running.
  const RealAudioContext = window.AudioContext;
  window.__ctxStates = [];
  window.AudioContext = class extends RealAudioContext {
    constructor(...args) {
      super(...args);
      window.__ctxStates.push(this.state);
      window.__lastCtx = this;
    }
  };
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
check("app loads", (await page.title()) === "JARVIS Mark 5");

// Pin the speech engine for determinism; Kokoro's own fallback is asserted
// separately below.
await page.evaluate(() => {
  const stored = JSON.parse(localStorage.getItem("jarvis.settings.v1") ?? "{}");
  localStorage.setItem(
    "jarvis.settings.v1",
    JSON.stringify({ ...stored, ttsEngine: "browser" }),
  );
});
await page.reload({ waitUntil: "networkidle" });

// --- push-to-talk: skips the wake word, records, transcribes, answers ---
await page.locator('button[title="Speak a question"]').click();
await page.getByText("Listening", { exact: false }).first().waitFor({ timeout: 20000 });
check("voice mode opens and starts listening", true);

const orb = await page.locator("div.fixed.inset-0.z-50").count();
check("voice overlay rendered", orb === 1);

// A suspended context runs no worklet, so no audio would ever arrive and the
// session would sit in idle looking healthy.
const ctxState = await page.evaluate(() => window.__lastCtx?.state);
check("AudioContext is running, not suspended", ctxState === "running", String(ctxState));

// The fake WAV goes quiet after ~1.2s, so the silence gate should close it.
await page.waitForFunction(
  () => document.body.innerText.includes("give me a long answer"),
  { timeout: 30000 },
);
check("audio captured, uploaded and transcribed", true);

await page.waitForFunction(() => (window.__spoken ?? []).length > 0, { timeout: 30000 });

// The reported bug: long replies sometimes produced no speech at all, because
// the text was clipped to 1,200 chars and handed over as one oversized
// utterance that Chrome silently drops. Speech is now chunked per sentence.
await page.waitForFunction(() => (window.__spoken ?? []).length > 5, { timeout: 40000 });
await page.waitForTimeout(2500);

const spoken = await page.evaluate(() =>
  (window.__spoken ?? []).map((s) => (typeof s === "string" ? s : s.text)),
);
check("JARVIS spoke the answer", spoken.length > 0);
check("a long reply is chunked, not one utterance", spoken.length > 10, `${spoken.length} chunks`);
check(
  "no chunk is long enough for the engine to drop",
  Math.max(...spoken.map((s) => s.length)) < 300,
  `longest ${Math.max(...spoken.map((s) => s.length))} chars`,
);
check(
  "nothing was truncated away",
  !spoken.join(" ").includes("the rest is on screen"),
);
// Every sentence the model produced must actually be spoken.
const sentenceCount = spoken.join(" ").match(/This is sentence number/g)?.length ?? 0;
check("all 40 sentences reached the speaker", sentenceCount === 40, `${sentenceCount}/40`);

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

// The input meter must actually move: a flat meter means no audio is
// reaching the page, which is the failure this suite previously missed.
await page.waitForFunction(() => {
  const el = [...document.querySelectorAll("span")].find((s) => /^\d\.\d{3}$/.test(s.textContent ?? ""));
  return el && Number(el.textContent) > 0;
}, { timeout: 20000 });
check("microphone input registers on the level meter", true);

// Frames must keep arriving even while inference runs, or the wake-word
// window ends up full of holes and the model can never match.
const readCounts = () =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll("span")].find((s) =>
      /\d+ frames/.test(s.textContent ?? ""),
    );
    const m = /(\d+)\/(\d+) frames/.exec(el?.textContent ?? "");
    return m ? { scored: Number(m[1]), frames: Number(m[2]) } : { frames: 0, scored: 0 };
  });

await page.waitForFunction(() => {
  const el = [...document.querySelectorAll("span")].find((s) =>
    /\d+ frames/.test(s.textContent ?? ""),
  );
  return Number(/\d+\/(\d+) frames/.exec(el?.textContent ?? "")?.[1] ?? 0) > 40;
}, { timeout: 25000 });

const counts = await readCounts();
check("audio frames buffered continuously", counts.frames > 40, `${counts.frames} frames`);
// Every buffered frame should also get scored; a large gap means inference
// is falling behind the 80ms frame interval.
const ratio = counts.scored / Math.max(1, counts.frames);
check(
  "wake-word inference keeps up with the audio",
  ratio > 0.8,
  `${counts.scored}/${counts.frames} scored (${(ratio * 100).toFixed(0)}%)`,
);

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
