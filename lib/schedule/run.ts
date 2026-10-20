import { runAgentTurn } from "@/lib/agent";
import { listModels } from "@/lib/providers/openai-compat";
import {
  defaultProviderId,
  fallbackOrder,
  preferredModel,
  resolveKey,
} from "@/lib/providers/registry";
import { display, displayConnected } from "@/lib/display";
import { deviceSession } from "@/lib/voice/device/runtime";
import { splitReasoning } from "@/lib/reasoning";

/**
 * Running a task nobody is watching.
 *
 * The important difference from a chat turn: there is no browser. Keys
 * supplied through Settings live in one browser's localStorage and are sent
 * with each request, so a background task cannot borrow them — it needs a key
 * in the server's environment. That is a real constraint rather than an
 * oversight, and `runScheduled` says so plainly instead of failing with a
 * puzzling 401 at three in the morning.
 */

export interface RunOutcome {
  text?: string;
  error?: string;
}

/** The first provider with a key the SERVER holds, and a model it serves. */
async function serverProvider(): Promise<{ id: string; key: string; model: string } | null> {
  // No client keys and no client endpoints: a background run has neither.
  for (const id of fallbackOrder(defaultProviderId())) {
    const key = resolveKey(id);
    if (key === null) continue;

    const pinned = preferredModel(id);
    if (pinned) return { id, key, model: pinned };

    try {
      const models = await listModels(id, key);
      if (models.length > 0) return { id, key, model: models[0].id };
    } catch {
      // Unreachable or rate-limited right now — try the next one, exactly as
      // a chat turn would.
    }
  }
  return null;
}

/**
 * Ask JARVIS the task's prompt and put the answer where it will be noticed.
 *
 * Delivery is deliberately best-effort and independent: a projector that is
 * off must not stop the Pi speaking, and a device that isn't running must not
 * stop the screen updating. The text is returned either way so it is recorded
 * against the task even when nothing in the room was listening.
 */
export async function runScheduled(
  prompt: string,
  label: string,
  signal?: AbortSignal,
): Promise<RunOutcome> {
  const provider = await serverProvider();
  if (!provider) {
    return {
      error:
        "No API key in the server's environment. A scheduled task runs with no " +
        "browser open, so a key pasted into Settings can't be used — put one in " +
        ".env.local instead.",
    };
  }

  let text = "";
  try {
    const turn = runAgentTurn(
      [
        {
          role: "system",
          content:
            "You are speaking without being asked, because a scheduled task " +
            "came due. Lead with the point in one or two sentences — this is " +
            "read aloud in a room, not scrolled. No preamble about being a " +
            "reminder.",
        },
        { role: "user", content: prompt },
      ],
      { providerId: provider.id, key: provider.key, model: provider.model, signal },
    );

    for await (const event of turn) {
      if (event.type === "token") text += event.value;
    }
  } catch (err) {
    return { error: (err as Error).message };
  }

  // A thinking model's working-out must not be read aloud or put on a wall.
  const { answer } = splitReasoning(text);
  const spoken = answer.trim() || text.trim();
  if (!spoken) return { error: "The model returned nothing." };

  deliver(spoken, label);
  return { text: spoken };
}

/** Put it on the screen and say it, wherever those exist. */
function deliver(text: string, label: string): void {
  if (displayConnected()) {
    void display
      .show({ kind: "markdown", body: text, title: label })
      .catch(() => {
        /* a screen that refused is not a reason to stay silent */
      });
  }

  deviceSession()?.announce(text);
}
