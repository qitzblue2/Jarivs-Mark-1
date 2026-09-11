/**
 * Captures microphone audio as 16 kHz mono PCM frames.
 *
 * Runs on the audio thread, so the wake-word pipeline never competes with
 * React for the main thread. Emits fixed 1280-sample frames (80 ms at 16 kHz),
 * which is the chunk size openWakeWord's melspectrogram model expects.
 */

const TARGET_RATE = 16000;
const FRAME = 1280;

class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(FRAME);
    this.filled = 0;
    // AudioContext rate is usually 44.1k or 48k; we decimate to 16k.
    this.ratio = sampleRate / TARGET_RATE;
    this.position = 0;
    this.muted = false;

    this.port.onmessage = (event) => {
      if (event.data?.type === "mute") this.muted = Boolean(event.data.value);
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    if (this.muted) {
      // Keep the node alive but emit nothing while muted.
      this.filled = 0;
      this.position = 0;
      return true;
    }

    // Linear-interpolation resample down to 16 kHz.
    while (this.position < channel.length) {
      const index = Math.floor(this.position);
      const frac = this.position - index;
      const a = channel[index] ?? 0;
      const b = channel[index + 1] ?? a;

      this.buffer[this.filled++] = a + (b - a) * frac;

      if (this.filled === FRAME) {
        let sum = 0;
        for (let i = 0; i < FRAME; i++) sum += this.buffer[i] * this.buffer[i];

        this.port.postMessage(
          {
            type: "frame",
            // Copy: the buffer is reused immediately.
            samples: this.buffer.slice(),
            // RMS travels with the frame so silence detection needs no second pass.
            rms: Math.sqrt(sum / FRAME),
          },
          [],
        );
        this.filled = 0;
      }

      this.position += this.ratio;
    }

    // Carry the fractional offset into the next render quantum so the
    // resampler doesn't drift or click at block boundaries.
    this.position -= channel.length;
    return true;
  }
}

registerProcessor("pcm-worklet", PcmWorklet);
