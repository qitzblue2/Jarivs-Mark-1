import { NextRequest } from "next/server";
import {
  authConfigured,
  cookieOptions,
  createToken,
  passwordMatches,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tell the login page whether a password is even configured. */
export async function GET() {
  return Response.json({ configured: authConfigured() });
}

/** Exchange the password for a signed session cookie. */
export async function POST(req: NextRequest) {
  if (!authConfigured()) {
    return Response.json(
      { error: "No password is configured. Set JARVIS_PASSWORD in .env.local." },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const submitted = String(body?.password ?? "");

  if (!passwordMatches(submitted)) {
    // A uniform delay blunts trivial timing and rate probing.
    await new Promise((r) => setTimeout(r, 400));
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }

  const secure = req.nextUrl.protocol === "https:";
  const response = Response.json({ ok: true });
  const options = cookieOptions(secure);

  response.headers.append(
    "Set-Cookie",
    [
      `${options.name}=${await createToken()}`,
      `Path=${options.path}`,
      `Max-Age=${options.maxAge}`,
      "HttpOnly",
      `SameSite=${options.sameSite === "lax" ? "Lax" : "Strict"}`,
      options.secure ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );

  return response;
}

/** Log out. */
export async function DELETE() {
  const response = Response.json({ ok: true });
  response.headers.append(
    "Set-Cookie",
    "jarvis_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
  );
  return response;
}
