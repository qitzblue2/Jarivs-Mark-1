/**
 * npm run doctor — checks this machine is ready, and says what to do if not.
 * Reads the facts here; the judging is in lib/doctor.ts so it can be tested.
 */
import { existsSync, accessSync, constants, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { canStart, formatChecks, runChecks } from "../lib/doctor";

const root = process.cwd();

/** Read .env.local into the environment for this check only, without overriding what is already set. */
function loadEnvFile(file: string): boolean {
  if (!existsSync(file)) return false;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return true;
}

const envFileExists = loadEnvFile(path.join(root, ".env.local"));
const dataDir = process.env.JARVIS_DATA_DIR || path.join(root, "data");
let dataWritable = true;
try {
  mkdirSync(dataDir, { recursive: true });
  accessSync(dataDir, constants.W_OK);
} catch {
  dataWritable = false;
}

const checks = runChecks({
  env: process.env,
  nodeVersion: process.version,
  envFileExists,
  nodeModulesExists: existsSync(path.join(root, "node_modules", "next")),
  builtExists: existsSync(path.join(root, ".next", "BUILD_ID")),
  voiceModelsExist: existsSync(path.join(root, "public", "models")) && existsSync(path.join(root, "public", "models", "kokoro")),
  dataWritable,
});

console.log(formatChecks(checks));
process.exit(canStart(checks) ? 0 : 1);
