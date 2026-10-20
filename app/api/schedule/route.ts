import { NextRequest } from "next/server";
import { createTask, describe, ensureClock, scheduleStore } from "@/lib/schedule";
import type { Schedule } from "@/lib/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything JARVIS will do without being asked.
 *
 * `ensureClock()` on every handler rather than at module load: importing a
 * route file happens during a build too, and a build has no business starting
 * a timer that fires reminders. Calling it here means the clock starts the
 * first time anything actually looks at the schedule, and is idempotent
 * after that.
 */

/** GET — the list, soonest first. */
export async function GET() {
  try {
    ensureClock();
    const tasks = await scheduleStore().list();
    return Response.json({
      tasks: tasks
        .slice()
        .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.nextRunAt - b.nextRunAt)
        .map((t) => ({ ...t, when: describe(t.schedule) })),
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Reads a schedule out of a request body, rejecting anything malformed. */
function parseSchedule(body: Record<string, unknown>): Schedule | null {
  const kind = String(body?.kind ?? "");
  if (kind === "once") {
    const at = Number(body?.at);
    return Number.isFinite(at) ? { kind: "once", at } : null;
  }
  if (kind === "every") {
    const minutes = Number(body?.minutes);
    return Number.isFinite(minutes) ? { kind: "every", minutes } : null;
  }
  if (kind === "daily") {
    const hhmm = String(body?.hhmm ?? "");
    return hhmm ? { kind: "daily", hhmm } : null;
  }
  return null;
}

/** POST — schedule something. */
export async function POST(req: NextRequest) {
  try {
    ensureClock();
    const body = await req.json().catch(() => ({}));

    const schedule = parseSchedule(body);
    if (!schedule) {
      return Response.json(
        { error: 'Needs kind "once" (at), "every" (minutes) or "daily" (hhmm).' },
        { status: 400 },
      );
    }

    // createTask does the validating and returns the reason as text, because
    // both callers — this route and the tool JARVIS calls — want to show it.
    const { task, error } = await createTask({
      prompt: String(body?.prompt ?? ""),
      schedule,
      label: body?.label ? String(body.label) : undefined,
    });
    if (error || !task) return Response.json({ error }, { status: 400 });

    return Response.json({ task: { ...task, when: describe(task.schedule) } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** PATCH — pause or resume one. */
export async function PATCH(req: NextRequest) {
  try {
    ensureClock();
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id ?? "");
    if (!id) return Response.json({ error: "No task id." }, { status: 400 });

    const store = scheduleStore();
    const task = (await store.list()).find((t) => t.id === id);
    if (!task) return Response.json({ error: "No such task." }, { status: 404 });

    await store.save({ ...task, enabled: Boolean(body?.enabled) });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** DELETE — cancel one for good. */
export async function DELETE(req: NextRequest) {
  try {
    ensureClock();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return Response.json({ error: "No task id." }, { status: 400 });

    await scheduleStore().delete(id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
