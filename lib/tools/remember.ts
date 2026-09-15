import { getMemory, rank } from "@/lib/memory";
import { newId } from "@/lib/types";
import type { Tool } from "./types";

export const rememberTool: Tool = {
  name: "remember",
  description:
    "Store a durable fact so it survives into later conversations: preferences, " +
    "names, decisions, ongoing work. Never store passwords or keys. Tag " +
    "'always' only for facts needed in every conversation.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "One short standalone sentence." },
      tags: { type: "array", items: { type: "string" }, description: 'e.g. ["preference"].' },
    },
    required: ["text"],
  },

  async handler(args) {
    const text = String(args.text ?? "").trim();
    if (!text) throw new Error("Nothing to remember.");
    if (text.length > 1000) throw new Error("That's too long for one memory — split it up.");

    const tags = Array.isArray(args.tags)
      ? args.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8)
      : [];

    const store = getMemory();
    const existing = await store.list();

    // Don't accumulate near-duplicates every time a topic comes up again.
    const duplicate = existing.find(
      (e) => e.text.toLowerCase().trim() === text.toLowerCase(),
    );
    if (duplicate) {
      await store.save({ ...duplicate, tags: [...new Set([...duplicate.tags, ...tags])], updatedAt: Date.now() });
      return `Already remembered — refreshed it: "${text}"`;
    }

    const now = Date.now();
    await store.save({ id: newId(), text, tags, createdAt: now, updatedAt: now });
    return `Remembered: "${text}"${tags.length ? ` [${tags.join(", ")}]` : ""}`;
  },
};

export const recallTool: Tool = {
  name: "recall",
  description:
    "Search stored memories. Relevant ones are already in your context, so use " +
    "this only to dig for something specific, or when asked what you remember.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Empty lists everything." },
    },
  },

  async handler(args) {
    const query = String(args.query ?? "").trim();
    const entries = await getMemory().list();

    if (entries.length === 0) return "Nothing stored in memory yet.";

    const matches = query ? rank(entries, query, 15) : entries.slice(-20).reverse();
    if (matches.length === 0) return `No memories match "${query}".`;

    return matches
      .map((e) => `- ${e.text}${e.tags.length ? ` [${e.tags.join(", ")}]` : ""} (id ${e.id.slice(0, 8)})`)
      .join("\n");
  },
};

export const forgetTool: Tool = {
  name: "forget",
  description:
    "Delete a stored memory — when asked to forget something, or when a fact " +
    "you hold is now wrong. Get the id from recall.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Id, or its first 8 characters." },
    },
    required: ["id"],
  },

  async handler(args) {
    const needle = String(args.id ?? "").trim();
    if (!needle) throw new Error("No id given.");

    const store = getMemory();
    const entries = await store.list();
    // recall() shows shortened ids, so accept a prefix.
    const match = entries.find((e) => e.id === needle || e.id.startsWith(needle));
    if (!match) throw new Error(`No memory with id "${needle}".`);

    await store.delete(match.id);
    return `Forgotten: "${match.text}"`;
  },
};
