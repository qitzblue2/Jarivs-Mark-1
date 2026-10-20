/**
 * "Is this machine ready to run JARVIS?" as plain data. The checks are pure:
 * the script gathers the facts (files present, environment, Node version) and
 * hands them here, so what it concludes can be tested without a machine in any
 * particular state. Nothing here ever prints or returns a key — only whether
 * one is present.
 */
export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** What to do about it, when there is something. */
  fix?: string;
}

export interface Facts {
  env: Record<string, string | undefined>;
  nodeVersion: string;
  envFileExists: boolean;
  nodeModulesExists: boolean;
  builtExists: boolean;
  voiceModelsExist: boolean;
  dataWritable: boolean;
}

/** The environment variables that make a chat provider ready, in the order the README introduces them. */
export const PROVIDER_ENV: { id: string; label: string; vars: string[]; free: boolean }[] = [
  { id: "groq", label: "Groq", vars: ["GROQ_API_KEY"], free: true },
  { id: "cerebras", label: "Cerebras", vars: ["CEREBRAS_API_KEY"], free: true },
  { id: "gemini", label: "Gemini", vars: ["GEMINI_API_KEY"], free: true },
  { id: "mistral", label: "Mistral", vars: ["MISTRAL_API_KEY"], free: true },
  { id: "openrouter", label: "OpenRouter", vars: ["OPENROUTER_API_KEY"], free: true },
  { id: "nanogpt", label: "NanoGPT", vars: ["NANOGPT_API_KEY"], free: false },
  { id: "featherless", label: "Featherless", vars: ["FEATHERLESS_API_KEY"], free: false },
  { id: "arli", label: "Arli AI", vars: ["ARLI_API_KEY"], free: false },
  { id: "awan", label: "Awan LLM", vars: ["AWAN_API_KEY"], free: false },
];

export const MIN_NODE_MAJOR = 20;

export function nodeMajor(version: string): number {
  const m = /^v?(\d+)\./.exec(version.trim());
  return m ? Number(m[1]) : 0;
}

const set = (v: string | undefined) => typeof v === "string" && v.trim() !== "";

export function configuredProviders(env: Facts["env"]): string[] {
  return PROVIDER_ENV.filter((p) => p.vars.some((v) => set(env[v]))).map((p) => p.label);
}

export function runChecks(f: Facts): Check[] {
  const checks: Check[] = [];
  const major = nodeMajor(f.nodeVersion);
  checks.push(
    major >= MIN_NODE_MAJOR
      ? { id: "node", label: "Node.js", status: "ok", detail: `${f.nodeVersion}` }
      : { id: "node", label: "Node.js", status: "fail", detail: `${f.nodeVersion || "unknown"} is too old (need ${MIN_NODE_MAJOR} or newer).`, fix: "Install the current LTS from https://nodejs.org" },
  );

  checks.push(
    f.nodeModulesExists
      ? { id: "install", label: "Dependencies", status: "ok", detail: "installed" }
      : { id: "install", label: "Dependencies", status: "fail", detail: "node_modules is missing.", fix: "Run: npm install" },
  );

  const providers = configuredProviders(f.env);
  checks.push(
    providers.length > 0
      ? { id: "keys", label: "A chat provider", status: "ok", detail: providers.join(", ") }
      : {
          id: "keys",
          label: "A chat provider",
          status: f.envFileExists ? "warn" : "fail",
          detail: "No API key found in the environment.",
          fix: "Run: npm run setup   (or paste a key into Settings → API keys once it is running)",
        },
  );
  if (providers.length === 1) {
    checks.push({ id: "fallback", label: "A second provider", status: "warn", detail: "With only one key there is nothing to roll over to when its free limit is hit.", fix: "Add a second free key (Cerebras or Gemini) with: npm run setup" });
  }

  checks.push(
    f.builtExists
      ? { id: "build", label: "Production build", status: "ok", detail: "found" }
      : { id: "build", label: "Production build", status: "warn", detail: "Not built yet.", fix: "Run: npm run launch   (builds, then starts) — or npm run dev to skip building" },
  );

  checks.push(
    f.voiceModelsExist
      ? { id: "voice", label: "Voice models", status: "ok", detail: "downloaded" }
      : { id: "voice", label: "Voice models", status: "warn", detail: "Not downloaded, so voice stays off. Text chat is unaffected.", fix: "Run: npm run setup:voice" },
  );

  checks.push(
    f.dataWritable
      ? { id: "data", label: "Your data folder", status: "ok", detail: "writable" }
      : { id: "data", label: "Your data folder", status: "fail", detail: "./data can't be written to, so chats would not be saved.", fix: "Check the folder's permissions, or set JARVIS_DATA_DIR to somewhere writable." },
  );

  const open = f.env.JARVIS_OPEN_NETWORK === "1";
  if (open && !set(f.env.JARVIS_PASSWORD)) {
    checks.push({ id: "lan", label: "Network access", status: "fail", detail: "Listening beyond this machine with no password.", fix: "Set JARVIS_PASSWORD in .env.local, or remove JARVIS_OPEN_NETWORK." });
  } else {
    checks.push({ id: "lan", label: "Network access", status: "ok", detail: open ? "open to your network, password set" : "this machine only" });
  }

  const pictures = set(f.env.NANOGPT_API_KEY) ? "NanoGPT" : f.env.JARVIS_FREE_IMAGES === "0" ? null : "the free keyless service";
  checks.push(
    pictures
      ? { id: "pictures", label: "Pictures", status: "ok", detail: `drawn by ${pictures}` }
      : { id: "pictures", label: "Pictures", status: "warn", detail: "No picture service is available.", fix: "Remove JARVIS_FREE_IMAGES=0, or add NANOGPT_API_KEY." },
  );

  const risky = [f.env.JARVIS_ALLOW_COMPUTER === "1" ? "computer access" : "", f.env.JARVIS_ALLOW_SELF_EDIT === "1" ? "self-editing" : ""].filter(Boolean);
  checks.push({ id: "powers", label: "Extra powers", status: "ok", detail: risky.length ? `on: ${risky.join(", ")}` : "all off (the safe default)" });

  return checks;
}

export const ICON: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗" };

/** The report as text for a terminal. */
export function formatChecks(checks: Check[]): string {
  const lines: string[] = [];
  for (const c of checks) {
    lines.push(`${ICON[c.status]} ${c.label}: ${c.detail}`);
    if (c.fix && c.status !== "ok") lines.push(`    → ${c.fix}`);
  }
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  lines.push("", fails ? `${fails} problem${fails === 1 ? "" : "s"} to fix before it will run.` : warns ? `Ready to run, with ${warns} suggestion${warns === 1 ? "" : "s"}.` : "Everything is ready.");
  return lines.join("\n");
}

/** Whether the checks allow starting. Warnings don't block. */
export const canStart = (checks: Check[]): boolean => !checks.some((c) => c.status === "fail");

/**
 * Add or replace KEY=value lines in an env file's text, leaving every other
 * line (comments, other keys) exactly as it was. A blank value is skipped, and a
 * value with a newline in it is refused rather than being allowed to write a
 * second variable.
 */
export function mergeEnv(existing: string, updates: Record<string, string>): string {
  let text = existing;
  for (const [key, raw] of Object.entries(updates)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    const value = raw.trim();
    if (!value || /[\r\n]/.test(value)) continue;
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, () => line);
    else text = `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  return text;
}

/** The address to tell the user to open. */
export function localUrl(env: Facts["env"]): string {
  const port = /^\d{2,5}$/.test(env.PORT ?? "") ? env.PORT : "3000";
  return `http://localhost:${port}`;
}
