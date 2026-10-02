/**
 * Installs the device-mode speech stack: the Piper binary for this machine's
 * architecture, plus a voice model matched to how much CPU it has.
 *
 * Everything comes from GitHub release assets rather than HuggingFace, so it
 * works without an account and behind a restrictive network — the same
 * "free forever, no signup" rule the rest of the voice stack follows.
 *
 * Run it on the Pi: npm run setup:device
 */
import { createWriteStream } from "node:fs";
import { access, mkdir, rm, chmod, readdir, rename } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const PIPER_DIR = path.join(ROOT, "vendor", "piper");
const VOICE_DIR = path.join(PIPER_DIR, "voices");

const PIPER_RELEASE = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2";
const VOICE_RELEASE = "https://github.com/rhasspy/piper/releases/download/v0.0.2";

const exists = (p) => access(p).then(() => true).catch(() => false);

function piperArch() {
  switch (os.arch()) {
    case "arm64": return "aarch64";
    case "arm": return "armv7l";
    case "x64": return "x86_64";
    default: return null;
  }
}

/** Match the voice to what the board can synthesise without lagging. */
function voiceForThisMachine() {
  const cores = os.cpus().length || 1;
  const memoryGb = os.totalmem() / 1073741824;
  const arm = os.arch().startsWith("arm");

  // A Pi 3 (4 cores, 1GB) needs the fastest voice; a Pi 5 (4 cores, 4-8GB)
  // handles medium comfortably; anything x86 gets medium.
  if (!arm) return { asset: "voice-en-us-lessac-medium.tar.gz", label: "medium" };
  if (memoryGb >= 3.5 && cores >= 4) return { asset: "voice-en-gb-alan-low.tar.gz", label: "low" };
  return { asset: "voice-en-us-amy-low.tar.gz", label: "low" };
}

async function download(url, target) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
}

async function installPiper() {
  const arch = piperArch();
  if (!arch) throw new Error(`No Piper build for ${os.arch()}`);

  if (await exists(path.join(PIPER_DIR, "piper"))) {
    console.log("device: piper already installed");
    return;
  }

  await mkdir(PIPER_DIR, { recursive: true });

  /**
   * Extract to a staging directory, not straight into PIPER_DIR.
   *
   * The tarball unpacks into a nested folder ALSO called "piper", so
   * flattening in place means the cleanup step deletes the very binary it
   * just moved — the directory and the executable share a name.
   */
  const staging = path.join(ROOT, "vendor", ".piper-staging");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  const archive = path.join(staging, "piper.tar.gz");
  console.log(`device: downloading piper for ${arch}…`);
  await download(`${PIPER_RELEASE}/piper_linux_${arch}.tar.gz`, archive);
  await run("tar", ["xzf", archive, "-C", staging]);
  await rm(archive, { force: true });

  const unpacked = (await exists(path.join(staging, "piper", "piper")))
    ? path.join(staging, "piper")
    : staging;

  for (const entry of await readdir(unpacked)) {
    await rename(path.join(unpacked, entry), path.join(PIPER_DIR, entry)).catch(() => {});
  }
  await rm(staging, { recursive: true, force: true });

  await chmod(path.join(PIPER_DIR, "piper"), 0o755).catch(() => {});

  if (!(await exists(path.join(PIPER_DIR, "piper")))) {
    throw new Error("piper binary missing after extraction");
  }
  console.log("device: piper installed");
}

async function installVoice() {
  await mkdir(VOICE_DIR, { recursive: true });

  const present = (await readdir(VOICE_DIR).catch(() => [])).filter((f) => f.endsWith(".onnx"));
  if (present.length > 0) {
    console.log(`device: voice already present (${present[0]})`);
    return;
  }

  const voice = voiceForThisMachine();
  console.log(`device: downloading a ${voice.label}-quality voice for this machine…`);

  const archive = path.join(VOICE_DIR, "voice.tar.gz");
  await download(`${VOICE_RELEASE}/${voice.asset}`, archive);
  await run("tar", ["xzf", archive, "-C", VOICE_DIR]);
  await rm(archive, { force: true });

  console.log("device: voice installed");
}

/** Report what the OS can actually do, so failures name themselves. */
async function checkAudioTools() {
  for (const [tool, why] of [
    ["arecord", "microphone capture"],
    ["aplay", "speaker playback"],
  ]) {
    try {
      await run("which", [tool]);
      console.log(`device: ${tool} found (${why})`);
    } catch {
      console.warn(
        `device: ${tool} NOT found — ${why} will not work. Install it with: sudo apt install alsa-utils`,
      );
    }
  }
}

async function main() {
  await installPiper();
  await installVoice();
  await checkAudioTools();
  console.log("\ndevice: ready. Set JARVIS_DEVICE_MODE=1 to run voice on this machine.");
}

main().catch((err) => {
  console.warn(
    `\ndevice setup did not complete: ${err.message}\n` +
      "Device mode needs these; browser mode is unaffected. " +
      "Re-run `npm run setup:device` when the network allows.\n",
  );
});
