/**
 * Everything about asking for a picture that doesn't touch the network: the
 * styles on offer, how a request is checked and turned into a prompt, how to
 * tell that a message is asking for one, and the small helpers the studio and
 * the gallery lean on.
 *
 * A style is a phrase the server adds to the prompt. The page sends the style's
 * name, and the server looks the phrase up, so what reaches the image provider
 * is the user's words plus words JARVIS holds.
 */
export interface ImageStyle {
  id: string;
  label: string;
  /** Added after the user's prompt. */
  suffix: string;
}

export const IMAGE_STYLES: ImageStyle[] = [
  { id: "none", label: "None", suffix: "" },
  { id: "photo", label: "Photo", suffix: "photorealistic, natural light, sharp focus, 35mm photograph" },
  { id: "watercolour", label: "Watercolour", suffix: "watercolour painting, wet paper, soft edges, visible brush strokes" },
  { id: "anime", label: "Anime", suffix: "anime illustration, clean line art, vibrant colours, cel shading" },
  { id: "render", label: "3D render", suffix: "3D render, soft studio lighting, smooth materials, high detail" },
  { id: "pixel", label: "Pixel art", suffix: "pixel art, limited palette, crisp pixels, retro game sprite" },
  { id: "logo", label: "Logo", suffix: "minimal vector logo, flat shapes, strong silhouette, plain background" },
  { id: "sketch", label: "Sketch", suffix: "pencil sketch, hand drawn, cross-hatching, white paper" },
  { id: "cinematic", label: "Cinematic", suffix: "cinematic still, dramatic lighting, shallow depth of field, film grain" },
  { id: "oil", label: "Oil painting", suffix: "oil painting, thick brushwork, rich colour, canvas texture" },
];

export const STYLE_IDS = IMAGE_STYLES.map((s) => s.id);
export const isImageStyle = (v: unknown): v is string => typeof v === "string" && STYLE_IDS.includes(v);

export const IMAGE_SHAPES = ["square", "portrait", "landscape", "wide"] as const;
export type ImageShape = (typeof IMAGE_SHAPES)[number];
export const isImageShape = (v: unknown): v is ImageShape => typeof v === "string" && (IMAGE_SHAPES as readonly string[]).includes(v);

/** Pixels per shape, on multiples of 64. */
export const SHAPE_PIXELS: Record<ImageShape, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  portrait: { width: 768, height: 1024 },
  landscape: { width: 1024, height: 768 },
  wide: { width: 1344, height: 768 },
};

export const MAX_PROMPT = 1000;
export const MAX_AVOID = 300;
export const MAX_COUNT = 4;

export interface ImageRequest {
  prompt: string;
  style: string;
  avoid: string;
  shape: ImageShape;
  count: number;
  seed: number | null;
}

export type ImageRequestResult = { ok: true; request: ImageRequest } | { ok: false; error: string };

const oneLine = (text: unknown, max: number) => (typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Check what a page sent. Unknown styles and shapes are errors, not silently swapped. */
export function cleanImageRequest(raw: unknown): ImageRequestResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Expected a JSON object." };
  const r = raw as Record<string, unknown>;
  const prompt = oneLine(r.prompt, MAX_PROMPT);
  if (!prompt) return { ok: false, error: "Say what to draw." };
  if (r.style !== undefined && !isImageStyle(r.style)) return { ok: false, error: "Unknown style." };
  if (r.shape !== undefined && !isImageShape(r.shape)) return { ok: false, error: "Unknown shape." };
  let count = 1;
  if (r.count !== undefined) {
    if (typeof r.count !== "number" || !Number.isInteger(r.count) || r.count < 1 || r.count > MAX_COUNT) {
      return { ok: false, error: `Count must be 1 to ${MAX_COUNT}.` };
    }
    count = r.count;
  }
  let seed: number | null = null;
  if (r.seed !== undefined && r.seed !== null) {
    if (typeof r.seed !== "number" || !Number.isInteger(r.seed) || r.seed < 0 || r.seed > 2_147_483_647) {
      return { ok: false, error: "Seed must be a whole number." };
    }
    seed = r.seed;
  }
  return {
    ok: true,
    request: {
      prompt,
      style: (r.style as string | undefined) ?? "none",
      avoid: oneLine(r.avoid, MAX_AVOID),
      shape: (r.shape as ImageShape | undefined) ?? "square",
      count,
      seed,
    },
  };
}

/**
 * The text actually sent to the provider: your prompt, the style's phrase, and
 * what to avoid — in words, since not every provider takes a separate field.
 */
export function styledPrompt(prompt: string, style: string, avoid = ""): string {
  const suffix = IMAGE_STYLES.find((s) => s.id === style)?.suffix ?? "";
  return [prompt.trim(), suffix, avoid.trim() ? `avoid: ${avoid.trim()}` : ""].filter(Boolean).join(", ");
}

/** The seeds for a set of variations: the first given or fresh, the rest stepping away from it. */
export function seedsFor(count: number, first: number | null, rng: () => number = Math.random): number[] {
  const start = first ?? Math.floor(rng() * 1_000_000_000);
  return Array.from({ length: count }, (_, i) => (start + i * 7919) % 2_147_483_647);
}

const VERBS = "(?:draw|paint|sketch|illustrate|render|generate|create|make|design)";
const THING = "(?:a |an |the |me |us )*(?:picture|image|photo|illustration|drawing|painting|logo|poster|portrait|wallpaper|icon|sketch|artwork|render)";
const ASK = new RegExp(`^\\s*(?:please\\s+|can you\\s+|could you\\s+)?(?:(?:${VERBS}\\s+(?:me\\s+|us\\s+)?${THING}\\s+(?:of|showing|with|for)\\s+)|(?:(?:draw|paint|sketch|illustrate)\\s+(?:me\\s+|us\\s+)?))(.{3,})$`, "i");

/**
 * The picture a message seems to ask for ("draw a lighthouse", "make me an image
 * of a fox"), or null. It only offers a button — nothing is drawn until you press
 * it — so a wrong guess costs a glance, never a request.
 */
export function imagePromptFrom(text: string): string | null {
  const t = text.trim();
  if (t.length > 400 || t.startsWith("/") || t.includes("\n")) return null;
  const m = ASK.exec(t);
  if (!m) return null;
  const subject = m[1].replace(/[.?!]+$/, "").trim();
  return subject.length >= 3 ? subject : null;
}

/** Pictures whose prompt contains every word typed. */
export function filterPictures<T extends { prompt: string }>(pictures: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length === 0 ? pictures : pictures.filter((p) => words.every((w) => p.prompt.toLowerCase().includes(w)));
}

/** Newest first, no repeats, at most `max`. */
export function rememberImagePrompt(list: string[], prompt: string, max = 12): string[] {
  const p = prompt.trim();
  if (!p) return list;
  return [p, ...list.filter((x) => x !== p)].slice(0, max);
}

export function cleanImagePromptList(raw: unknown, max = 12): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= MAX_PROMPT).slice(0, max);
}
