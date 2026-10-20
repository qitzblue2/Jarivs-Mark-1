import { classify, MAX_FILE_BYTES, MAX_TEXT_CHARS } from "./attachments";
import { newId, type Attachment } from "./types";

/**
 * Turn a browser File into an Attachment.
 *
 * Text is read in the browser; PDFs go to /api/extract because the parser is
 * too heavy to ship to the client. Images become data URLs so they can be
 * sent as multimodal parts.
 */
export async function fileToAttachment(file: File): Promise<Attachment> {
  const base = { id: newId(), name: file.name, mime: file.type, size: file.size };

  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is too large (8MB limit).`);
  }

  const kind = classify(file);

  if (kind === "image") {
    return { ...base, kind: "image", dataUrl: await readAsDataUrl(file) };
  }

  if (kind === "pdf") {
    const form = new FormData();
    form.append("file", file, file.name);
    const res = await fetch("/api/extract", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? `Could not read ${file.name}.`);
    return { ...base, kind: "text", text: data.text ?? "", note: data.note };
  }

  if (kind === "text") {
    const text = await file.text();
    return {
      ...base,
      kind: "text",
      text: text.slice(0, MAX_TEXT_CHARS),
      note: text.length > MAX_TEXT_CHARS ? "Truncated to fit the context window." : undefined,
    };
  }

  throw new Error(`${file.name} isn't a supported type (images, PDFs and text files).`);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}
