/**
 * Things JARVIS does without being asked.
 *
 * Phase 3's whole point is that the box in your room can speak first. Until
 * now every word it said was a reply; a reminder, a morning briefing or a
 * watcher that notices something changed all need it to start the
 * conversation itself.
 */

/**
 * When a task is due.
 *
 * Three shapes rather than a cron expression, on purpose. Cron is a parser, a
 * grammar and a class of bugs, and it buys nothing here: a reminder is
 * "once", a watcher is "every N minutes", and a briefing is "daily at 08:00".
 * Anything genuinely cron-shaped is better expressed as several tasks.
 */
export type Schedule =
  | { kind: "once"; at: number }
  | { kind: "every"; minutes: number }
  /** Local time on the machine running JARVIS, as "HH:MM". */
  | { kind: "daily"; hhmm: string };

export interface ScheduledTask {
  id: string;
  /**
   * What to ask JARVIS when it fires — a prompt, not a canned string, so a
   * task can search, check a page, or read the calendar before speaking.
   */
  prompt: string;
  /** Short label for the UI, derived from the prompt when not given. */
  label: string;
  schedule: Schedule;
  /** Paused tasks stay in the list and never fire. */
  enabled: boolean;
  createdAt: number;
  /** When it last fired, and what it said — so the UI can show it worked. */
  lastRunAt?: number;
  lastResult?: string;
  lastError?: string;
  /**
   * Computed and stored rather than derived on read.
   *
   * A "daily" task's next due time depends on when it last ran, and working
   * that out from the wall clock alone gets it wrong across restarts and
   * daylight-saving changes.
   */
  nextRunAt: number;
}

export interface ScheduleStore {
  list(): Promise<ScheduledTask[]>;
  save(task: ScheduledTask): Promise<void>;
  delete(id: string): Promise<void>;
}
