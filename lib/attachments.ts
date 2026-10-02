import type { Attachment } from "@/lib/types";

/** Groq caps a vision request at 3 images. */
export const MAX_IMAGES = 3;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_CHARS = 60_000;

const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|json|jsonc|ya?ml|toml|ini|env|csv|tsv|log|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|bash|zsh|sql|xml|svg|gitignore|dockerfile|makefile)$/i;

export function classify(file: File): "image" | "pdf" | "text" | "unsupported" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.type.startsWith("text/") || TEXT_EXTENSIONS.test(file.name)) return "text";
  // Some editors report no MIME type for plain source files.
  if (!file.type && !/\.[a-z0-9]+$/i.test(file.name)) return "text";
  return "unsupported";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Render attachments into the message text sent upstream.
 *
 * Text content is folded into the prompt; images are handled separately as
 * multimodal content parts, so they only get a placeholder line here.
 */
export function attachmentsToText(attachments: Attachment[]): string {
  const parts: string[] = [];

  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      parts.push(`[Attached image: ${attachment.name}]`);
      continue;
    }
    const body = (attachment.text ?? "").slice(0, MAX_TEXT_CHARS);
    parts.push(
      `--- Attached file: ${attachment.name} (${formatSize(attachment.size)}) ---\n${body}\n--- end of ${attachment.name} ---`,
    );
  }

  return parts.join("\n\n");
}

/** Strip heavy payloads before writing to disk or sending back upstream. */
export function lighten(attachment: Attachment): Attachment {
  if (attachment.kind !== "image") return attachment;
  // Keeping base64 images in every subsequent request would blow the context
  // window and the daily vision quota. They stay on the turn they arrived.
  const { dataUrl, ...rest } = attachment;
  void dataUrl;
  return rest;
}
