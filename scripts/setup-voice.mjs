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
}

main().catch((err) => {
  console.warn(
    `\nvoice setup skipped: ${err.message}\n` +
      "Voice mode needs these assets; run `npm run setup:voice` when you have " +
      "network access. Everything else works without them.\n",
  );
});
