import { CHAT_COLORS, newId, type Chat, type ChatColor, type Message } from "@/lib/types";

/**
 * Changing a chat: the rules, kept out of the routes so they can be tested.
 */

export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 24;
export const MAX_PERSONA = 20_000;
export const MAX_NOTES = 20_000;

/**
 * One tag, in its canonical form: lowercase, words joined with hyphens, only
 * letters, digits, hyphen and underscore. Search treats `tag:foo` as one
 * token, so a tag with a space or colon in it could never be asked for.
 */
export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tag = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TAG_LENGTH);
  return tag || null;
}

export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    const tag = normalizeTag(item);
    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

/** Every tag in use, most common first, for the filter row. */
export function tagCounts(chats: { tags?: string[]; archived?: boolean }[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const chat of chats) for (const tag of chat.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export type PatchResult =
  | { ok: true; chat: Chat }
  | { ok: false; error: string };

/**
 * Apply a PATCH body to a chat.
 *
 * Only saving `messages` counts as activity and moves the chat up the list
 * (unless the save says `quiet: true`). Pinning,
 * tagging, archiving, renaming, changing the model or setting its instructions
 * are tidying: doing them shouldn't reshuffle what you were last working on.
 *
 * Each field is checked rather than trusted — a PATCH body is whatever the
 * client sent — and a field of the wrong type is an error, not a silent skip.
 */
export function applyChatPatch(existing: Chat, body: unknown, now = Date.now()): PatchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Expected a JSON object." };
  const patch = body as Record<string, unknown>;
  const next: Chat = { ...existing };

  if ("title" in patch) {
    if (typeof patch.title !== "string") return { ok: false, error: "title must be text." };
    const title = patch.title.trim().slice(0, 200);
    if (title) next.title = title;
  }
  if ("messages" in patch) {
    if (!Array.isArray(patch.messages)) return { ok: false, error: "messages must be a list." };
    next.messages = patch.messages as Message[];
    // `quiet` is for edits to the messages that aren't conversation — starring
    // one — which shouldn't move an old chat to the top of the list.
    if (patch.quiet !== true) next.updatedAt = now;
  }
  if ("provider" in patch && typeof patch.provider === "string") next.provider = patch.provider;
  if ("model" in patch && typeof patch.model === "string") next.model = patch.model;

  if ("pinned" in patch) {
    if (typeof patch.pinned !== "boolean") return { ok: false, error: "pinned must be true or false." };
    next.pinned = patch.pinned || undefined;
  }
  if ("archived" in patch) {
    if (typeof patch.archived !== "boolean") return { ok: false, error: "archived must be true or false." };
    next.archived = patch.archived || undefined;
  }
  if ("tags" in patch) {
    if (!Array.isArray(patch.tags)) return { ok: false, error: "tags must be a list." };
    const tags = normalizeTags(patch.tags);
    next.tags = tags.length ? tags : undefined;
  }
  if ("notes" in patch) {
    if (patch.notes !== null && typeof patch.notes !== "string") return { ok: false, error: "notes must be text, or null to clear them." };
    const notes = typeof patch.notes === "string" ? patch.notes.slice(0, MAX_NOTES) : "";
    next.notes = notes.trim() ? notes : undefined;
  }
  if ("color" in patch) {
    if (patch.color !== null && !CHAT_COLORS.includes(patch.color as ChatColor)) return { ok: false, error: `color must be one of ${CHAT_COLORS.join(", ")}, or null.` };
    next.color = (patch.color as ChatColor | null) ?? undefined;
  }
  if ("persona" in patch) {
    if (patch.persona !== null && typeof patch.persona !== "string") return { ok: false, error: "persona must be text, or null to clear it." };
    const persona = typeof patch.persona === "string" ? patch.persona.trim().slice(0, MAX_PERSONA) : "";
    next.persona = persona || undefined;
  }

  return { ok: true, chat: next };
}

/**
 * A new chat from an old one.
 *
 * With a `messageId` it is a branch: everything up to and including that
 * message, so a different question can be asked from there and the original
 * left as it was. Without one it is a duplicate of the whole conversation.
 *
 * The copy starts fresh in the ways that matter — not pinned, not archived —
 * and remembers where it came from. Attachments' image bytes were already
 * dropped when the original was saved, so nothing heavy is copied.
 */
export function branchChat(source: Chat, messageId: string | undefined, now = Date.now()): Chat | null {
  let messages = source.messages;
  if (messageId !== undefined) {
    const at = messages.findIndex((m) => m.id === messageId);
    if (at === -1) return null;
    messages = messages.slice(0, at + 1);
  }
  const suffix = messageId === undefined ? "copy" : "branch";
  return {
    id: newId(),
    title: `${source.title} (${suffix})`.slice(0, 200),
    createdAt: now,
    updatedAt: now,
    messages: structuredClone(messages),
    provider: source.provider,
    model: source.model,
    ...(source.tags?.length ? { tags: [...source.tags] } : {}),
    ...(source.persona ? { persona: source.persona } : {}),
    ...(source.color ? { color: source.color } : {}),
    branchedFrom: { chatId: source.id, ...(messageId !== undefined ? { messageId } : {}) },
  };
}
