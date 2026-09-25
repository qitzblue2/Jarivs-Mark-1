import type { PreparedSpeech, SpeakOptions, TtsEngine } from "./types";

/**
 * Groq-hosted TTS (Orpheus), proxied through /api/speak so the key stays
 * server-side. More natural than the browser voice, at the cost of a network
 * round-trip and free-tier quota on top of the chat request.
 */
export class GroqTts implements TtsEngine {
  id = "groq";
  label = "Groq (natural)";

  private audio: HTMLAudioElement | null = null;

  isAvailable(): boolean {
    return typeof window !== "undefined";
  }

  async voices(): Promise<{ id: string; label: string }[]> {
    return [
      { id: "tara", label: "Tara" },
      { id: "leah", label: "Leah" },
      { id: "leo", label: "Leo" },
      { id: "zac", label: "Zac" },
    ];
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    if (!text.trim()) return;
    const prepared = await this.synthesize(text, options);
    await prepared.play(options.signal);
  }

  /** Fetch the audio without playing it, so the speaker can work ahead. */
  async synthesize(text: string, options: SpeakOptions = {}): Promise<PreparedSpeech> {
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: options.voice }),
      signal: options.signal,
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail?.error ?? `Speech generation failed (${res.status}).`);
    }

    const url = URL.createObjectURL(await res.blob());

    return {
      play: (signal) => {
        const audio = new Audio(url);
        this.audio = audio;
        return new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            audio.pause();
            reject(new DOMException("Speech cancelled", "AbortError"));
          };
          signal?.addEventListener("abort", onAbort, { once: true });
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          void audio.play().catch(reject);
        }).finally(() => {
          if (this.audio === audio) this.audio = null;
        });
      },
      dispose: () => URL.revokeObjectURL(url),
    };
  }

  cancel(): void {
    this.audio?.pause();
    this.audio = null;
  }
}
