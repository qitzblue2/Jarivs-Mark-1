import { getMemory, rank } from "@/lib/memory";
import { getStore } from "@/lib/storage";
import { rankChats } from "@/lib/chat-search";
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
    "Search stored memories and past conversations. Relevant memories are " +
    "already in your context; use this to dig, or when asked what was said before.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Empty lists everything." },
    },
  },

  async handler(args) {
    const query = String(args.query ?? "").trim();
    const entries = await getMemory().list();

    const matches = query ? rank(entries, query, 15) : entries.slice(-20).reverse();
    const memories = matches.length
      ? matches
          .map((e) => `- ${e.text}${e.tags.length ? ` [${e.tags.join(", ")}]` : ""} (id ${e.id.slice(0, 8)})`)
          .join("\n")
      : entries.length === 0
        ? "Nothing stored in memory yet."
        : `No memories match "${query}".`;

    // Past conversations only for a query: "list everything" means memories,
    // and dumping every chat title would be a page of noise.
    if (!query) return memories;
    const talk = await pastConversations(query);
    return talk ? `Memories:\n${memories}\n\nPast conversations:\n${talk}` : memories;
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

/**
 * What was said before, found in the chat files themselves.
 *
 * Memories hold what someone decided was worth keeping; conversations hold
 * everything else. "What was that recipe you gave me last week" is rarely a
 * memory, but it is always in a chat. Reads every chat, which for a personal
 * install is a few hundred small files, and never fails the recall: memories
 * are the part that has to work.
 */
async function pastConversations(query: string): Promise<string> {
  try {
    const store = getStore();
    const metas = await store.list();
    const chats = (await Promise.all(metas.slice(0, 500).map((m) => store.get(m.id)))).filter((c) => c !== null);
    const hits = rankChats(chats, query, 5);
    return hits
      .map((h) => {
        const when = new Date(h.updatedAt).toISOString().slice(0, 10);
        return `- "${h.title}" (${when})${h.snippet ? `: ${h.snippet}` : ""}`;
      })
      .join("\n");
  } catch {
    return "";
  }
}
