import { createHash } from "node:crypto";
import { NANO_VIDEO_MODELS, splitFreePaid, type SoundSupport, type VideoModel } from "./models";

export { splitFreePaid };
import { nanoVideoBase } from "./nano";

/**
 * NanoGPT's live list of video models, turned into what the studio needs: a
 * name, what it can do, and whether it costs you anything extra.
 *
 * NanoGPT's documentation describes the list's shape (GET /api/v1/video-models)
 * but leaves most of it open — pricing is "per generation, per second, duration
 * tier, resolution tier" with no field names, `supported_parameters` is shown
 * empty, and nothing is documented about which video models a subscription
 * includes. So everything here is read defensively, from whatever fields
 * actually arrive, and what can't be worked out is "unknown" rather than guessed.
 * Anything unrecognised falls back to common settings, and the built-in list
 * (models.ts) stands in if the list can't be fetched at all.
 */

const ID = /^[A-Za-z0-9._\-:/]{1,80}$/;
const DEFAULT_SECONDS = [5, 8, 10];
const DEFAULT_ASPECTS = ["16:9", "9:16"];

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The list of choices a parameter offers, from the several shapes such a field might take. Null when it isn't a list. */
export function optionsOf(param: unknown): unknown[] | null {
  if (Array.isArray(param)) return param;
  const o = obj(param);
  for (const key of ["options", "enum", "values", "allowed", "choices", "supported"]) if (Array.isArray(o[key])) return o[key] as unknown[];
  const { min, max } = o;
  if (typeof min === "number" && typeof max === "number" && max >= min && max - min <= 60) {
    const mid = typeof o.default === "number" && o.default > min && o.default < max ? [o.default] : [];
    return [min, ...mid, max];
  }
  return null;
}

function seconds(param: unknown): number[] | null {
  const list = optionsOf(param);
  if (!list) return null;
  const nums = [...new Set(list.map((v) => Number(String(v).replace(/s$/i, ""))).filter((n) => Number.isFinite(n) && n > 0 && n <= 120))].sort((a, b) => a - b);
  return nums.length ? nums : null;
}
function strings(param: unknown, pattern: RegExp): string[] | null {
  const list = optionsOf(param);
  if (!list) return null;
  const out = [...new Set(list.map((v) => String(v).trim()).filter((s) => pattern.test(s)))];
  return out.length ? out : null;
}

/** One line about the price, from whatever numeric fields the pricing object has. */
export function summarisePricing(pricing: unknown): string | null {
  const p = obj(pricing);
  const parts: string[] = [];
  const label = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ").toLowerCase().replace(/^per /, "per ").trim();
  for (const [k, v] of Object.entries(p)) {
    if (k === "currency" || k === "unit") continue;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) parts.push(`$${v < 0.1 ? v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : v.toFixed(2)} ${label(k)}`);
    else if (v && typeof v === "object") {
      const inner = Object.entries(v as Record<string, unknown>).filter(([, n]) => typeof n === "number" && (n as number) >= 0);
      if (inner.length) {
        const lowest = inner.reduce((a, b) => ((b[1] as number) < (a[1] as number) ? b : a));
        parts.push(`from $${(lowest[1] as number).toFixed(2)} ${label(k)} (${lowest[0]})`);
      }
    }
  }
  return parts.length ? parts.slice(0, 2).join(", ") : null;
}

const FREE_FLAGS = ["included", "subscriptionIncluded", "includedInSubscription", "isIncluded", "inSubscription", "free", "isFree", "subscription"];

/** Whether the list itself says this model costs nothing extra: an explicit flag, or a price of exactly zero. */
export function isIncluded(model: Record<string, unknown>): boolean {
  for (const holder of [model, obj(model.pricing), obj(model.capabilities), obj(model.subscription)]) {
    for (const flag of FREE_FLAGS) if (holder[flag] === true) return true;
  }
  const prices = Object.entries(obj(model.pricing))
    .filter(([k]) => k !== "currency" && k !== "unit")
    .flatMap(([, v]) => (typeof v === "number" ? [v] : v && typeof v === "object" ? Object.values(v as Record<string, unknown>).filter((n): n is number => typeof n === "number") : []));
  return prices.length > 0 && prices.every((n) => n === 0);
}

const soundOf = (caps: Record<string, unknown>, known: VideoModel | undefined): SoundSupport => {
  if (typeof caps.audio_generation === "boolean") return caps.audio_generation ? "yes" : "no";
  return known?.sound ?? "unknown";
};

/** The list's response as models. Anything that isn't a usable text-to-video entry is left out; never throws. */
export function parseCatalog(json: unknown): VideoModel[] {
  const data = obj(json).data;
  if (!Array.isArray(data)) return [];
  const out: VideoModel[] = [];
  const seen = new Set<string>();
  for (const raw of data) {
    const m = obj(raw);
    const id = m.id;
    if (typeof id !== "string" || !ID.test(id) || id.includes("..") || seen.has(id)) continue;
    const caps = obj(m.capabilities);
    // JARVIS sends a prompt, not a starting picture, so a model that can only animate one is no use here.
    if (caps.text_to_video === false) continue;
    seen.add(id);
    const known = NANO_VIDEO_MODELS.find((k) => k.id === id);
    const params = obj(m.supported_parameters);
    const resolutions = strings(params.resolution, /^(\d{3,4}p|[248]k)$/i) ?? known?.resolutions;
    out.push({
      id,
      label: typeof m.name === "string" && m.name.trim() ? m.name.trim().slice(0, 60) : known?.label ?? id,
      sound: soundOf(caps, known),
      seconds: seconds(params.duration) ?? known?.seconds ?? DEFAULT_SECONDS,
      aspects: strings(params.aspect_ratio, /^\d{1,2}:\d{1,2}$/) ?? known?.aspects ?? DEFAULT_ASPECTS,
      ...(resolutions ? { resolutions } : {}),
      ...(id.startsWith("sora") ? { family: "sora" as const } : {}),
      free: isIncluded(m),
      price: summarisePricing(m.pricing),
      description: typeof m.description === "string" ? m.description.slice(0, 200) : undefined,
      source: "live",
    });
  }
  return out;
}

/** The built-in list, shaped like a fetched one, for when the real one can't be reached. */
export const builtinCatalog = (): VideoModel[] => NANO_VIDEO_MODELS.map((m) => ({ ...m, free: false, price: null, source: "builtin" as const }));

/** Ids the subscription's own listing names, which are included whatever the main list says. */
export function parseIncludedIds(json: unknown): Set<string> {
  const data = obj(json).data;
  return new Set(Array.isArray(data) ? data.map((m) => obj(m).id).filter((id): id is string => typeof id === "string") : []);
}

// --- fetching, with a short cache -------------------------------------------------------------------

export interface Catalog {
  models: VideoModel[];
  source: "live" | "builtin";
  /** Whether a subscription-only listing was found and used to mark models included. */
  subscriptionListing: boolean;
}

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: Catalog }>();
const cacheKey = (key: string) => createHash("sha256").update(`${nanoVideoBase()}|${key}`).digest("hex").slice(0, 24);

async function getJson(path: string, key: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${nanoVideoBase()}${path}`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(8000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** The live catalog (cached ten minutes per key), or the built-in list. Never throws. */
export async function getCatalog(key: string, now = Date.now()): Promise<Catalog> {
  const id = cacheKey(key);
  const hit = cache.get(id);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  const [main, included] = await Promise.all([getJson("/api/v1/video-models?detailed=true", key), getJson("/api/subscription/v1/video-models", key)]);
  let models = parseCatalog(main);
  const subscriptionIds = parseIncludedIds(included);
  let value: Catalog;
  if (models.length === 0) {
    value = { models: builtinCatalog(), source: "builtin", subscriptionListing: false };
  } else {
    if (subscriptionIds.size > 0) models = models.map((m) => (subscriptionIds.has(m.id) ? { ...m, free: true } : m));
    value = { models, source: "live", subscriptionListing: subscriptionIds.size > 0 };
  }
  // A failed fetch is not cached for the full time, so a brief outage doesn't pin the built-in list.
  cache.set(id, { at: value.source === "live" ? now : now - TTL_MS + 30_000, value });
  return value;
}

export const clearCatalogCache = () => cache.clear();
