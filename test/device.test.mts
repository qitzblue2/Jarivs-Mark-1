/**
 * The device voice path, run against real speech.
 *
 * There is no Raspberry Pi, microphone, or speaker in this environment, so
 * what can be proved here is everything between them: the same ONNX models
 * the Pi will run, driven by onnxruntime-node, fed the same LibriSpeech
 * recording the browser voice tests use, frame by frame exactly as `arecord`
 * would deliver it.
 *
 * What it cannot prove is stated out loud at the end rather than quietly
 * skipped, because a test that says nothing about missing hardware is how
 * you find out on the day it matters.
 */
import { readFile } from "node:fs/promises";
import { DeviceVad } from "../lib/voice/device/vad";
import { DeviceWakeWord } from "../lib/voice/device/wake";
import { SpeechSegmenter } from "../lib/voice/device/segment";
import { WakeGate } from "../lib/voice/wake/types";
import { FRAME_SAMPLES, audioStatus, play, startCapture } from "../lib/voice/device/audio";
import { detectDevice } from "../lib/voice/device/detect";
import { piperStatus, synthesize } from "../lib/voice/device/piper";
import { ensureSpeechFixture } from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const notes: string[] = [];

const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}` +
      (ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`),
  );
};

/** Read a 16kHz mono WAV as the Float32 frames capture would hand over. */
async function framesOf(file: string): Promise<Float32Array[]> {
  const buffer = await readFile(file);
  const pcm = buffer.subarray(44);
  const samples = new Float32Array(pcm.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;

  const frames: Float32Array[] = [];
  for (let offset = 0; offset + FRAME_SAMPLES <= samples.length; offset += FRAME_SAMPLES) {
    frames.push(samples.slice(offset, offset + FRAME_SAMPLES));
  }
  return frames;
}

console.log("\n--- this machine ---");
{
  const device = await detectDevice();
  console.log(`     ${device.model} · ${device.deviceClass} · ${device.arch} · ${device.cores} cores`);
  eq("an architecture Piper publishes a binary for", ["aarch64", "armv7l", "x86_64"].includes(device.arch), true);
  eq("a voice quality was chosen", ["x_low", "low", "medium", "high"].includes(device.suggestedQuality), true);

  const audio = await audioStatus();
  console.log(`     arecord: ${audio.capture} · aplay: ${audio.playback} · inputs: ${audio.inputs.length}`);
  if (audio.problem) notes.push(`audio: ${audio.problem}`);
}

const frames = await framesOf(await ensureSpeechFixture());

console.log("\n--- turn taking on real speech ---");
{
  const vad = new DeviceVad();
  await vad.load();

  const segmenter = new SpeechSegmenter();
  const utterances: { seconds: number; at: number }[] = [];
  let peak = 0;

  const started = Date.now();
  for (const [index, frame] of frames.entries()) {
    for (const { probability, window } of await vad.process(frame)) {
      if (probability > peak) peak = probability;
      const event = segmenter.push(probability, window);
      if (event.type === "end") {
        utterances.push({ seconds: event.audio.length / 16000, at: (index * FRAME_SAMPLES) / 16000 });
      }
    }
  }
  const elapsed = Date.now() - started;
  const audioSeconds = (frames.length * FRAME_SAMPLES) / 16000;

  eq("hears the speaker", peak > 0.8, true);
  eq("finds exactly one utterance in the fixture", utterances.length, 1);
  eq("of about the right length", utterances[0]?.seconds > 1 && utterances[0]?.seconds < 4, true);
  eq("and ignores the 40 seconds of silence after it", utterances[0]?.at < 5, true);

  // A Pi is several times slower than this box; the margin is what matters.
  const realtimeFactor = elapsed / 1000 / audioSeconds;
  console.log(`     ${elapsed}ms for ${audioSeconds.toFixed(0)}s of audio (${realtimeFactor.toFixed(3)}x realtime)`);
  eq("comfortably faster than realtime", realtimeFactor < 0.2, true);
}

console.log("\n--- wake word ---");
{
  const wake = new DeviceWakeWord();
  await wake.load();

  const gate = new WakeGate(0.5);
  let fired = 0;
  let best = 0;

  const started = Date.now();
  // The first ten seconds hold the speech; the rest is silence.
  const speech = frames.slice(0, 125);
  for (const [index, frame] of speech.entries()) {
    const score = await wake.push(frame);
    if (score > best) best = score;
    if (gate.accept(score, index)) fired++;
  }
  const perFrame = (Date.now() - started) / speech.length;

  eq("does not fire on speech that isn't the wake word", fired, 0);
  eq("and scores it near zero", best < 0.1, true);
  console.log(`     ${perFrame.toFixed(2)}ms per 80ms frame (${((perFrame / 80) * 100).toFixed(1)}% of the budget)`);
  eq("leaves the frame budget mostly free", perFrame < 20, true);
}

console.log("\n--- speech out ---");
{
  const status = await piperStatus();
  if (!status.installed) {
    notes.push(`piper: ${status.problem}`);
    console.log(`     skipped — ${status.problem}`);
  } else {
    const { wav, ms } = await synthesize("Systems are online, sir.");
    const seconds = (wav.length - 44) / (22050 * 2);
    eq("produces a RIFF WAV", wav.subarray(0, 4).toString(), "RIFF");
    eq("of plausible length", seconds > 0.8 && seconds < 5, true);
    console.log(`     ${seconds.toFixed(2)}s of audio in ${ms}ms (${(ms / 1000 / seconds).toFixed(2)}x realtime)`);
    eq("faster than realtime", ms / 1000 < seconds, true);
  }
}

console.log("\n--- when the hardware isn't there ---");
{
  // The failure everyone hits first: ALSA isn't installed, or the mic is
  // unplugged. Both have to say so; a silent hang is the one unacceptable
  // outcome for a box with no screen on it.
  const audio = await audioStatus();

  if (audio.playback) {
    console.log("     skipped — aplay is installed here");
  } else {
    let message = "";
    await play(Buffer.alloc(64)).catch((err: Error) => {
      message = err.message;
    });
    eq("playback reports a missing aplay", /aplay/.test(message), true);
  }

  if (audio.capture) {
    console.log("     skipped — arecord is installed here");
  } else {
    const reported = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve(""), 2000);
      const handle = startCapture(
        () => {},
        {
          onError: (text) => {
            clearTimeout(timer);
            handle.stop();
            resolve(text);
          },
        },
      );
    });
    eq("capture reports a missing arecord", /arecord/.test(reported), true);
  }
}

if (notes.length > 0) {
  console.log("\n--- not tested here (no hardware) ---");
  for (const note of notes) console.log(`     ${note}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
