import { NextRequest } from "next/server";
import { detectDevice, deviceMode } from "@/lib/voice/device/detect";
import { audioStatus } from "@/lib/voice/device/audio";
import { piperStatus, PIPER_VOICES } from "@/lib/voice/device/piper";
import type { DeviceConfig } from "@/lib/voice/device/session";
import {
  deviceError,
  deviceLog,
  deviceSession,
  deviceSnapshot,
  startDevice,
  stopDevice,
} from "@/lib/voice/device/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Control and diagnostics for the voice loop running on this machine.
 *
 * The whole point of this route is that hardware fails in ways software
 * can't fix, and the only useful thing to do about a microphone that isn't
 * plugged in is to say so. GET answers "why isn't it hearing me?" with
 * specifics: what the machine is, what ALSA can see, whether Piper is
 * installed, and live frame counts.
 */
export async function GET() {
  const [device, audio, piper] = await Promise.all([
    detectDevice(),
    audioStatus(),
    piperStatus(),
  ]);

  const session = deviceSession();

  return Response.json({
    deviceMode: deviceMode(),
    running: session?.isRunning ?? false,
    device,
    audio,
    piper: { ...piper, catalogue: PIPER_VOICES },
    diagnostics: deviceSnapshot(),
    error: deviceError(),
    log: deviceLog(),
  });
}

interface Action {
  action: "start" | "stop" | "mute" | "unmute" | "interrupt" | "clear" | "config";
  config?: Record<string, unknown>;
}

/**
 * Take only the fields we know, with the types we expect.
 *
 * `Partial<DeviceConfig>` would typecheck against raw JSON without checking
 * anything at runtime, and a string where a threshold belongs turns into a
 * wake word that can never fire — a bug that shows up hours later as "it
 * stopped hearing me".
 */
function parseConfig(raw: Record<string, unknown> | undefined): Partial<DeviceConfig> {
  if (!raw) return {};
  const config: Partial<DeviceConfig> = {};

  const bool = (key: "requireWakeWord" | "halfDuplex" | "showOnDisplay") => {
    if (typeof raw[key] === "boolean") config[key] = raw[key];
  };
  const number = (key: "wakeThreshold" | "vadThreshold" | "speed" | "armedMs" | "historyTurns", min: number, max: number) => {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) {
      config[key] = value;
    }
  };
  const text = (key: "greeting" | "voice" | "captureDevice") => {
    if (typeof raw[key] === "string") config[key] = raw[key];
  };

  bool("requireWakeWord");
  bool("halfDuplex");
  bool("showOnDisplay");
  number("wakeThreshold", 0.05, 0.99);
  number("vadThreshold", 0.05, 0.99);
  number("speed", 0.5, 2);
  number("armedMs", 1000, 120_000);
  number("historyTurns", 0, 40);
  text("greeting");
  text("voice");
  text("captureDevice");

  return config;
}

export async function POST(req: NextRequest) {
  let body: Action;
  try {
    body = (await req.json()) as Action;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "start":
        await startDevice(parseConfig(body.config));
        break;
      case "stop":
        await stopDevice();
        break;
      case "mute":
      case "unmute": {
        const session = deviceSession();
        if (!session) return Response.json({ error: "Voice isn't running." }, { status: 409 });
        session.setMuted(body.action === "mute");
        break;
      }
      case "interrupt":
        deviceSession()?.interrupt();
        break;
      case "clear":
        deviceSession()?.clearHistory();
        break;
      case "config": {
        const session = deviceSession();
        if (!session) return Response.json({ error: "Voice isn't running." }, { status: 409 });
        session.updateConfig(parseConfig(body.config));
        break;
      }
      default:
        return Response.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  return Response.json({
    running: deviceSession()?.isRunning ?? false,
    diagnostics: deviceSnapshot(),
  });
}
