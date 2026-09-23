import { isDue, nextRun } from "./due";
import { scheduleStore } from "./store";
import type { ScheduledTask } from "./types";

/**
 * The thing that makes tasks happen.
 *
 * A module singleton with one interval, like lib/display/state.ts and
 * lib/voice/device/runtime.ts: there is one schedule, and two timers would
 * mean everything firing twice. `start()` is idempotent for the same reason —
 * a dev-server hot reload re-imports this module, and an un-guarded
 * setInterval per reload is how you end up with a reminder read eleven times.
 */

/**
 * How often to look for due tasks.
 *
 * A minute is the resolution the schedules themselves have ("daily at 08:00"
 * is a minute, not a second), so checking faster would only burn wakeups to
 * find nothing. It also means a task fires up to a minute late, which for a
 * reminder read aloud in a room is not a difference anyone notices.
 */
const TICK_MS = 60_000;

export interface RunResult {
  text?: string;
  error?: string;
}

type Runner = (prompt: string, label: string) => Promise<RunResult>;

let timer: NodeJS.Timeout | null = null;
let ticking = false;
let runner: Runner | null = null;

/** Swapped in tests, and lets the clock avoid importing the agent at all. */
export function setRunner(next: Runner | null): void {
  runner = next;
}

export function isRunning(): boolean {
  return timer !== null;
}

export function start(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  // A pending reminder is not a reason to hold the process open.
  timer.unref?.();
}

export function stop(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/**
 * Fire everything that is due.
 *
 * Exported so a test can drive it without waiting a minute, and so a route
 * can force a check immediately after a task is added — otherwise "remind me
 * in one minute" could wait two.
 */
export async function tick(now = Date.now()): Promise<number> {
  // A slow run must not overlap the next tick: two copies of the same task
  // would both see it as due and both fire it.
  if (ticking) return 0;
  ticking = true;

  try {
    const store = scheduleStore();
    const due = (await store.list()).filter((t) => t.enabled && isDue(t.nextRunAt, now));

    for (const task of due) {
      // Written back BEFORE running. The run makes a network call that can
      // take many seconds, and a crash or restart partway through would
      // otherwise leave the task still due and fire it again on boot.
      const following = nextRun(task.schedule, now);
      const updated: ScheduledTask = {
        ...task,
        lastRunAt: now,
        // A one-shot with nothing following is retired rather than deleted,
        // so you can still see that it ran and what it said.
        enabled: following !== null,
        nextRunAt: following ?? task.nextRunAt,
      };
      await store.save(updated);

      const outcome: RunResult = runner
        ? await runner(task.prompt, task.label).catch(
            (err): RunResult => ({ error: (err as Error).message }),
          )
        : { error: "No runner configured." };

      await store.save({
        ...updated,
        lastResult: outcome.text,
        lastError: outcome.error,
      });
    }

    return due.length;
  } finally {
    ticking = false;
  }
}
