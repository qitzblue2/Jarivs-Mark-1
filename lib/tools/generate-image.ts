import type { Tool } from "./types";

/**
 * Pictures, via NanoGPT.
 *
 * Separate from lib/providers — chat and images are different endpoints, and
 * NanoGPT is the only slot wired here that offers image generation at all
 * (its subscription includes 100 images/day; see providers/registry.ts).
 * Needs NANOGPT_API_KEY even when a different provider is answering the chat.
 */
const ENDPOINT = "https://nano-gpt.com/api/v1/images/generations";

export const generateImageTool: Tool = {
  name: "generate_image",
  description: "Generate an image from a text description and show it in the chat.",
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
    const dataUrl = item?.b64_json ? `data:image/png;base64,${item.b64_json}` : item?.url;
    if (!dataUrl) throw new Error("NanoGPT returned no image data.");

    return `![${prompt.replace(/[[\]]/g, "")}](${dataUrl})`;
  },
};
