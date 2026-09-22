/**
 * Fetches the voice-mode runtime assets.
 *
 * Kept out of git: the ONNX runtime wasm is 14MB and the wake-word models
 * 3.6MB, which has no business in a clone. The wasm is copied out of
 * node_modules and the models are downloaded once.
 *
 * Runs on postinstall. It never fails the install — without these, voice mode
 * reports that it can't start and the rest of the app is unaffected.
 */
import { createWriteStream } from "node:fs";
import { mkdir, access, copyFile, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODEL_DIR = path.join(ROOT, "public", "models", "wake");
const ORT_DIR = path.join(ROOT, "public", "ort");

const RELEASE = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1";
const MODELS = ["melspectrogram.onnx", "embedding_model.onnx", "hey_jarvis_v0.1.onnx"];

// The wasm-only build; the default entry would need the 28MB JSEP binary.
const ORT_FILES = ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"];

// Silero VAD ships its model and worklet inside the package; serving them
// locally keeps voice working offline and independent of any CDN.
const VAD_DIR = path.join(ROOT, "public", "vad");
const VAD_FILES = [
  "silero_vad_v5.onnx",
  "silero_vad_legacy.onnx",
  "vad.worklet.bundle.min.js",
];

/**
 * Kokoro, the speaking voice — the one asset that used to break the rule above.
 *
 * It was loaded straight from Hugging Face by the browser on first use: 86MB,
 * over the user's connection, every fresh cache. When that fetch failed the
 * voice fell back to the browser's built-in speech, which on Chrome is a
 * Google voice — a cloud dependency arriving by accident in a feature chosen
 * specifically for having none.
 *
 * The directory layout below is not arbitrary: transformers.js resolves a
 * local model as <localModelPath>/<model id>/<file>, so the repo id has to be
 * mirrored as real directories.
 */
const KOKORO_REPO = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_DIR = path.join(ROOT, "public", "models", "kokoro");
const KOKORO_MODEL_DIR = path.join(KOKORO_DIR, ...KOKORO_REPO.split("/"));
const KOKORO_HF = `https://huggingface.co/${KOKORO_REPO}/resolve/main`;

const KOKORO_CONFIG = ["config.json", "tokenizer.json", "tokenizer_config.json"];

/**
 * The q8 build, which is the default quality in Settings.
 *
 * Named as candidates because transformers.js derives the filename from the
 * dtype and the repo is free to spell it either way. Trying both and saying
 * which one landed beats writing a directory that looks complete and isn't.
 */
const KOKORO_ONNX_CANDIDATES = ["model_quantized.onnx", "model_q8.onnx"];

/**
 * Voice embeddings ship inside kokoro-js, so these are copied, never fetched.
 * Only the voices actually offered in Settings — all 54 would be 28MB to
 * serve 11.
 */
const KOKORO_VOICES = [
  "af_heart", "af_bella", "af_nicole", "af_sarah",
  "am_michael", "am_fenrir", "am_puck",
  "bf_emma", "bf_isabella", "bm_george", "bm_daniel",
];

const exists = (p) => access(p).then(() => true).catch(() => false);

async function download(url, target) {
  if (await exists(target)) {
    const { size } = await stat(target);
    if (size > 1000) return "cached";
  }
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
  return "downloaded";
}

async function main() {
  await mkdir(MODEL_DIR, { recursive: true });
  await mkdir(ORT_DIR, { recursive: true });

  for (const file of ORT_FILES) {
    const from = path.join(ROOT, "node_modules", "onnxruntime-web", "dist", file);
    const to = path.join(ORT_DIR, file);
    if (!(await exists(from))) throw new Error(`missing in node_modules: ${file}`);
    if (!(await exists(to))) await copyFile(from, to);
  }
  console.log("voice: onnx runtime ready");

  await mkdir(VAD_DIR, { recursive: true });
  for (const file of VAD_FILES) {
    const from = path.join(ROOT, "node_modules", "@ricky0123", "vad-web", "dist", file);
    const to = path.join(VAD_DIR, file);
    if (!(await exists(from))) {
      console.warn(`voice: ${file} missing from @ricky0123/vad-web — turn-taking falls back to the loudness gate`);
      continue;
    }
    if (!(await exists(to))) await copyFile(from, to);
  }
  console.log("voice: speech detection ready");

  for (const model of MODELS) {
    const how = await download(`${RELEASE}/${model}`, path.join(MODEL_DIR, model));
    console.log(`voice: ${model} ${how}`);
  }

  await setupKokoro();
}

/**
 * The speaking voice.
 *
 * Isolated in its own try/catch rather than sharing main()'s: the wake word
 * and VAD are what make voice mode start at all, while this only decides
 * whether it sounds good. A failed 86MB download should leave JARVIS
 * listening, not refuse to install.
 */
async function setupKokoro() {
  // Voices first, and in their own try: they are copied out of node_modules
  // with no network involved, so a failed model download must not take them
  // with it. Ordering these the other way round silently skipped all 11.
  try {
    await mkdir(path.join(KOKORO_DIR, "voices"), { recursive: true });
    let copied = 0;
    for (const voice of KOKORO_VOICES) {
      const from = path.join(ROOT, "node_modules", "kokoro-js", "voices", `${voice}.bin`);
      const to = path.join(KOKORO_DIR, "voices", `${voice}.bin`);
      if (!(await exists(from))) continue;
      if (!(await exists(to))) await copyFile(from, to);
      copied++;
    }
    console.log(`voice: kokoro ${copied}/${KOKORO_VOICES.length} voices ready`);
  } catch (err) {
    console.warn(`voice: kokoro voices unavailable (${err.message})`);
  }

  try {
    await mkdir(path.join(KOKORO_MODEL_DIR, "onnx"), { recursive: true });

    for (const file of KOKORO_CONFIG) {
      await download(`${KOKORO_HF}/${file}`, path.join(KOKORO_MODEL_DIR, file));
    }

    // Both spellings are tried; the first that exists wins and is reported by
    // name, so a repo that renames its builds fails loudly here rather than
    // silently at the first spoken sentence.
    let onnx = null;
    for (const candidate of KOKORO_ONNX_CANDIDATES) {
      try {
        const how = await download(
          `${KOKORO_HF}/onnx/${candidate}`,
          path.join(KOKORO_MODEL_DIR, "onnx", candidate),
        );
        onnx = `${candidate} ${how}`;
        break;
      } catch {
        /* try the next spelling */
      }
    }
    if (!onnx) throw new Error(`no q8 build found (tried ${KOKORO_ONNX_CANDIDATES.join(", ")})`);
    console.log(`voice: kokoro ${onnx}`);
  } catch (err) {
    console.warn(
      `voice: kokoro model not fetched (${err.message}) — ` +
        "re-run `npm run setup:voice` with network access. " +
        "Until then JARVIS listens and answers on screen, but won't speak.",
    );
  }
}

main().catch((err) => {
  console.warn(
    `\nvoice setup skipped: ${err.message}\n` +
      "Voice mode needs these assets; run `npm run setup:voice` when you have " +
      "network access. Everything else works without them.\n",
  );
});
