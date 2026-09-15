import { promises as fs } from "node:fs";
import path from "node:path";
import type { MemoryEntry, MemoryStore } from "./types";

const FILE = path.join(process.cwd(), "data", "memory.json");

/**
 * One JSON file you can open and read.
 *
 * Deliberately a single readable file rather than a database: memory you
 * cannot inspect or hand-edit is memory you cannot trust.
 */
export class FsMemoryStore implements MemoryStore {
  async list(): Promise<MemoryEntry[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(FILE, "utf8"));
      return Array.isArray(parsed) ? (parsed as MemoryEntry[]) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      // A hand-edit that broke the JSON shouldn't take the whole app down.
      return [];
    }
  }

  private async writeAll(entries: MemoryEntry[]): Promise<void> {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(entries, null, 2), "utf8");
    await fs.rename(tmp, FILE);
  }

  async save(entry: MemoryEntry): Promise<void> {
    const entries = await this.list();
    const index = entries.findIndex((e) => e.id === entry.id);
    if (index === -1) entries.push(entry);
    else entries[index] = entry;
    await this.writeAll(entries);
  }

  async delete(id: string): Promise<void> {
    await this.writeAll((await this.list()).filter((e) => e.id !== id));
  }

  async clear(): Promise<void> {
    await this.writeAll([]);
  }
}
