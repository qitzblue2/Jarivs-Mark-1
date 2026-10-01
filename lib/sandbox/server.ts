import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { isSandbox, liveRoot, sandboxHost, sandboxPort, sandboxRoot, selfEditEnabled } from "./paths";
import { ensureSandbox } from "./sync";

/**
 * Keeping the sandbox online.
 *
 * The sandbox is a second JARVIS, run with `next dev` from the sandbox copy,
 * so an edit shows up in it within a second or two — no build step between
 * changing a file and trying it. It starts with JARVIS and is watched: if it
 * exits for any reason it is started again, waiting a little longer after
 * each crash so a sandbox that dies on boot doesn't spin the CPU.
 *
 * Broken code does not take it offline. `next dev` stays up through compile
 * errors and shows them in the page, which is exactly what you want to see
 * while testing.
 *
 * It runs with its own settings so it can never step on the real JARVIS: no
 * sandbox of its own, no microphone or display (device mode stays with the
 * real one), and its own data/ — its chats, memory and schedule are separate.
 */

export type ServerState = "disabled" | "starting" | "online" | "restarting" | "stopped";

interface Supervisor {
  child: ChildProcess | null;
  state: ServerState;
  /** False while deliberately stopped (a reset), so the exit isn't treated as a crash. */
  wanted: boolean;
  restarts: number;
  startedAt: number | null;
  lastExit: string | null;
  backoffMs: number;
  timer: NodeJS.Timeout | null;
  logs: string[];
}

const MAX_LOG_LINES = 200;
const MAX_BACKOFF_MS = 30_000;

const shared = globalThis as { __jarvisSandbox?: Supervisor };

function supervisor(): Supervisor {
  shared.__jarvisSandbox ??= {
    child: null,
    state: "stopped",
    wanted: false,
    restarts: 0,
    startedAt: null,
    lastExit: null,
    backoffMs: 1000,
    timer: null,
    logs: [],
  };
  return shared.__jarvisSandbox;
}

function log(line: string): void {
  const s = supervisor();
  // Next prints colour codes; the panel shows plain text.
  // eslint-disable-next-line no-control-regex
  s.logs.push(line.replace(/\x1b\[[0-9;]*m/g, ""));
  if (s.logs.length > MAX_LOG_LINES) s.logs.splice(0, s.logs.length - MAX_LOG_LINES);
}

/**
 * The sandbox's environment: the real one's, minus everything that would
 * make two JARVISes fight over the same thing.
 */
export function sandboxEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of Object.keys(env)) {
    // Next's own runtime plumbing belongs to the parent server.
    if (/^(__NEXT|NEXT_PRIVATE|NEXT_RUNTIME|TURBOPACK|NEXT_DEPLOYMENT_ID)/.test(name)) delete env[name];
  }
  delete env.JARVIS_ALLOW_SELF_EDIT;
  delete env.JARVIS_DEVICE_MODE;
  delete env.JARVIS_OPEN_NETWORK;
  // Paths pointing at the real JARVIS' data must not be inherited.
  for (const name of ["JARVIS_WORKSPACE", "JARVIS_DATA_DIR", "JARVIS_IMAGE_DIR", "JARVIS_USAGE_FILE", "JARVIS_LIVE_ROOT", "JARVIS_SANDBOX_DIR"]) {
    delete env[name];
  }
  // next dev sets this itself and warns if it arrives as "production".
  delete env.NODE_ENV;
  env.JARVIS_IS_SANDBOX = "1";
  return env;
}

/**
 * Stop the sandbox server and everything it started.
 *
 * `next dev` runs workers of its own, so stopping only the top process
 * leaves them holding the port. Elsewhere the server gets its own process
 * group and the whole group is signalled; Windows has no groups, so
 * taskkill /T takes the tree instead (and /F, since a console program there
 * often ignores a polite request).
 */
function killTree(pid: number, force = false): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
}

function nextBin(): string {
  return path.join(liveRoot(), "node_modules", "next", "dist", "bin", "next");
}

function pidFile(): string {
  return path.join(path.dirname(sandboxRoot()), "server.pid");
}

/**
 * A sandbox left running by a JARVIS that was killed hard would hold the
 * port and make every new one crash on start. Only a process that is
 * recognisably our sandbox server is stopped — checked through /proc, so a
 * recycled pid belonging to something else is left alone.
 */
async function stopOrphan(): Promise<void> {
  let pid: number;
  try {
    pid = Number(readFileSync(pidFile(), "utf8").trim());
  } catch {
    return;
  }
  if (!Number.isInteger(pid) || pid <= 1) return;
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    if (!cmdline.includes("next") || !cmdline.includes(String(sandboxPort()))) return;
    killTree(pid);
    log(`Stopped a sandbox server left over from before (pid ${pid}).`);
  } catch {
    /* gone already, or not Linux — nothing to do */
  }
}

function launch(): void {
  const s = supervisor();
  if (!s.wanted || s.child) return;

  if (!existsSync(nextBin())) {
    s.state = "stopped";
    s.lastExit = "Next.js isn't installed (node_modules/next missing). Run npm install.";
    log(s.lastExit);
    return;
  }

  s.state = s.restarts === 0 ? "starting" : "restarting";
  s.startedAt = Date.now();
  log(`Starting the sandbox on ${sandboxHost()}:${sandboxPort()}…`);

  const child = spawn(process.execPath, [nextBin(), "dev", "-p", String(sandboxPort()), "-H", sandboxHost()], {
    cwd: sandboxRoot(),
    env: sandboxEnv() as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
    // Its own process group, so stopping it stops the workers next dev spawns
    // too. Not on Windows, where detaching opens a console window of its own.
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  s.child = child;
  if (child.pid) void fs.writeFile(pidFile(), String(child.pid)).catch(() => {});

  const onOutput = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (!line.trim()) continue;
      log(line);
      if (/Ready in|ready started|Local:/.test(line) && s.state !== "online") s.state = "online";
    }
  };
  child.stdout?.on("data", onOutput);
  child.stderr?.on("data", onOutput);

  child.on("exit", (code, signal) => {
    s.child = null;
    s.lastExit = signal ? `stopped by ${signal}` : `exited with code ${code}`;
    log(`Sandbox server ${s.lastExit}.`);
    if (!s.wanted) {
      s.state = "stopped";
      return;
    }
    // A run that stayed up a minute was healthy; start the backoff over.
    if (s.startedAt && Date.now() - s.startedAt > 60_000) s.backoffMs = 1000;
    s.state = "restarting";
    s.restarts++;
    s.timer = setTimeout(() => {
      s.timer = null;
      launch();
    }, s.backoffMs);
    s.timer.unref?.();
    s.backoffMs = Math.min(MAX_BACKOFF_MS, s.backoffMs * 2);
  });
}

let exitHookInstalled = false;

/** Start the sandbox and keep it running. Safe to call more than once. */
export async function startSandboxServer(): Promise<void> {
  if (!selfEditEnabled() || isSandbox()) return;
  const s = supervisor();
  if (s.wanted && (s.child || s.timer)) return;

  await ensureSandbox();
  await stopOrphan();

  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // The sandbox lives and dies with JARVIS.
    process.on("exit", () => {
      const child = supervisor().child;
      if (child?.pid) {
        try {
          killTree(child.pid);
        } catch {
          /* already gone */
        }
      }
    });
  }

  s.wanted = true;
  s.backoffMs = 1000;
  launch();
}

/** Stop it on purpose — for a reset. Resolves once it has exited. */
export async function stopSandboxServer(): Promise<void> {
  const s = supervisor();
  s.wanted = false;
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  const child = s.child;
  if (!child?.pid) {
    s.state = "stopped";
    return;
  }
  await new Promise<void>((resolve) => {
    const kill = setTimeout(() => {
      try {
        killTree(child.pid!, true);
      } catch {
        /* gone */
      }
    }, 5000);
    child.once("exit", () => {
      clearTimeout(kill);
      resolve();
    });
    try {
      killTree(child.pid!);
    } catch {
      clearTimeout(kill);
      resolve();
    }
  });
  s.state = "stopped";
}

export async function restartSandboxServer(): Promise<void> {
  await stopSandboxServer();
  supervisor().restarts = 0;
  await startSandboxServer();
}

/**
 * Is the sandbox accepting connections right now? Checked, not assumed.
 *
 * A TCP connect rather than a page request: `next dev` compiles a page on
 * its first visit, which can take longer than any sensible timeout, and a
 * server busy compiling is online, not down.
 */
function answering(): Promise<boolean> {
  return new Promise((resolve) => {
    // A wildcard bind is reachable on loopback; a specific address only there.
    const host = ["0.0.0.0", "::"].includes(sandboxHost()) ? "127.0.0.1" : sandboxHost();
    const socket = connect({ host, port: sandboxPort() });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export interface SandboxStatus {
  state: ServerState;
  port: number;
  host: string;
  pid: number | null;
  restarts: number;
  lastExit: string | null;
  upSince: number | null;
  logs: string[];
}

export async function sandboxStatus(): Promise<SandboxStatus> {
  const s = supervisor();
  let state: ServerState = selfEditEnabled() ? s.state : "disabled";
  // "online" is what the port says, not what the log last mentioned.
  if (state === "online" || state === "starting") {
    if (await answering()) state = "online";
    else if (state === "online") state = "restarting";
  }
  return {
    state,
    port: sandboxPort(),
    host: sandboxHost(),
    pid: s.child?.pid ?? null,
    restarts: s.restarts,
    lastExit: s.lastExit,
    upSince: state === "online" ? s.startedAt : null,
    logs: s.logs.slice(-60),
  };
}
