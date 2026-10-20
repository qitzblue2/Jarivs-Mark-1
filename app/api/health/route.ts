export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

/**
 * GET /api/health — is the server up. For uptime monitors and container
 * health checks. Says nothing about keys, chats or configuration: the answer
 * to "is it running" is the only thing a stranger who finds this should get.
 */
export async function GET() {
  return Response.json(
    { ok: true, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
