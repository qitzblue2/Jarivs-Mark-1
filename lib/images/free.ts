import { readCappedBytes } from "@/lib/tools/net-guard";
import { SHAPE_PIXELS, type ImageShape } from "./styles";

/**
 * Pictures with no key: Pollinations' free image endpoint (FLUX models, no
 * account). It is a third party that sees your prompt, so it is used only when
 * you press the button or type /image yourself, and `JARVIS_FREE_IMAGES=0`
 * turns it off entirely. The model never reaches it unless you also set
 * `JARVIS_FREE_IMAGES=1`, because a picture tool in every request costs tokens
 * even on turns that never draw.
 *
 * The address is fixed in configuration, never taken from a request, and what
 * comes back must be a real image of a plausible size.
 */
const DEFAULT_BASE = "https://image.pollinations.ai";
const TIMEOUT_MS = 90_000;
const MAX_BYTES = 20 * 1024 * 1024;
export const FREE_MODEL = "pollinations-flux";
export const FREE_USAGE_ID = "pollinations:images";

export const freeBase = (): string => (process.env.JARVIS_POLLINATIONS_URL || DEFAULT_BASE).replace(/\/+$/, "");

/** On unless switched off. */
export const freeImagesEnabled = (): boolean => process.env.JARVIS_FREE_IMAGES !== "0";
/** Offered to the model as a tool only when asked for. */
export const freeImagesForModel = (): boolean => process.env.JARVIS_FREE_IMAGES === "1";

/** The URL for one picture. Pure, so it can be tested without a network. */
export function freeImageUrl(prompt: string, shape: ImageShape, seed: number): string {
  const { width, height } = SHAPE_PIXELS[shape];
  const qs = new URLSearchParams({ width: String(width), height: String(height), seed: String(seed), model: "flux", nologo: "true" });
  return `${freeBase()}/prompt/${encodeURIComponent(prompt)}?${qs}`;
}

export async function freeImage(opts: { prompt: string; shape: ImageShape; seed: number; signal?: AbortSignal }): Promise<Buffer> {
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(freeImageUrl(opts.prompt, opts.shape, opts.seed), { signal, redirect: "error" });
  if (!res.ok) throw new Error(`The free picture service answered ${res.status}. Try again in a moment.`);
  return Buffer.from(await readCappedBytes(res, MAX_BYTES, true));
}
