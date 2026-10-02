import { NextRequest } from "next/server";
import { checkSandbox } from "@/lib/sandbox/check";
import { isSandbox, selfEditEnabled } from "@/lib/sandbox/paths";
import { restartSandboxServer, sandboxStatus, startSandboxServer, stopSandboxServer } from "@/lib/sandbox/server";
import {
  changesFingerprint,
  ConflictError,
  listChanges,
  listPromotions,
  promote,
  resetSandbox,
  revertSandboxFile,
  undoPromotion,
} from "@/lib/sandbox/sync";
import { audit } from "@/lib/audit";
import { disabled, lastCheck, rememberCheck } from "./state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How a change reaches the code that is actually serving requests. */
function reloadNote(): string {
  return process.env.NODE_ENV === "development"
    ? "JARVIS reloads changed code by itself in development, so it's live now."
    : "JARVIS is running a production build, so restart it to load this: npm run build && npm start.";
}

/** GET /api/sandbox — is it up, what's changed, what's been applied. */
export async function GET() {
  if (isSandbox()) return Response.json({ enabled: false, isSandbox: true });
  if (!selfEditEnabled()) return disabled();

  // Started at boot, but a JARVIS running without instrumentation (or one
  // whose sandbox was stopped by a failed reset) is put right here.
  void startSandboxServer().catch(() => {});

  const [server, changes, history, fingerprint] = await Promise.all([
    sandboxStatus(),
    listChanges(),
    listPromotions(),
    changesFingerprint(),
  ]);
  const check = lastCheck();
  return Response.json({
    enabled: true,
    server,
    changes,
    history: history.slice(0, 20),
    check: check ? { ...check.result, current: check.fingerprint === fingerprint } : null,
  });
}

/** POST /api/sandbox — check, apply, undo, revert a file, reset, restart. */
export async function POST(req: NextRequest) {
  if (!selfEditEnabled()) return disabled();
  // On localhost no password is asked, so another site you visit could post
  // here. A browser sends application/json cross-site only after a preflight
  // this server never approves, so requiring it keeps Apply and Reset yours.
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Expected application/json." }, { status: 415 });
  }
  const body = await req.json().catch(() => ({}));

  try {
    switch (body?.action) {
      case "check": {
        const fingerprint = await changesFingerprint();
        const result = await checkSandbox();
        rememberCheck(result, fingerprint);
        return Response.json({ check: { ...result, current: true } });
      }

      case "apply": {
        const paths = Array.isArray(body.paths) ? body.paths.map(String) : undefined;
        // Checks run against exactly what is about to be applied, unless the
        // user has seen them fail and chosen to go ahead anyway.
        if (body.force !== true) {
          const fingerprint = await changesFingerprint();
          const known = lastCheck();
          const result = known?.fingerprint === fingerprint ? known.result : await checkSandbox();
          rememberCheck(result, fingerprint);
          if (!result.ok) {
            return Response.json(
              { error: "The sandbox failed its checks, so nothing was applied.", check: { ...result, current: true } },
              { status: 409 },
            );
          }
        }
        const promotion = await promote(paths);
        audit("sandbox.apply", promotion.files.map((f) => `${f.status[0]}:${f.path}`).join(", "));
        return Response.json({ promotion, note: reloadNote() });
      }

      case "undo": {
        const promotion = await undoPromotion(String(body.id ?? ""));
        audit("sandbox.undo", promotion.files.map((f) => f.path).join(", "));
        return Response.json({ promotion, note: reloadNote() });
      }

      case "revert": {
        const path = await revertSandboxFile(String(body.path ?? ""));
        return Response.json({ reverted: path });
      }

      case "reset": {
        // Stopped first so it isn't compiling files while they are replaced.
        await stopSandboxServer();
        audit("sandbox.reset");
        try {
          await resetSandbox();
        } finally {
          await startSandboxServer();
        }
        return Response.json({ ok: true });
      }

      case "restart": {
        await restartSandboxServer();
        return Response.json({ ok: true });
      }

      default:
        return Response.json({ error: `Unknown action: ${body?.action}` }, { status: 400 });
    }
  } catch (err) {
    const status = err instanceof ConflictError ? 409 : 400;
    return Response.json(
      { error: (err as Error).message, conflicts: err instanceof ConflictError ? err.paths : undefined },
      { status },
    );
  }
}
