"use client";

import { useEffect, useState } from "react";
import { Clapperboard } from "lucide-react";

interface Status {
  available: boolean;
  provider: string | null;
  model: string;
  used: number;
  limit: number;
  note: string;
}

/** Whether video can be made, in words the server vouches for, and a way into the studio. */
export default function VideoSettings({ keys, onOpenStudio }: { keys?: { nanogpt?: string; gemini?: string }; onOpenStudio?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);

  const keyHeader = JSON.stringify({ nanogpt: keys?.nanogpt, gemini: keys?.gemini });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/videos/generate", { headers: keyHeader !== "{}" ? { "x-jarvis-keys": keyHeader } : {} })
      .then((r) => r.json())
      .then((d) => !cancelled && setStatus(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [keyHeader]);

  return (
    <section className="space-y-2.5" data-video-settings>
      <div>
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
          <Clapperboard size={12} aria-hidden />
          Video
        </h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
          JARVIS can make short clips with sound — speech, effects and ambience — through NanoGPT (Veo 3 is the one documented to make sound) or Google&apos;s Veo with a Gemini key. Describe the scene, write what is said and what is heard,
          and press the button; type <code className="font-mono">/video</code> to open the studio. It takes a minute or three.
        </p>
      </div>
      <p className="rounded-md border border-line-soft bg-base px-3 py-2 text-[12px] text-ink-dim" data-video-settings-status>
        {failed ? "Couldn't reach the server to check." : !status ? "Checking…" : `${status.note}${status.available ? ` Model: ${status.model}. ${status.used} of ${status.limit} made today.` : ""}`}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-[11.5px] leading-relaxed text-ink-faint">
        <li>
          <b className="font-medium text-ink-dim">It costs money.</b> Video is billed by NanoGPT (or Google, with a Gemini key); NanoGPT is used first when it has a key, so nothing starts until you press the button, one video is made at a
          time, and there is a daily limit (<code className="font-mono">JARVIS_VIDEO_DAILY_LIMIT</code>, default 5).
        </li>
        <li>
          <b className="font-medium text-ink-dim">Clips are short:</b> 4 to 12 seconds depending on the model, landscape or vertical.
        </li>
        <li>
          <b className="font-medium text-ink-dim">The model never makes videos by itself</b> — it can&apos;t spend your money. Only you can start one.
        </li>
      </ul>
      {onOpenStudio && (
        <button type="button" onClick={onOpenStudio} data-open-video-studio className="min-h-8 rounded-md border border-line px-3 text-[12px] text-ink-dim transition hover:border-arc-dim/50 hover:text-ink">
          Open the video studio
        </button>
      )}
    </section>
  );
}
