import { cancelJob, getJob } from "@/lib/videos/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/videos/jobs/:id — where a video in the making has got to. */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "No such job (it may be finished and forgotten, or the server restarted)." }, { status: 404 });
  return Response.json({ job });
}

/** DELETE /api/videos/jobs/:id — stop waiting. The provider may still charge for work already started. */
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  return cancelJob(id) ? Response.json({ ok: true }) : Response.json({ error: "Nothing running with that id." }, { status: 404 });
}
