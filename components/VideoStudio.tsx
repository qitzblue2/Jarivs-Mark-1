"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Download, Loader2, Trash2, X } from "lucide-react";
import { useEscape } from "@/lib/hooks/use-escape";
import { useDialogFocus } from "@/lib/hooks/use-dialog-focus";
import { MAX_SCENE, MAX_SOUND, MAX_SPEECH, VIDEO_ASPECTS, VIDEO_QUALITIES, waitLabel, type VideoAspect, type VideoQuality } from "@/lib/videos/request";
import { nearestSeconds, type VideoModel } from "@/lib/videos/models";
import { loadIncluded, saveIncluded, toggleIncluded, withIncluded } from "@/lib/videos/included-store";
import VideoModelPicker from "./VideoModelPicker";

interface Job {
  id: string;
  status: "running" | "done" | "error" | "cancelled";
  startedAt: number;
  error?: string;
  url?: string;
  videoId?: string;
  cost?: number;
  provider?: string;
}
interface Made {
  id: string;
  url: string;
  scene: string;
  speech?: string;
  sound?: string;
  seconds: number;
  aspect: string;
  quality: string;
  createdAt: number;
  provider?: string;
  cost?: number;
}
interface Status {
  available: boolean;
  provider: "nanogpt" | "gemini" | null;
  models: VideoModel[];
  catalog: { source: "live" | "builtin"; subscriptionListing: boolean } | null;
  model: string;
  used: number;
  limit: number;
  running: string | null;
  note: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialScene?: string;
  /** Keys from Settings, if you gave any there. */
  keys?: { nanogpt?: string; gemini?: string };
}

/**
 * Make a video with sound: describe the scene, write what is said, describe
 * what is heard. It costs real money on a paid model, so nothing starts until
 * you press the button, one is made at a time, and there is a daily limit.
 */
export default function VideoStudio({ open, onClose, initialScene, keys }: Props) {
  const [scene, setScene] = useState("");
  const [speech, setSpeech] = useState("");
  const [sound, setSound] = useState("");
  const [avoid, setAvoid] = useState("");
  const [aspect, setAspect] = useState<VideoAspect>("16:9");
  const [seconds, setSeconds] = useState<number>(8);
  const [model, setModel] = useState<string>("");
  const [marked, setMarked] = useState<string[]>([]);
  const [quality, setQuality] = useState<VideoQuality>("720p");
  const [realistic, setRealistic] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<Made[]>([]);
  const [playing, setPlaying] = useState<Made | null>(null);

  const keyHeader = JSON.stringify({ nanogpt: keys?.nanogpt, gemini: keys?.gemini });
  const headers = useCallback((json = false): HeadersInit => ({ ...(json ? { "Content-Type": "application/json" } : {}), ...(keyHeader !== "{}" ? { "x-jarvis-keys": keyHeader } : {}) }), [keyHeader]);

  const refresh = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([fetch("/api/videos/generate", { headers: headers() }).then((r) => r.json()), fetch("/api/videos").then((r) => r.json())]);
      setStatus(s);
      const videos: Made[] = l.videos ?? [];
      setLibrary(videos);
      return { status: s as Status, videos };
    } catch {
      return null;
    }
  }, [headers]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    try {
      setMarked(loadIncluded(localStorage));
    } catch {
      setMarked([]);
    }
    if (initialScene) setScene(initialScene);
    void refresh().then((r) => {
      if (r?.status.running) setJob({ id: r.status.running, status: "running", startedAt: Date.now() });
    });
  }, [open, initialScene, refresh]);

  // While a video is being made: tick the clock for the wait message and check on the job.
  const jobId = job?.status === "running" ? job.id : null;
  useEffect(() => {
    if (!open || !jobId) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/videos/jobs/${jobId}`);
        const data = await res.json();
        if (!res.ok) {
          setJob((j) => (j ? { ...j, status: "error", error: data.error } : j));
          return;
        }
        setJob(data.job);
        if (data.job.status !== "running") {
          const r = await refresh();
          const made = r?.videos.find((v) => v.id === data.job.videoId);
          if (made) setPlaying(made);
          if (data.job.error) setError(data.job.error);
        }
      } catch {
        // A blip; the next tick tries again.
      }
    }, 2000);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
    };
  }, [open, jobId, refresh]);

  const models = withIncluded(status?.models ?? [], marked);
  const current = models.find((m) => m.id === model) ?? models.find((m) => m.id === status?.model);
  const silent = current?.sound === "no";
  const lengths = current ? current.seconds : [4, 6, 8];
  const showQuality = status?.provider === "gemini" || Boolean(current?.resolutions);
  const qualities = current?.resolutions ?? VIDEO_QUALITIES.filter((q) => q !== "480p");
  function chooseModel(id: string) {
    setModel(id);
    const next = models.find((m) => m.id === id);
    if (next) {
      setSeconds((s) => nearestSeconds(next, s));
      if (!next.aspects.includes(aspect)) setAspect(next.aspects[0] as VideoAspect);
    }
  }
  const abort = useRef<AbortController | null>(null);
  async function make() {
    setError(null);
    setPlaying(null);
    abort.current = new AbortController();
    const res = await fetch("/api/videos/generate", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({ scene, speech: silent ? "" : speech, sound: silent ? "" : sound, avoid, aspect, seconds, quality, realistic, ...(current && status?.provider === "nanogpt" ? { model: current.id } : {}) }),
      signal: abort.current.signal,
    }).catch((e: Error) => ({ ok: false, json: async () => ({ error: e.message }) }) as Response);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? "Couldn't start the video.");
    setJob(data.job);
    setNow(Date.now());
  }

  async function stop() {
    if (!job) return;
    await fetch(`/api/videos/jobs/${job.id}`, { method: "DELETE" });
  }

  async function remove(v: Made) {
    if (!(await fetch(`/api/videos/${v.id}`, { method: "DELETE" })).ok) return setError("Couldn't delete that video.");
    setLibrary((all) => all.filter((x) => x.id !== v.id));
    if (playing?.id === v.id) setPlaying(null);
  }

  useEscape(open, onClose);
  const dialogRef = useDialogFocus(open);
  if (!open) return null;

  const running = job?.status === "running";
  const elapsed = job ? Math.max(0, Math.floor((now - job.startedAt) / 1000)) : 0;
  const choice = (on: boolean) => `min-h-8 rounded-md border px-2.5 py-1 text-[12px] transition ${on ? "border-arc-dim bg-arc-dim/15 text-ink" : "border-line text-ink-dim hover:border-arc-dim/50 hover:text-ink"}`;
  const hiRes = status?.provider === "gemini" ? seconds === 8 && aspect === "16:9" : true;

  return (
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-xl border border-line bg-panel shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="video-title" data-video-studio onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <h2 id="video-title" className="flex items-center gap-2 text-sm font-semibold">
            <Clapperboard size={16} className="text-arc" aria-hidden />
            Video studio
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-ink-faint hover:bg-raised hover:text-ink">
            <X size={16} />
          </button>
        </header>

        <div className="max-h-[78vh] space-y-3.5 overflow-y-auto p-4" tabIndex={0} role="region" aria-label="Video studio controls">
          <p className="rounded-md border border-line-soft bg-base px-3 py-2 text-[12px] leading-relaxed text-ink-dim" data-video-status>
            {status ? status.note : "Checking…"}
            {status?.available && ` ${status.used} of ${status.limit} made today.`}
          </p>

          {models.length > 0 && (
            <VideoModelPicker
              models={models}
              value={current?.id ?? ""}
              onChange={chooseModel}
              marked={marked}
              onToggleMarked={(id) => {
                const next = toggleIncluded(marked, id);
                setMarked(next);
                try {
                  saveIncluded(localStorage, next);
                } catch {
                  // Remembering is a convenience.
                }
              }}
              source={status?.catalog?.source ?? null}
              subscriptionListing={Boolean(status?.catalog?.subscriptionListing)}
            />
          )}
          <div>
            <label htmlFor="video-scene" className="mb-1 block text-[12px] text-ink-dim">
              The scene — who, where, what happens, how it is shot
            </label>
            <textarea id="video-scene" data-video-scene value={scene} onChange={(e) => setScene(e.target.value.slice(0, MAX_SCENE))} rows={3} placeholder="A fisherman mends a net on a wooden pier at dawn, slow dolly in, light mist over the water" className="w-full resize-none rounded-md border border-line bg-base px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-arc-dim" />
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="min-w-0 flex-1 basis-64">
              <label htmlFor="video-speech" className="mb-1 block text-[12px] text-ink-dim">
                What is said <span className="text-ink-faint">(optional, spoken aloud)</span>
              </label>
              <input id="video-speech" data-video-speech disabled={silent} value={speech} onChange={(e) => setSpeech(e.target.value.slice(0, MAX_SPEECH))} placeholder="Good catch today, wasn't it?" className="w-full rounded-md border border-line bg-base px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-arc-dim disabled:opacity-50" />
            </div>
            <div className="min-w-0 flex-1 basis-64">
              <label htmlFor="video-sound" className="mb-1 block text-[12px] text-ink-dim">
                What is heard <span className="text-ink-faint">(optional)</span>
              </label>
              <input id="video-sound" data-video-sound disabled={silent} value={sound} onChange={(e) => setSound(e.target.value.slice(0, MAX_SOUND))} placeholder="gulls, water lapping, rope creaking, distant bell" className="w-full rounded-md border border-line bg-base px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-arc-dim disabled:opacity-50" />
            </div>
          </div>
          <div>
            <label htmlFor="video-avoid" className="mb-1 block text-[12px] text-ink-dim">
              Leave out <span className="text-ink-faint">(optional)</span>
            </label>
            <input id="video-avoid" value={avoid} onChange={(e) => setAvoid(e.target.value.slice(0, 200))} placeholder="text, subtitles, music" className="w-full rounded-md border border-line bg-base px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-arc-dim" />
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2.5">
            <div role="radiogroup" aria-label="Shape" data-choice="aspect" className="space-y-1">
              <span className="block text-[12px] text-ink-dim">Shape</span>
              <div className="flex gap-1.5">
                {VIDEO_ASPECTS.map((a) => (
                  <button key={a} type="button" role="radio" aria-checked={aspect === a} data-value={a} onClick={() => setAspect(a)} className={choice(aspect === a)}>
                    {a === "16:9" ? "Landscape 16:9" : "Vertical 9:16"}
                  </button>
                ))}
              </div>
            </div>
            <div role="radiogroup" aria-label="Length" data-choice="seconds" className="space-y-1">
              <span className="block text-[12px] text-ink-dim">Length</span>
              <div className="flex gap-1.5">
                {lengths.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={seconds === s} data-value={s} onClick={() => setSeconds(s)} className={choice(seconds === s)}>
                    {s} seconds
                  </button>
                ))}
              </div>
            </div>
            {showQuality && (
            <div role="radiogroup" aria-label="Quality" data-choice="quality" className="space-y-1">
              <span className="block text-[12px] text-ink-dim">Quality</span>
              <div className="flex gap-1.5">
                {qualities.map((q) => (
                  <button key={q} type="button" role="radio" aria-checked={quality === q} data-value={q} disabled={q === "1080p" && !hiRes} onClick={() => setQuality(q as VideoQuality)} title={q === "1080p" && !hiRes ? "1080p needs 8 seconds, landscape" : undefined} className={`${choice(quality === q)} disabled:opacity-50`}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
            )}
          </div>
          <label className="flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" checked={realistic} onChange={(e) => setRealistic(e.target.checked)} data-video-realistic className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-arc-solid)]" />
            <span className="text-[12.5px] text-ink">
              Aim for live-action realism
              <span className="block text-[11.5px] text-ink-faint">Adds cinema-camera, natural-light and true-to-life wording. Turn it off for animation or a stylised look.</span>
            </span>
          </label>

          <p className="text-[11.5px] leading-relaxed text-ink-faint">
            This is AI-generated and the provider marks it as such. Don&apos;t make videos that pass off a real person as saying or doing something they didn&apos;t, and don&apos;t post one as real footage. Each video is billed by your provider.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void make()} disabled={running || !scene.trim() || status?.available === false} data-video-make className="flex min-h-9 items-center gap-1.5 rounded-lg bg-arc-solid px-4 text-[13px] text-white transition hover:bg-arc-solid-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-faint">
              {running ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Clapperboard size={14} aria-hidden />}
              {running ? "Filming…" : "Make the video"}
            </button>
            {running && (
              <button type="button" onClick={() => void stop()} data-video-stop className="min-h-9 rounded-lg border border-line px-3 text-[12.5px] text-ink-dim hover:text-ink">
                Stop waiting
              </button>
            )}
          </div>

          {running && (
            <p role="status" className="text-[12.5px] text-ink-dim" data-video-progress>
              {waitLabel(elapsed)} <span className="font-mono text-ink-faint">{elapsed}s</span>
              {job?.cost !== undefined && <span className="ml-2 text-ink-faint" data-video-cost>charged ${job.cost.toFixed(2)}</span>}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-md border border-warn/40 px-3 py-2 text-[12.5px] text-warn" data-video-error>
              {error}
            </p>
          )}

          {playing && (
            <figure className="space-y-1.5" data-video-player>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- generated clips have no caption track; the spoken words are in the library notes */}
              <video src={playing.url} controls playsInline className="w-full rounded-lg border border-line bg-black" aria-label={playing.scene} />
              <figcaption className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-faint">
                <span className="min-w-0 flex-1 truncate">{playing.scene}</span>
                <a href={`${playing.url}?download=1`} className="flex min-h-7 items-center gap-1 rounded px-1.5 text-arc hover:underline">
                  <Download size={12} aria-hidden />
                  Save
                </a>
              </figcaption>
            </figure>
          )}

          {library.length > 0 && (
            <section aria-labelledby="video-library" data-video-library>
              <h3 id="video-library" className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
                Your videos
              </h3>
              <ul className="space-y-1">
                {library.map((v) => (
                  <li key={v.id} className="flex items-center gap-2 text-[12px]" data-video-item={v.id}>
                    <button type="button" onClick={() => setPlaying(v)} className="min-w-0 flex-1 truncate text-left text-ink hover:text-arc" title={v.scene}>
                      {v.scene}
                    </button>
                    <span className="shrink-0 text-ink-faint">
                      {v.seconds}s · {v.aspect}{v.cost !== undefined ? ` · $${v.cost.toFixed(2)}` : ""}
                    </span>
                    <button type="button" onClick={() => void remove(v)} aria-label={`Delete the video: ${v.scene}`} className="rounded p-1.5 text-ink-faint transition hover:bg-raised hover:text-danger">
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
