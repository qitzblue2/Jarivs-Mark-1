import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Tool } from "./types";

/**
 * Pictures, via NanoGPT.
 *
 * The image bytes never go to the model — a base64 PNG is 1-2MB of text,
 * which blows every provider's per-request token budget instantly. Instead
 * the file is saved under public/generated/ (Next.js serves public/ at the
 * site root with no extra route needed) and only a short URL goes back to
 * the model, which is told to paste that URL into its reply as markdown so
 * it actually renders for the user. NANOGPT_API_KEY is required even when a
 * different provider is answering chat.
 */
const ENDPOINT = "https://nano-gpt.com/api/v1/images/generations";
const OUT_DIR = path.join(process.cwd(), "public", "generated");

export const generateImageTool: Tool = {
  name: "generate_image",
  description:
    "Generate an image from a text description. Returns a short URL — you " +
    "MUST include it in your reply as markdown, exactly as given, e.g. " +
    "`![description](URL)`, so it actually renders for the user.",
  dangerous: true,
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "What the image should show." },
      model: { type: "string", description: 'NanoGPT image model id, default "hidream".' },
    },
    required: ["prompt"],
  },

  async handler(args, ctx) {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) throw new Error("No prompt given.");
    const model = String(args.model ?? "hidream").trim();

    const apiKey = process.env.NANOGPT_API_KEY;
    if (!apiKey) {
      throw new Error(
        "NANOGPT_API_KEY is not set — image generation needs a NanoGPT key even if another provider is answering chat.",
      );
    }

    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: ctx.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024" }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`NanoGPT image generation failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    const json = await res.json();
    const item = json?.data?.[0];
    if (!item) throw new Error("NanoGPT returned no image.");

    let bytes: Buffer;
    if (item.b64_json) {
      bytes = Buffer.from(item.b64_json, "base64");
    } else if (item.url) {
      const img = await fetch(item.url);
      if (!img.ok) throw new Error(`Couldn't download the generated image (${img.status}).`);
      bytes = Buffer.from(await img.arrayBuffer());
    } else {
      throw new Error("NanoGPT returned no image data.");
    }

    await mkdir(OUT_DIR, { recursive: true });
    const filename = `${randomUUID()}.png`;
    await writeFile(path.join(OUT_DIR, filename), bytes);

    const url = `/generated/${filename}`;
    return `Image saved. Show it with: ![${prompt.replace(/[[\]]/g, "")}](${url})`;
  },
};
