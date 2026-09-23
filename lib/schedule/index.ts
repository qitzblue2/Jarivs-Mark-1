import { newId } from "@/lib/types";
import { describe, nextRun, parseHhmm } from "./due";
import { setRunner, start, tick } from "./clock";
import { runScheduled } from "./run";
import { scheduleStore } from "./store";
import type { Schedule, ScheduledTask } from "./types";

export { describe, nextRun, parseHhmm } from "./due";
export { isRunning, setRunner, start, stop, tick } from "./clock";
export { scheduleStore, setScheduleStore } from "./store";
export type { Schedule, ScheduledTask } from "./types";

/**
 * Wire the clock to the real runner and start it.
 *
 * Kept out of clock.ts so the clock never imports the agent: that import
 * chain reaches the provider registry, the tool registry and transformers.js,
 * which is a lot to drag into a unit test that only wants to check whether a
 * task fires twice.
 *
 * Idempotent, and called from the schedule route rather than at module load,
 * so a build that only renders pages never starts a timer.
 */
export function ensureClock(): void {
  setRunner((prompt, label) => runScheduled(prompt, label));
  start();
}

/** Trim a prompt down to something that fits a list row. */
function deriveLabel(prompt: string): string {
  const line = prompt.trim().split("\n")[0];
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

export interface NewTask {
  prompt: string;
  schedule: Schedule;
  label?: string;
}

/**
 * Validate and store a task, returning it or the reason it was refused.
 *
 * Refusals are messages rather than thrown errors because both callers — the
 * API route and the tool JARVIS calls — want to hand the text straight back
 * to the user.
 */
export async function createTask(input: NewTask): Promise<{ task?: ScheduledTask; error?: string }> {
  const prompt = input.prompt?.trim();
  if (!prompt) return { error: "A scheduled task needs something to ask." };
  if (prompt.length > 2000) return { error: "That prompt is too long." };

  const now = Date.now();
  const schedule = input.schedule;

  if (schedule.kind === "daily" && !parseHhmm(schedule.hhmm)) {
    return { error: `"${schedule.hhmm}" isn't a time of day. Use HH:MM, like 08:00.` };
  }
  if (schedule.kind === "every" && (!Number.isFinite(schedule.minutes) || schedule.minutes < 1)) {
    // One minute is the clock's own resolution; anything less is a busy loop
    // against a metered API rather than a schedule.
    return { error: "The shortest repeat is every 1 minute." };
  }
  if (schedule.kind === "once" && schedule.at <= now) {
    return { error: "That time has already passed." };
  }

  const firstRun = nextRun(schedule, now);
  if (firstRun === null) return { error: "That schedule would never run." };

  const task: ScheduledTask = {
    id: newId(),
    prompt,
    label: input.label?.trim() || deriveLabel(prompt),
    schedule,
    enabled: true,
    createdAt: now,
    nextRunAt: firstRun,
  };

  await scheduleStore().save(task);
  // "Remind me in a minute" should not have to wait for the next tick.
  void tick();

  return { task };
}

/** One line per task, for JARVIS to read back. */
export function summarise(tasks: ScheduledTask[]): string {
  if (tasks.length === 0) return "Nothing is scheduled.";
  return tasks
    .map((t) => `${t.label} — ${describe(t.schedule)}${t.enabled ? "" : " (paused)"}`)
    .join("\n");
}
