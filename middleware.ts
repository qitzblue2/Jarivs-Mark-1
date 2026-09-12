import { NextRequest, NextResponse } from "next/server";
import { authConfigured, openNetwork, requiresAuth, SESSION_COOKIE, verifyToken } from "@/lib/auth/session";

/**
 * Gate for every route, including the API.
 *
 * Fail closed: a request that did not come from this machine, when no
 * password is configured, is refused rather than served. Defaulting to open
 * is how a filesystem ends up on the internet by accident — and with
 * computer access enabled, that would be a remote shell.
 */
export const config = {
  // Static assets and the login page itself stay reachable, or you could
  // never log in and the ONNX models would 401.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|api/auth|models/|ort/|worklets/).*)"],
};

export async function middleware(req: NextRequest) {
  if (!requiresAuth(req.headers.get("host"))) return NextResponse.next();

  if (!authConfigured()) {
    return NextResponse.json(
      {
        error: openNetwork()
          ? "This JARVIS is listening on the network but has no password set. " +
            "Set JARVIS_PASSWORD in .env.local and restart, or use `npm run dev` " +
            "to listen on localhost only. Refusing to serve."
          : "This request was addressed to a non-local hostname and no password " +
            "is set. Set JARVIS_PASSWORD in .env.local and restart. Refusing to serve.",
      },
      { status: 503 },
    );
  }

  if (await verifyToken(req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  // APIs get a status; navigations get the login page.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const login = new URL("/login", req.url);
  login.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(login);
}
