import { cleanImagePromptList, IMAGE_SHAPES, isImageShape, isImageStyle, type ImageShape } from "./styles";

/**
 * What the image studio remembers between visits: the last style, shape and
 * count, and the prompts you used recently. Kept in this browser only, read
 * defensively (storage can be blocked, and anything stored can be edited by
 * hand), and never anything but those few fields.
 */
export interface StudioState {
  style: string;
  shape: ImageShape;
  count: number;
  history: string[];
}

export const STUDIO_KEY = "jarvis.studio.v1";
export const DEFAULT_STUDIO: StudioState = { style: "none", shape: "square", count: 1, history: [] };

export function cleanStudio(raw: unknown): StudioState {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    style: isImageStyle(r.style) ? r.style : DEFAULT_STUDIO.style,
    shape: isImageShape(r.shape) ? r.shape : DEFAULT_STUDIO.shape,
    count: typeof r.count === "number" && Number.isInteger(r.count) && r.count >= 1 && r.count <= 4 ? r.count : DEFAULT_STUDIO.count,
    history: cleanImagePromptList(r.history),
  };
}

export function loadStudio(storage: Pick<Storage, "getItem"> | null): StudioState {
  try {
    const text = storage?.getItem(STUDIO_KEY);
    return cleanStudio(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_STUDIO };
  }
}

export function saveStudio(storage: Pick<Storage, "setItem"> | null, state: StudioState): void {
  try {
    storage?.setItem(STUDIO_KEY, JSON.stringify(cleanStudio(state)));
  } catch {
    // Blocked or full: the studio still works, it just forgets.
  }
}

export const SHAPE_LABEL: Record<ImageShape, string> = { square: "Square", portrait: "Portrait", landscape: "Landscape", wide: "Wide" };
export const SHAPE_LIST = IMAGE_SHAPES;
