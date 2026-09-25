import { promises as fs } from "node:fs";
import os from "node:os";

/**
 * What machine is JARVIS running on?
 *
 * The Pi model decides how good a voice it can synthesise in real time, and
 * it isn't known at build time — this box might be a Pi 3, a Pi 5 or a
 * laptop. Everything downstream is chosen from what's detected rather than
 * assumed.
 */

export type DeviceClass = "pi-zero" | "pi-3" | "pi-4" | "pi-5" | "desktop" | "unknown";

/** Piper voice qualities, cheapest first. */
export type VoiceQuality = "x_low" | "low" | "medium" | "high";

export interface DeviceInfo {
  deviceClass: DeviceClass;
  /** Piper release architecture: aarch64, armv7l or x86_64. */
  arch: string;
  model: string;
  cores: number;
  totalMemoryMb: number;
  /** Voice quality this machine can synthesise comfortably. */
  suggestedQuality: VoiceQuality;
}

/** Piper publishes one binary per architecture; pick the matching name. */
export function piperArch(): string {
  switch (os.arch()) {
    case "arm64":
      return "aarch64";
    case "arm":
      return "armv7l";
    case "x64":
      return "x86_64";
    default:
      return os.arch();
  }
}

function classify(model: string, cores: number, memoryMb: number): DeviceClass {
  const text = model.toLowerCase();

  if (text.includes("raspberry pi 5")) return "pi-5";
  if (text.includes("raspberry pi 4") || text.includes("compute module 4")) return "pi-4";
  if (text.includes("raspberry pi 3")) return "pi-3";
  if (text.includes("raspberry pi zero")) return "pi-zero";

  // An unnamed ARM board is judged on what it actually has.
  if (os.arch().startsWith("arm")) {
    if (cores >= 4 && memoryMb >= 3500) return "pi-4";
    if (cores >= 4) return "pi-3";
    return "pi-zero";
  }

  return "desktop";
}

/**
 * Voice quality by device.
 *
 * Measured here: Piper's `low` voice runs at 0.17x realtime on x86. A Pi 5
 * manages `medium` in real time; a Pi 4 lags on it and wants `low`; a Pi 3
 * needs `x_low` to keep up. Erring quiet-and-fast beats erring slow, because
 * a laggy assistant is worse than a plain-sounding one.
 */
function qualityFor(deviceClass: DeviceClass): VoiceQuality {
  switch (deviceClass) {
    case "pi-zero":
      return "x_low";
    case "pi-3":
      return "x_low";
    case "pi-4":
      return "low";
    case "pi-5":
      return "medium";
    case "desktop":
      return "medium";
    default:
      return "low";
  }
}

let cached: DeviceInfo | null = null;

export async function detectDevice(): Promise<DeviceInfo> {
  if (cached) return cached;

  let model = os.platform() === "linux" ? "" : `${os.platform()} ${os.arch()}`;

  try {
    // The Pi exposes its exact board here; it's null-terminated.
    model = (await fs.readFile("/proc/device-tree/model", "utf8")).replace(/\0/g, "").trim();
  } catch {
    try {
      const cpuinfo = await fs.readFile("/proc/cpuinfo", "utf8");
      model = /^Model\s*:\s*(.+)$/m.exec(cpuinfo)?.[1]?.trim() || model;
    } catch {
      /* not Linux, or a container without /proc — fall through */
    }
  }

  const cores = os.cpus().length || 1;
  const totalMemoryMb = Math.round(os.totalmem() / 1048576);
  const deviceClass = classify(model, cores, totalMemoryMb);

  cached = {
    deviceClass,
    arch: piperArch(),
    model: model || "unknown",
    cores,
    totalMemoryMb,
    suggestedQuality: qualityFor(deviceClass),
  };

  return cached;
}

/** True when JARVIS is running as an appliance rather than a web app. */
export function deviceMode(): boolean {
  return process.env.JARVIS_DEVICE_MODE === "1";
}
