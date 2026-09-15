import type { SpeakOptions, TtsEngine } from "./types";

/**
 * The browser's built-in speechSynthesis.
 *
 * Free, offline, instant, and — unlike Web Speech *recognition* — supported
 * in Firefox as well as Chrome and Safari. Voice quality depends on the OS.
 */
export class BrowserTts implements TtsEngine {
  id = "browser";
  label = "Browser voice";

  isAvailable(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  async voices(): Promise<{ id: string; label: string }[]> {
    if (!this.isAvailable()) return [];

    const read = () =>
      window.speechSynthesis
        .getVoices()
        .filter((v) => v.lang.startsWith("en"))
        .map((v) => ({ id: v.voiceURI, label: `${v.name} (${v.lang})` }));

    const immediate = read();
    if (immediate.length > 0) return immediate;

    // Chrome populates the list asynchronously on first call.
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(read()), 1000);
      window.speechSynthesis.addEventListener(
        "voiceschanged",
        () => {
          clearTimeout(timer);
          resolve(read());
        },
        { once: true },
      );
    });
  }

  speak(text: string, options: SpeakOptions = {}): Promise<void> {
    if (!this.isAvailable() || !text.trim()) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);

      /**
       * Watchdog.
       *
       * On a machine with no installed TTS voices — some Linux setups,
       * containers, headless browsers — speechSynthesis accepts the utterance
       * and then fires neither `onend` nor `onerror`. Without this the
       * promise never settles and the whole voice session is stranded in
       * "speaking" forever. Estimate the spoken duration and give up well
       * after it should have finished.
       */
      const estimatedMs = (text.length / 15) * 1000;
      const watchdog = setTimeout(
        () => finish(resolve)(),
        Math.min(60_000, Math.max(5_000, estimatedMs * 1.5 + 3_000)),
      );
      utterance.rate = options.rate ?? 1.05;

      if (options.voice) {
        const match = window.speechSynthesis.getVoices().find((v) => v.voiceURI === options.voice);
        if (match) utterance.voice = match;
      }

      const onAbort = () => {
        clearTimeout(watchdog);
        window.speechSynthesis.cancel();
        reject(new DOMException("Speech cancelled", "AbortError"));
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });

      const finish = (fn: () => void) => () => {
        clearTimeout(watchdog);
        options.signal?.removeEventListener("abort", onAbort);
        fn();
      };

      utterance.onend = finish(resolve);
      // 'interrupted'/'canceled' are normal when we barge in, not failures.
      utterance.onerror = finish(() => resolve());

      // Chrome drops queued utterances if a previous one is still pending.
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }

  cancel(): void {
    if (this.isAvailable()) window.speechSynthesis.cancel();
  }
}
