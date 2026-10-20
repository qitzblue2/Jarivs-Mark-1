#!/usr/bin/env node
/**
 * npm run launch — the one command that gets JARVIS running.
 *
 *   npm run launch              install if needed, check, build if needed, start, open the browser
 *   npm run launch -- --dev     start the development server instead of building
 *   npm run launch -- --lan     reachable from your phone (needs JARVIS_PASSWORD)
 *   npm run launch -- --rebuild build again even if a build exists
 *   npm run launch -- --no-open don't open a browser tab
 *
 * Nothing here is clever: it runs the same npm scripts you could run yourself,
 * in order, and stops with a plain message at the first thing that is wrong.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const dev = args.has("--dev");
const lan = args.has("--lan");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const say = (m) => console.log(`\n▸ ${m}`);

function run(script, extra = []) {
  const r = spawnSync(npm, ["run", script, ...extra], { stdio: "inherit", cwd: root, shell: process.platform === "win32" });
  return r.status === 0;
}

if (!existsSync(path.join(root, "node_modules", "next"))) {
  say("Installing dependencies (first run only; the voice models are fetched too)");
  const r = spawnSync(npm, ["install"], { stdio: "inherit", cwd: root, shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error("\nnpm install failed. Fix the error above and run this again.");
    process.exit(1);
  }
}

say("Checking this machine");
if (!run("doctor", ["--silent"])) {
  console.error("\nFix the problems above, then run this again.");
  process.exit(1);
}

if (!dev && (args.has("--rebuild") || !existsSync(path.join(root, ".next", "BUILD_ID")))) {
  say("Building (a minute or two)");
  if (!run("build")) process.exit(1);
}

const script = dev ? (lan ? "dev:lan" : "dev") : lan ? "start:lan" : "start";
const port = /^\d{2,5}$/.test(process.env.PORT ?? "") ? process.env.PORT : "3000";
const url = `http://localhost:${port}`;
say(`Starting JARVIS at ${url}   (Ctrl+C to stop)`);

const child = spawn(npm, ["run", script], { stdio: "inherit", cwd: root, shell: process.platform === "win32", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));

async function openWhenReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
    if (i === 119) return;
  }
  console.log(`\n✓ JARVIS is up: ${url}\n`);
  if (args.has("--no-open")) return;
  const [cmd, a] = process.platform === "darwin" ? ["open", []] : process.platform === "win32" ? ["cmd", ["/c", "start", ""]] : ["xdg-open", []];
  try {
    spawn(cmd, [...a, url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {}
}
void openWhenReady();
