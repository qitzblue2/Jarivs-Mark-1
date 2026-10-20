import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { PowerStatus } from "./types";

const run = promisify(execFile);

/**
 * Turning the projector itself on and off.
 *
 * Three mechanisms, tried in order, because none of them works everywhere:
 *
 *   cec-client   speaks HDMI-CEC down the HDMI cable, so the projector's own
 *                power button is what gets pressed. The only one that truly
 *                powers the device rather than the signal.
 *   wlr-randr    blanks the output on a Wayland Pi. The projector stays on
 *                and shows nothing.
 *   vcgencmd     the same idea on older Pi OS.
 *
 * CEC is off by default on most projectors and is usually the reason this
 * appears broken, so the diagnostic says so rather than reporting a bare
 * failure.
 *
 * Nothing the model supplies reaches any of these. The caller chooses on or
 * off and the command is assembled here from that single boolean — which is
 * the whole reason this does not need the approval gate that `run_command`
 * carries.
 */

/** Last state we believe the screen to be in; null until we set it. */
let known: boolean | null = null;

async function has(tool: string): Promise<boolean> {
  try {
    await run("which", [tool]);
    return true;
  } catch {
    return false;
  }
}

export async function powerStatus(): Promise<PowerStatus> {
  if (await has("cec-client")) {
    return { available: true, method: "cec", on: known };
  }
  if (await has("wlr-randr")) {
    return {
      available: true,
      method: "wlr-randr",
      on: known,
      problem:
        "HDMI-CEC not installed, so the projector can't be powered — only the " +
        "signal blanked. `sudo apt install cec-utils` for real power control.",
    };
  }
  if (await has("vcgencmd")) {
    return { available: true, method: "vcgencmd", on: known };
  }
  return {
    available: false,
    method: null,
    on: known,
    problem:
      "No way to control the screen. `sudo apt install cec-utils` for projector " +
      "power over HDMI-CEC, and check the projector's own CEC setting is enabled " +
      "— it is off by default on most of them.",
  };
}

/**
 * cec-client takes its commands on stdin and needs a moment to enumerate the
 * bus, so it is spawned and fed rather than invoked with arguments.
 */
function cecCommand(on: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    // "on 0" / "standby 0" — address 0 is the TV, which is what a projector
    // presents itself as. -s is single-command mode, -d 1 quietens it.
    const child = spawn("cec-client", ["-s", "-d", "1"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(new Error(`cec-client failed: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`cec-client exited ${code}: ${stderr.slice(0, 160)}`));
    });

    child.stdin.write(on ? "on 0\n" : "standby 0\n");
    child.stdin.end();
  });
}

export async function setPower(on: boolean): Promise<PowerStatus> {
  const status = await powerStatus();
  if (!status.available) return status;

  try {
    if (status.method === "cec") {
      await cecCommand(on);
    } else if (status.method === "wlr-randr") {
      // Output name varies; --output '*' applies to all of them.
      await run("wlr-randr", ["--output", "*", on ? "--on" : "--off"]);
    } else {
      await run("vcgencmd", ["display_power", on ? "1" : "0"]);
    }
    known = on;
    return { ...status, on };
  } catch (err) {
    return { ...status, problem: (err as Error).message };
  }
}
