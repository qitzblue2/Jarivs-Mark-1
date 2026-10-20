import type { Schedule } from "./types";

/**
 * When a schedule next comes round.
 *
 * Pure and given an explicit `now`, because every interesting case here is a
 * clock edge — midnight, the minute a daily task fires, a task restored from
 * disk hours late — and none of those are testable against the real clock.
 */

/** Parses "HH:MM". Returns null for anything that isn't a real time of day. */
export function parseHhmm(hhmm: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * The next time this schedule is due, strictly after `now`.
 *
 * Returns null when it will never fire again — a one-shot that has already
 * been. The caller uses that to retire the task rather than leaving it in the
 * list looking armed.
 */
export function nextRun(schedule: Schedule, now: number): number | null {
  switch (schedule.kind) {
    case "once":
      return schedule.at > now ? schedule.at : null;

    case "every": {
      // A zero or negative interval would be a tight loop against a paid API,
      // so it is clamped rather than trusted; the tool validates too.
      const minutes = Math.max(1, Math.floor(schedule.minutes));
      return now + minutes * 60_000;
    }

    case "daily": {
      const time = parseHhmm(schedule.hhmm);
      if (!time) return null;

      // Built from local date parts rather than by adding 24h to a previous
      // run: adding a fixed day drifts across a daylight-saving change, and
      // "08:00" must stay 08:00 on the clock in the room.
      const next = new Date(now);
      next.setHours(time.hours, time.minutes, 0, 0);
      if (next.getTime() <= now) next.setDate(next.getDate() + 1);
      return next.getTime();
    }
  }
}

/** Whether a task with this next-run time should fire now. */
export function isDue(nextRunAt: number, now: number): boolean {
  return nextRunAt <= now;
}

/** Human-readable, for the UI and for JARVIS to read back aloud. */
export function describe(schedule: Schedule): string {
  switch (schedule.kind) {
    case "once":
      return `once, at ${new Date(schedule.at).toLocaleString()}`;
    case "every": {
      const minutes = Math.max(1, Math.floor(schedule.minutes));
      if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return `every ${hours} hour${hours === 1 ? "" : "s"}`;
      }
      return `every ${minutes} minute${minutes === 1 ? "" : "s"}`;
    }
    case "daily":
      return `daily at ${schedule.hhmm}`;
  }
}
