/** Core data shapes shared by the server routes and the UI. */

export type Role = "system" | "user" | "assistant" | "tool";

/**
 * A file the user attached to a message.
 *
 * Text-bearing files carry `text`; images carry a `dataUrl`. Added ALONGSIDE
 * Message.content rather than turning content into a parts array, so every
 * chat written by Mark 1-3 still parses.
 */
export interface Attachment {
  id: string;
  kind: "text" | "image";
  name: string;
  mime: string;
  size: number;
  /** Extracted text, for text/code/PDF. */
  text?: string;
  /** base64 data URL, for images. */
  dataUrl?: string;
  /** Set when extraction partially failed, shown in the UI. */
  note?: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  attachments?: Attachment[];
  createdAt: number;
  /** Which provider/model produced this turn. Assistant messages only. */
  provider?: string;
  model?: string;
  /** Set when the primary provider failed and we fell back to another one. */
  fellBackFrom?: string;
  /** Present when generation failed; content may be partial. */
  error?: string;
  /** Tool rounds this assistant turn ran, for the UI trace and for replay. */
  toolRounds?: ToolRound[];
}

/** One request/response cycle of tool use inside a single assistant turn. */
export interface ToolRound {
  round: number;
  calls: { id: string; name: string; arguments: string }[];
  results: { toolCallId: string; name: string; content: string; isError: boolean; ms: number }[];
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  /** Remembers the provider/model this chat was last using. */
  provider?: string;
  model?: string;
}

/** Lightweight row for the sidebar — avoids shipping every message. */
export interface ChatMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** A fenced code block lifted out of a message and into the canvas. */
export interface Artifact {
  id: string;
  lang: string;
  filename: string;
  code: string;
  /** Message this block came from, so the canvas can follow the conversation. */
  messageId: string;
  previewable: boolean;
}

export function chatMeta(chat: Chat): ChatMeta {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat.messages.length,
  };
}

/** Chat ids are used as filenames, so keep them to a strict shape. */
export function isValidChatId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

export function newId(): string {
  // randomUUID exists in Node 19+ and every browser we target.
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
