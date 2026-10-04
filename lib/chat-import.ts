import { newId, type Attachment, type Chat, type Message, type ToolRound } from "@/lib/types";
import { normalizeTags } from "@/lib/chat-ops";

/**
 * Turning a file someone hands us into a chat — safely.
 *
 * The file may be a JARVIS export (`{ format: "jarvis-chat", chat }`), the chat
 * object alone, or hand-edited. Nothing in it is trusted: each field is checked
 * and copied across one at a time, so what is stored has exactly the shape the
 * app expects and nothing else rides along. The chat always gets a fresh id —
 * importing can never overwrite a chat you already have — and picture bytes are
 * dropped, as they are from every export.
 */

export const MAX_IMPORT_MESSAGES = 5000;
export const MAX_IMPORT_CONTENT = 200_000;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

const ROLES = ["user", "assistant"] as const;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const time = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback);

function cleanAttachment(raw: unknown): Attachment | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const name = str(a.name, 200);
  if (!name) return null;
  const kind = a.kind === "image" ? "image" : "text";
  return {
    id: str(a.id, 100) ?? newId(),
    kind,
    name,
    mime: str(a.mime, 100) ?? (kind === "image" ? "image/png" : "text/plain"),
    size: typeof a.size === "number" && Number.isFinite(a.size) ? a.size : 0,
    ...(kind === "text" && typeof a.text === "string" ? { text: a.text.slice(0, MAX_IMPORT_CONTENT) } : {}),
  };
}

function cleanRounds(raw: unknown): ToolRound[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rounds: ToolRound[] = [];
  for (const r of raw.slice(0, 50)) {
    if (!r || typeof r !== "object") continue;
    const round = r as Record<string, unknown>;
    const calls = Array.isArray(round.calls)
      ? round.calls.flatMap((c) => {
          const call = c as Record<string, unknown>;
          return call && typeof call.name === "string" ? [{ id: str(call.id, 100) ?? newId(), name: call.name.slice(0, 100), arguments: str(call.arguments, 4000) ?? "{}" }] : [];
        })
      : [];
    const results = Array.isArray(round.results)
      ? round.results.flatMap((x) => {
          const res = x as Record<string, unknown>;
          return res && typeof res.name === "string"
            ? [{ toolCallId: str(res.toolCallId, 100) ?? "", name: res.name.slice(0, 100), content: str(res.content, 4000) ?? "", isError: res.isError === true, ms: typeof res.ms === "number" ? res.ms : 0 }]
            : [];
        })
      : [];
    rounds.push({ round: typeof round.round === "number" ? round.round : rounds.length + 1, calls, results });
  }
  return rounds.length ? rounds : undefined;
}

function cleanMessage(raw: unknown, index: number, now: number): Message | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (!ROLES.includes(m.role as (typeof ROLES)[number])) return null;
  if (typeof m.content !== "string") return null;
  const attachments = Array.isArray(m.attachments) ? m.attachments.slice(0, 20).map(cleanAttachment).filter((a): a is Attachment => a !== null) : [];
  const stats = m.stats && typeof m.stats === "object" ? (m.stats as Record<string, unknown>) : null;
  return {
    id: newId(),
    role: m.role as Message["role"],
    content: m.content.slice(0, MAX_IMPORT_CONTENT),
    createdAt: time(m.createdAt, now + index),
    ...(attachments.length ? { attachments } : {}),
    ...(str(m.provider, 60) ? { provider: str(m.provider, 60) } : {}),
    ...(str(m.model, 120) ? { model: str(m.model, 120) } : {}),
    ...(str(m.fellBackFrom, 60) ? { fellBackFrom: str(m.fellBackFrom, 60) } : {}),
    ...(str(m.error, 1000) ? { error: str(m.error, 1000) } : {}),
    ...(cleanRounds(m.toolRounds) ? { toolRounds: cleanRounds(m.toolRounds) } : {}),
    ...(stats && typeof stats.totalMs === "number" && typeof stats.firstTokenMs === "number" && typeof stats.tokens === "number"
      ? { stats: { totalMs: stats.totalMs, firstTokenMs: stats.firstTokenMs, tokens: stats.tokens } }
      : {}),
    ...(m.starred === true ? { starred: true } : {}),
    ...(m.reaction === "up" || m.reaction === "down" ? { reaction: m.reaction } : {}),
  };
}

export type ImportResult = { ok: true; chat: Chat; skipped: number } | { ok: false; error: string };

export function importChat(raw: unknown, now = Date.now()): ImportResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "That isn't a JARVIS chat file." };
  const top = raw as Record<string, unknown>;
  // An export wraps the chat; a bare chat is accepted too.
  const source = (top.chat && typeof top.chat === "object" ? top.chat : top) as Record<string, unknown>;
  if (!Array.isArray(source.messages)) return { ok: false, error: "That file has no messages in it." };
  if (source.messages.length > MAX_IMPORT_MESSAGES) {
    return { ok: false, error: `That chat has more than ${MAX_IMPORT_MESSAGES.toLocaleString("en-US")} messages.` };
  }

  const messages: Message[] = [];
  let skipped = 0;
  source.messages.forEach((m, i) => {
    const clean = cleanMessage(m, i, now);
    if (clean) messages.push(clean);
    else skipped++;
  });
  if (messages.length === 0) return { ok: false, error: "There were no user or assistant messages to import." };

  const title = str(source.title, 120)?.trim() || "Imported chat";
  const createdAt = time(source.createdAt, messages[0].createdAt);
  const tags = normalizeTags(source.tags);
  return {
    ok: true,
    skipped,
    chat: {
      id: newId(),
      title,
      createdAt,
      updatedAt: now,
      messages,
      ...(str(source.provider, 60) ? { provider: str(source.provider, 60) } : {}),
      ...(str(source.model, 120) ? { model: str(source.model, 120) } : {}),
      ...(tags.length ? { tags } : {}),
      ...(str(source.persona, 8000)?.trim() ? { persona: str(source.persona, 8000) } : {}),
    },
  };
}
