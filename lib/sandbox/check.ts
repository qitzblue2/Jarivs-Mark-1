import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { liveRoot, sandboxRoot } from "./paths";
import { ensureSandbox } from "./sync";

/**
 * Does the sandbox still work? Asked before anything reaches the real JARVIS.
 *
 * Two checks, the same ones a contributor runs: the type checker over the
 * whole app, then the unit tests. Typing catches the broken import and the
 * renamed prop; the tests catch the tool that now answers wrongly. Both run
 * against the sandbox copy with the real node_modules, so nothing is
 * installed and nothing of the real JARVIS is touched.
 */

export interface CheckStep {
  name: string;
  ok: boolean;
  /** Skipped when its tool isn't installed (a production-only install). */
  skipped?: boolean;
  ms: number;
  /** The end of the output, where the errors are. */
  output: string;
}

export interface CheckResult {
  ok: boolean;
  at: number;
  steps: CheckStep[];
}

const TIMEOUT_MS = 5 * 60_000;
const OUTPUT_CHARS = 6000;

function checkEnv(): Record<string, string | undefined> {
  // Tests need no keys, and a test that thinks it has one may try to use it.
  const env: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|SESSION|COOKIE/i.test(name)) continue;
    if (/^(__NEXT|NEXT_PRIVATE|NEXT_RUNTIME|TURBOPACK)/.test(name)) continue;
    if (name.startsWith("JARVIS_")) continue;
    env[name] = value;
  }
  env.JARVIS_IS_SANDBOX = "1";
  env.NODE_ENV = "test";
  return env;
}

function run(name: string, args: string[]): Promise<CheckStep> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: sandboxRoot(), env: checkEnv() as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const take = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > OUTPUT_CHARS * 4) output = output.slice(-OUTPUT_CHARS * 2);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);

    const timer = setTimeout(() => {
      output += `\n…stopped after ${TIMEOUT_MS / 60_000} minutes.`;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      // eslint-disable-next-line no-control-regex
      const clean = output.replace(/\x1b\[[0-9;]*m/g, "").trim();
      resolve({ name, ok: code === 0, ms: Date.now() - started, output: clean.slice(-OUTPUT_CHARS) });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ name, ok: false, ms: Date.now() - started, output: err.message });
    });
  });
}

/** Only the lines that say what failed, for the model — not a page of passes. */
export function failureSummary(result: CheckResult, maxChars = 3000): string {
  if (result.ok) {
    return result.steps.map((s) => `${s.name}: ${s.skipped ? "skipped" : "passed"}`).join("\n");
  }
  const parts: string[] = [];
  for (const step of result.steps) {
    if (step.ok || step.skipped) {
      parts.push(`${step.name}: ${step.skipped ? "skipped" : "passed"}`);
      continue;
    }
    const failing = step.output
      .split("\n")
      .filter((line) => /error|FAIL|want|got|Error|expected/i.test(line))
      .slice(0, 40)
      .join("\n");
    parts.push(`${step.name}: FAILED\n${failing || step.output.slice(-1500)}`);
  }
  return parts.join("\n\n").slice(0, maxChars);
}

let running: Promise<CheckResult> | null = null;

/** Run both checks. Concurrent callers share one run rather than starting two. */
export function checkSandbox(): Promise<CheckResult> {
  running ??= (async () => {
    try {
      await ensureSandbox();
      const modules = path.join(liveRoot(), "node_modules");
      const steps: CheckStep[] = [];

      const tsc = path.join(modules, "typescript", "bin", "tsc");
      steps.push(
        existsSync(tsc)
          ? await run("Type check", [tsc, "--noEmit", "-p", "tsconfig.json"])
          : { name: "Type check", ok: true, skipped: true, ms: 0, output: "typescript isn't installed." },
      );

      const tsx = path.join(modules, "tsx", "dist", "cli.mjs");
      const unit = path.join(sandboxRoot(), "test", "unit.test.mts");
      steps.push(
        existsSync(tsx) && existsSync(unit)
          ? await run("Unit tests", [tsx, "test/unit.test.mts"])
          : { name: "Unit tests", ok: true, skipped: true, ms: 0, output: "tsx or the unit tests aren't present." },
      );

      return { ok: steps.every((s) => s.ok), at: Date.now(), steps };
    } finally {
      running = null;
    }
  })();
  return running;
}
