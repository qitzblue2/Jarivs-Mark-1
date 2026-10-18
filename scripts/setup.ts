/**
 * npm run setup — asks for your API keys and writes .env.local.
 * Never overwrites a value you already have unless you type a new one, never
 * prints a key back, and leaves every other line of the file alone.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { mergeEnv } from "../lib/doctor";

const file = path.join(process.cwd(), ".env.local");
const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
const has = (key: string) => new RegExp(`^${key}=.+$`, "m").test(existing);

const ASK: { key: string; label: string; where: string }[] = [
  { key: "GROQ_API_KEY", label: "Groq (free, fastest to start)", where: "https://console.groq.com/keys" },
  { key: "CEREBRAS_API_KEY", label: "Cerebras (free, a second one to roll over to)", where: "https://cloud.cerebras.ai" },
  { key: "GEMINI_API_KEY", label: "Gemini (free, the most headroom)", where: "https://aistudio.google.com/apikey" },
  { key: "NANOGPT_API_KEY", label: "NanoGPT (paid, optional — better pictures, 200+ models)", where: "https://nano-gpt.com/" },
  { key: "JARVIS_PASSWORD", label: "A password (only needed to reach it from your phone or another device)", where: "choose one" },
];

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Lines are queued as they arrive, so answers pasted or piped in one go are
  // not lost between questions.
  const waiting: ((line: string) => void)[] = [];
  const queued: string[] = [];
  let ended = false;
  rl.on("line", (line) => (waiting.length ? waiting.shift()!(line) : queued.push(line)));
  rl.on("close", () => {
    ended = true;
    while (waiting.length) waiting.shift()!("");
  });
  const ask = (q: string): Promise<string> => {
    process.stdout.write(q);
    if (queued.length) return Promise.resolve(queued.shift()!);
    if (ended) return Promise.resolve("");
    return new Promise((resolve) => waiting.push(resolve));
  };
  console.log("\nJARVIS setup. Press Enter to skip any question. Keys are written to .env.local on this machine only.\n");

  const updates: Record<string, string> = {};
  for (const q of ASK) {
    const note = has(q.key) ? " [already set — Enter keeps it]" : "";
    const answer = (await ask(`${q.label}\n  ${q.where}${note}\n  > `)).trim();
    if (answer) updates[q.key] = answer;
    console.log("");
  }
  rl.close();

  if (Object.keys(updates).length === 0) {
    console.log(existing ? "Nothing changed." : "Nothing entered, so no file was written. You can also paste a key into Settings once it is running.");
  } else {
    writeFileSync(file, mergeEnv(existing, updates), { mode: 0o600 });
    console.log(`Saved ${Object.keys(updates).join(", ")} to .env.local.`);
  }
  console.log("\nNext: npm run doctor   then   npm run launch\n");
}

void main();
