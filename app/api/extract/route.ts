import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CHARS = 60_000;

/**
 * PDF text extraction.
 *
 * Uses unpdf (a serverless-safe pdfjs build, ~2MB) rather than pdf-parse
 * (21MB) or pdfjs-dist (35MB) — on a free tier that size difference is the
 * whole decision. Runs server-side so the parser stays off the main thread
 * of the browser.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return Response.json({ error: "No file supplied." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "File too large (8MB limit)." }, { status: 413 });
  }

  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const buffer = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buffer);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });

    const merged = (Array.isArray(text) ? text.join("\n\n") : text).trim();
    if (!merged) {
      return Response.json({
        text: "",
        note: "No selectable text — this PDF is probably a scan. It would need OCR.",
      });
    }

    const clipped = merged.length > MAX_CHARS;
    return Response.json({
      text: clipped ? merged.slice(0, MAX_CHARS) : merged,
      pages: totalPages,
      note: clipped ? `Truncated to the first ${MAX_CHARS} characters of ${totalPages} pages.` : undefined,
    });
  } catch (err) {
    return Response.json(
      { error: `Could not read that PDF: ${(err as Error).message}` },
      { status: 422 },
    );
  }
}
