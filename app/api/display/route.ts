import { NextRequest } from "next/server";
import { display } from "@/lib/display";
import type { DisplayContent, DisplayView } from "@/lib/display";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await display.status());
}

interface Body {
  action: "show" | "clear" | "power" | "view";
  content?: Record<string, unknown>;
  view?: string;
  on?: boolean;
}

const VIEWS: DisplayView[] = ["normal", "large", "fullscreen"];

/**
 * Take only the shapes we know.
 *
 * Same treatment as `app/api/device/route.ts`: raw JSON reaching something
 * that renders on a wall, or that spawns a process, has to be narrowed at the
 * boundary rather than trusted because TypeScript said so at build time.
 */
function parseContent(raw: Record<string, unknown> | undefined): DisplayContent | null {
  if (!raw) return null;
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  const title = typeof raw.title === "string" ? raw.title : undefined;

  if (raw.kind === "image") {
    const src = typeof raw.src === "string" ? raw.src.trim() : body;
    // Same rule as the tool: this origin or inline data, nothing else.
    if (!src || !(src.startsWith("data:image/") || /^\/[^/\\]/.test(src))) return null;
    return { kind: "image", src, alt: title, title };
  }

  if (!body) return null;
  if (raw.kind === "code") {
    return {
      kind: "code",
      body,
      language: typeof raw.language === "string" ? raw.language : undefined,
      title,
    };
  }
  if (raw.kind === "text") return { kind: "text", body, title };
  return { kind: "markdown", body, title };
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "show": {
        const content = parseContent(body.content);
        if (!content) {
          return Response.json(
            { error: "Nothing showable in that content. Images must be on this server or a data: URI." },
            { status: 400 },
          );
        }
        await display.show(content);
        break;
      }
      case "clear":
        await display.clear();
        break;
      case "view": {
        const view = VIEWS.find((v) => v === body.view);
        if (!view) return Response.json({ error: `Unknown view: ${body.view}` }, { status: 400 });
        await display.setView(view);
        break;
      }
      case "power":
        // A boolean, never a string that could become part of a command.
        await display.power(body.on === true);
        break;
      default:
        return Response.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  return Response.json(await display.status());
}
