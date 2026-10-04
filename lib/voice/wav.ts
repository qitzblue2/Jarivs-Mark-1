/**
 * Encode 16 kHz mono float PCM as a WAV blob.
 *
 * The AudioWorklet already gives us exactly the format Whisper wants, so we
 * package those frames directly rather than running a second MediaRecorder
 * stream to get webm/opus.
 */
export function encodeWav(frames: Float32Array[], sampleRate = 16000): Blob {
  const length = frames.reduce((n, f) => n + f.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);       // PCM header size
  view.setUint16(20, 1, true);        // format: PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);        // block align
  view.setUint16(34, 16, true);       // bits per sample
  writeString(36, "data");
  view.setUint32(40, length * 2, true);

  let offset = 44;
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i++) {
      const clamped = Math.max(-1, Math.min(1, frame[i]));
      view.setInt16(offset, clamped * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/** Total seconds of audio in a set of frames. */
export function durationOf(frames: Float32Array[], sampleRate = 16000): number {
  return frames.reduce((n, f) => n + f.length, 0) / sampleRate;
}
