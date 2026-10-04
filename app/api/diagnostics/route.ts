import { promises as fs } from "node:fs";
import path from "node:path";
import { getStore, storageDriver } from "@/lib/storage";
import { getMemory } from "@/lib/memory";
import { dataDir } from "@/lib/data-dir";
import { shortPath, type ServerFacts } from "@/lib/diagnostics";
import { computerAccessEnabled } from "@/lib/tools/fs/workspace";
import { isSandbox, selfEditEnabled } from "@/lib/sandbox/paths";
import { authConfigured, openNetwork } from "@/lib/auth/session";
import { deviceMode } from "@/lib/voice/device/detect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

async function count(dir: string, ext?: string): Promise<number> {
  try {
    return (await fs.readdir(dir)).filter((f) => !ext || f.endsWith(ext)).length;
  } catch {
    return 0;
  }
}

/**
 * GET /api/diagnostics — facts about this install for a bug report. A short,
 * fixed list (see lib/diagnostics.ts): versions, counts, which gates are open.
 * No keys, no addresses, no chat text, and the data folder is shortened to its
 * last two parts. Behind the login like everything else.
 */
export async function GET() {
  try {
    const store = getStore();
    let version = "unknown";
    try {
      version = JSON.parse(await fs.readFile(path.join(process.cwd(), "package.json"), "utf8")).version ?? "unknown";
    } catch {
      /* a deployment without package.json beside it */
    }
    let scheduled = 0;
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dataDir(), "schedule.json"), "utf8"));
      scheduled = Array.isArray(parsed) ? parsed.length : Array.isArray(parsed?.tasks) ? parsed.tasks.length : 0;
    } catch {
      /* none */
    }
    const facts: ServerFacts = {
      app: { name: "JARVIS Mark 6", version },
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      dataDir: shortPath(dataDir()),
      storage: storageDriver().slice(0, 20),
      counts: {
        chats: (await store.list()).length,
        trash: (await store.listTrash()).length,
        memory: (await getMemory().list()).length,
        pictures: await count(path.join(dataDir(), "images"), ".png"),
        scheduled,
      },
      flags: {
        computerAccess: computerAccessEnabled(),
        selfEdit: selfEditEnabled(),
        isSandbox: isSandbox(),
        passwordSet: authConfigured(),
        listensOnNetwork: openNetwork(),
        applianceMode: deviceMode(),
      },
    };
    return Response.json(facts, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
