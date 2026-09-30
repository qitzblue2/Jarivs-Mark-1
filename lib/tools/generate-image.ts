import { imageIdFrom, imageUrl, readImage, saveImage } from "@/lib/images/store";
import { displayConnected } from "@/lib/display";
import { deviceMode } from "@/lib/voice/device/detect";
import { recordRequest } from "@/lib/providers/usage";
import { guardedFetch, readCappedBytes } from "./net-guard";
import type { Tool, ToolContext } from "./types";

/**
 * Pictures, via NanoGPT.
 *
 * The bytes never go back to the model — a base64 PNG is 1-2MB of text, which
 * blows every provider's per-request budget at once. The picture is saved by
 * lib/images/store.ts and the model gets a short same-origin URL to put in its
 * reply, which also works as a path for `show_on_display`.
 *
 * The model is chosen by the server (JARVIS_IMAGE_MODEL), not the model: an
 * argument it could set is an argument it could set to the most expensive
 * thing on the menu.
 */
const ENDPOINT = "https://nano-gpt.com/api/v1/images/generations";

/** Overridable so the tests can point it at the mock provider. */
function endpoint(): string {
  return process.env.JARVIS_NANOGPT_IMAGES_URL || ENDPOINT;
}
/** Generation takes a while; a hung request should still end. */
const TIMEOUT_MS = 120_000;
/** A PNG at 1024² is 1-3MB. Anything past this is not a picture we asked for. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** NanoGPT's own ceiling on an input picture, after base64 encoding. */
export const MAX_EDIT_INPUT_CHARS = 4 * 1024 * 1024;

/**
 * Pixel sizes per shape. NanoGPT does not publish which sizes each model
 * takes, so these stay within a square's pixel count on multiples of 64, and
 * a refused shape falls back to square rather than failing the picture.
 */
export const SHAPES: Record<string, string> = {
  square: "1024x1024",
  portrait: "768x1024",
  landscape: "1024x768",
};

/** How picture requests appear on the usage page. */
export const IMAGE_USAGE_ID = "nanogpt:images";

export function imageModel(): string {
  return process.env.JARVIS_IMAGE_MODEL?.trim() || "hidream";
}

export function editModel(): string {
  return process.env.JARVIS_IMAGE_EDIT_MODEL?.trim() || imageModel();
}

/** The key image generation would use, or undefined when there is none. */
export function resolveImageKey(clientKey?: string | null): string | undefined {
  return process.env.NANOGPT_API_KEY || clientKey || undefined;
}

/** Find the picture an edit starts from: this turn's upload, or an earlier one of ours. */
async function sourceImage(
  ref: string,
  ctx: ToolContext,
): Promise<{ dataUrl: string; fromId?: string }> {
  if (ref === "upload") {
    const upload = ctx.uploads?.[ctx.uploads.length - 1];
    if (!upload) {
      throw new Error(
        'No picture is attached to this message. Ask the user to attach one, or pass the path of an earlier generated image as "edit".',
      );
    }
    return { dataUrl: upload };
  }

  const id = imageIdFrom(ref);
  const found = id ? await readImage(id) : null;
  if (!found) {
    throw new Error(`"${ref}" isn't a picture I made. Use "upload" for an attached one, or an /api/images/… path.`);
  }
  return { dataUrl: `data:${found.meta.mime};base64,${found.bytes.toString("base64")}`, fromId: found.meta.id };
}

export const generateImageTool: Tool = {
  name: "generate_image",
  description:
    "Create or edit a picture. Put the returned markdown in your reply exactly as given.",
  dangerous: true,
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "What to show, or what to change." },
      edit: { type: "string", description: 'To change one: "upload" or its /api/images/ path.' },
      shape: { type: "string", enum: ["square", "portrait", "landscape"] },
    },
    required: ["prompt"],
  },

  async handler(args, ctx) {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) throw new Error("No prompt given.");

    const apiKey = ctx.imageKey ?? resolveImageKey();
    if (!apiKey) {
      throw new Error("No NanoGPT key — pictures need one, even when another provider is answering.");
    }

    const editRef = typeof args.edit === "string" ? args.edit.trim() : "";
    const source = editRef ? await sourceImage(editRef, ctx) : null;
    if (source && source.dataUrl.length > MAX_EDIT_INPUT_CHARS) {
      throw new Error("That picture is too large to edit (4MB limit). Ask for a smaller one.");
    }
    const model = source ? editModel() : imageModel();
    const shape = typeof args.shape === "string" && SHAPES[args.shape] ? args.shape : "square";

    const signal = ctx.signal
      ? AbortSignal.any([ctx.signal, AbortSignal.timeout(TIMEOUT_MS)])
      : AbortSignal.timeout(TIMEOUT_MS);

    const request = (size: string) =>
      fetch(endpoint(), {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size,
          response_format: "b64_json",
          ...(source ? { imageDataUrl: source.dataUrl } : {}),
        }),
      });

    // Counted apart from chat: the subscription's picture allowance is its own
    // number (100 a day), and mixing the two would hide both.
    let res = await request(SHAPES[shape]);
    recordRequest(IMAGE_USAGE_ID, 0, res.status);
    let squared = false;
    if (res.status === 400 && shape !== "square") {
      await res.text().catch(() => "");
      res = await request(SHAPES.square);
      recordRequest(IMAGE_USAGE_ID, 0, res.status);
      squared = true;
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`NanoGPT image generation failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    const json = await res.json();
    const item = json?.data?.[0];
    if (!item) throw new Error("NanoGPT returned no image.");

    let bytes: Buffer;
    if (item.b64_json) {
      bytes = Buffer.from(String(item.b64_json), "base64");
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error("The returned picture was implausibly large.");
    } else if (item.url) {
      // The URL comes out of a provider response, so it gets the same guard
      // as one a model chose: no private addresses, a size cap, a timeout.
      const { response } = await guardedFetch(String(item.url), { signal });
      if (!response.ok) throw new Error(`Couldn't download the generated picture (${response.status}).`);
      bytes = Buffer.from(await readCappedBytes(response, MAX_IMAGE_BYTES, true));
    } else {
      throw new Error("NanoGPT returned no image data.");
    }

    const meta = await saveImage(bytes, { prompt, model, editedFrom: source?.fromId });
    const alt = prompt.replace(/[[\]\n]/g, " ").slice(0, 80).trim();
    const url = imageUrl(meta.id);
    // Said here rather than in the schema, so only a turn that made a picture
    // pays for the hint, and only where a wall exists to put it on.
    const wall = deviceMode() || displayConnected()
      ? ` A room screen is available: show_on_display with kind "image" and body "${url}" puts it there.`
      : "";
    const note = squared ? ` (${model} refused a ${shape} size, so it is square.)` : "";
    return `Saved. Show it with: ![${alt}](${url})${note}${wall}`;
  },
};

