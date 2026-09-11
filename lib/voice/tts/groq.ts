import type { SpeakOptions, TtsEngine } from "./types";

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
    const audio = new Audio(url);
    this.audio = audio;

    try {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          audio.pause();
          reject(new DOMException("Speech cancelled", "AbortError"));
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        void audio.play().catch(reject);
      });
    } finally {
      URL.revokeObjectURL(url);
      if (this.audio === audio) this.audio = null;
    }
  }

  cancel(): void {
    this.audio?.pause();
    this.audio = null;
  }
}
