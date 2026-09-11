import { BlockedUrlError, guardedFetch, readCapped } from "./net-guard";
import { htmlToText } from "./html-text";
import type { Tool } from "./types";

export const fetchUrlTool: Tool = {
  name: "fetch_url",
  description:
    "Fetch a web page and return its readable text. Use after web_search to " +
    "read a result properly, or when the user gives you a URL. Only public " +
    "http(s) addresses can be reached.",
  dangerous: true,
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The full http(s) URL to fetch." },
    },
    required: ["url"],
  },

  async handler(args, ctx) {
    const raw = String(args.url ?? "").trim();
    if (!raw) throw new Error("No URL given.");

    let response: Response;
    let finalUrl: string;
    try {
      ({ response, finalUrl } = await guardedFetch(raw, { signal: ctx.signal }));
    } catch (err) {
      if (err instanceof BlockedUrlError) {
        // Tell the model plainly so it stops rather than retrying variants.
        throw new Error(`${err.message}. Only public web addresses can be fetched.`);
      }
      throw err;
    }

    if (!response.ok) {
      throw new Error(`${finalUrl} returned HTTP ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await readCapped(response);

    if (/json/i.test(contentType)) return `${finalUrl}\n\n${body}`;

    if (!/html|xml|text/i.test(contentType)) {
      throw new Error(`${finalUrl} is ${contentType || "an unknown type"}, not readable text.`);
    }

    const { title, text } = htmlToText(body);
    if (!text) throw new Error(`No readable text found at ${finalUrl}.`);

    return `${title ? `${title}\n` : ""}${finalUrl}\n\n${text}`;
  },
};
