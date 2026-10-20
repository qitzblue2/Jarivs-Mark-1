import { createTask, describe, ensureClock, scheduleStore, summarise } from "@/lib/schedule";
import type { Schedule } from "@/lib/schedule";
import type { Tool } from "./types";

/**
 * Letting JARVIS arrange to speak later.
 *
 * "Remind me to take the bins out at seven" has to become a stored task
 * without a form, which is the whole reason this is a tool rather than a
 * settings page. The model picks the schedule shape; the shapes are few and
 * narrow enough that it cannot get creative with them.
 */

export const scheduleTaskTool: Tool = {
  name: "schedule_task",
  // Kept terse on purpose: this schema rides on every request the appliance
  // makes, and a paragraph of guidance here is a tax paid five times a turn.
  description:
    "Say something later, unprompted — a reminder, briefing, or recurring check.",
  parameters: {
    type: "object",
    properties: {
      // Phrased as an instruction to itself, because that is what it gets
      // handed when the task fires.
      prompt: { type: "string", description: "What to ask yourself then." },
      when: { type: "string", enum: ["once", "every", "daily"] },
      in_minutes: { type: "number", description: "once: from now" },
      every_minutes: { type: "number", description: "every: interval" },
      at: { type: "string", description: 'daily: "HH:MM" local' },
      label: { type: "string", description: "Short name" },
    },
    required: ["prompt", "when"],
  },

  async handler(args) {
    ensureClock();

    const when = String(args.when ?? "");
    let schedule: Schedule;

    if (when === "once") {
      const minutes = Number(args.in_minutes);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        throw new Error("A one-off needs in_minutes — how long from now.");
      }
      schedule = { kind: "once", at: Date.now() + minutes * 60_000 };
    } else if (when === "every") {
      schedule = { kind: "every", minutes: Number(args.every_minutes) };
    } else if (when === "daily") {
      schedule = { kind: "daily", hhmm: String(args.at ?? "") };
    } else {
      throw new Error('`when` must be "once", "every" or "daily".');
    }

    const { task, error } = await createTask({
      prompt: String(args.prompt ?? ""),
      schedule,
      label: args.label ? String(args.label) : undefined,
    });
    // Returned rather than thrown: the model should read the reason out and
    // offer a correction, not report that a tool broke.
    if (error || !task) return `Couldn't schedule that: ${error}`;

    return `Scheduled "${task.label}" — ${describe(task.schedule)}.`;
  },
};

export const listScheduledTool: Tool = {
  name: "list_scheduled",
  description: "List what is scheduled to happen unprompted.",
  parameters: { type: "object", properties: {} },

  async handler() {
    return summarise(await scheduleStore().list());
  },
};

export const cancelScheduledTool: Tool = {
  name: "cancel_scheduled",
  description: "Cancel a scheduled task by label. Ambiguous matches are refused, not guessed.",
  parameters: {
    type: "object",
    properties: {
      label: { type: "string", description: "Label, or enough to match it" },
    },
    required: ["label"],
  },

  async handler(args) {
    const needle = String(args.label ?? "").trim().toLowerCase();
    if (!needle) throw new Error("Which one?");

    const store = scheduleStore();
    const tasks = await store.list();
    const matches = tasks.filter(
      (t) => t.label.toLowerCase().includes(needle) || t.prompt.toLowerCase().includes(needle),
    );

    if (matches.length === 0) return `Nothing scheduled matches "${needle}".`;
    // Deleting the wrong reminder is silent and unrecoverable, so an ambiguous
    // match asks rather than guesses.
    if (matches.length > 1) {
      return `That matches ${matches.length} tasks: ${matches
        .map((t) => t.label)
        .join("; ")}. Which one?`;
    }

    await store.delete(matches[0].id);
    return `Cancelled "${matches[0].label}".`;
  },
};
