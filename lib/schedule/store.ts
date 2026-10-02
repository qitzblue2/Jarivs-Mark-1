import { promises as fs } from "node:fs";
import path from "node:path";
import { dataPath } from "@/lib/data-dir";
import type { ScheduledTask, ScheduleStore } from "./types";

const file = () => dataPath("schedule.json");

/**
 * One JSON file you can open and read.
 *
 * Same shape and same reasoning as lib/memory/fs-store.ts: a list of things
 * JARVIS will do on its own is exactly the list you want to be able to read,
 * hand-edit and delete without asking the app's permission. Writes go via a
 * temp file and a rename so a crash mid-write cannot leave a half-written
 * schedule that fails to parse and silently loses every task.
 */
export class FsScheduleStore implements ScheduleStore {
  async list(): Promise<ScheduledTask[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(file(), "utf8"));
      return Array.isArray(parsed) ? (parsed as ScheduledTask[]) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      // A hand-edit that broke the JSON shouldn't stop JARVIS answering.
      return [];
    }
  }

  private async writeAll(tasks: ScheduledTask[]): Promise<void> {
    await fs.mkdir(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(tasks, null, 2), "utf8");
    await fs.rename(tmp, file());
  }

  async save(task: ScheduledTask): Promise<void> {
    const tasks = await this.list();
    const index = tasks.findIndex((t) => t.id === task.id);
    if (index === -1) tasks.push(task);
    else tasks[index] = task;
    await this.writeAll(tasks);
  }

  async delete(id: string): Promise<void> {
    const tasks = await this.list();
    await this.writeAll(tasks.filter((t) => t.id !== id));
  }
}

let store: ScheduleStore = new FsScheduleStore();

export function scheduleStore(): ScheduleStore {
  return store;
}

/** Swapped in tests so they never touch the real data directory. */
export function setScheduleStore(next: ScheduleStore): void {
  store = next;
}
