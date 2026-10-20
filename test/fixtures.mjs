/**
 * Test fixtures that need real audio.
 *
 * Silero VAD correctly rejects synthetic tones — they aren't speech — so the
 * voice tests need actual recorded speech. These are LibriSpeech clips
 * (CC BY 4.0) fetched on demand rather than committed, keeping the repo lean.
 */
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const run = promisify(execFile);
const SOURCE =
  "https://github.com/mozilla/DeepSpeech/releases/download/v0.9.3/audio-0.9.3.tar.gz";

export const SPEECH_WAV = path.join(os.tmpdir(), "jarvis-real-speech.wav");

const exists = (p) => access(p).then(() => true).catch(() => false);

/** 16kHz mono speech with pauses, so the VAD sees real turn boundaries. */
export async function ensureSpeechFixture() {
  if (await exists(SPEECH_WAV)) return SPEECH_WAV;

  const work = path.join(os.tmpdir(), "jarvis-fixtures");
  await mkdir(work, { recursive: true });
  const archive = path.join(work, "audio.tar.gz");

  const res = await fetch(SOURCE, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`fixture download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(archive));
  await run("tar", ["xzf", archive, "-C", work]);

  /**
   * One utterance, then a long silence.
   *
   * The silence matters: barge-in is driven by real speech now, so a fixture
   * that keeps talking interrupts JARVIS mid-reply and the test only ever
   * hears the first few sentences. (Which is the barge-in feature working —
   * just not what this fixture is for.)
   */
  const dir = path.join(work, "audio");
  const buffer = await readFile(path.join(dir, "2830-3980-0043.wav"));
  const header = buffer.subarray(0, 44);
  const bodies = [buffer.subarray(44), Buffer.alloc(16000 * 2 * 40)];

  const data = Buffer.concat(bodies);
  const out = Buffer.concat([Buffer.from(header), data]);
  out.writeUInt32LE(36 + data.length, 4);   // RIFF chunk size
  out.writeUInt32LE(data.length, 40);       // data chunk size
  await writeFile(SPEECH_WAV, out);

  return SPEECH_WAV;
}
