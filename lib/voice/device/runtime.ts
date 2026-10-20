import { DeviceVoiceSession, type DeviceConfig, type DeviceDiagnostics } from "./session";
import { deviceMode } from "./detect";

/**
 * The one device session for this process.
 *
 * There is exactly one microphone and one speaker, so there is exactly one
 * session. Module state is the right shape for that: a second one would fight
 * the first for `arecord`.
 */

let session: DeviceVoiceSession | null = null;
let lastError: string | null = null;
/** A short ring of recent events, so the UI can show what just happened. */
const log: { at: number; kind: string; text: string }[] = [];

function record(kind: string, text: string): void {
  log.push({ at: Date.now(), kind, text });
  if (log.length > 50) log.shift();
}

export function deviceLog(): { at: number; kind: string; text: string }[] {
  return [...log];
}

export function deviceSession(): DeviceVoiceSession | null {
  return session;
}

export function deviceError(): string | null {
  return lastError;
}

function configFromEnv(): Partial<DeviceConfig> {
  const config: Partial<DeviceConfig> = {};

  // Always-on is opt-in through the environment as well as the UI, because
  // on a box with no screen attached the environment is the only way in.
  if (process.env.JARVIS_ALWAYS_ON === "1") config.requireWakeWord = false;
  if (process.env.JARVIS_CAPTURE_DEVICE) config.captureDevice = process.env.JARVIS_CAPTURE_DEVICE;
  if (process.env.JARVIS_VOICE) config.voice = process.env.JARVIS_VOICE;
  if (process.env.JARVIS_HALF_DUPLEX === "0") config.halfDuplex = false;

  const speed = Number(process.env.JARVIS_VOICE_SPEED);
  if (Number.isFinite(speed) && speed > 0) config.speed = speed;

  return config;
}

export async function startDevice(config: Partial<DeviceConfig> = {}): Promise<DeviceVoiceSession> {
  if (session?.isRunning) {
    session.updateConfig(config);
    return session;
  }

  lastError = null;
  session = new DeviceVoiceSession(
    { ...configFromEnv(), ...config },
    {
      onState: (state) => record("state", state),
      onTranscript: (text) => record("heard", text),
      onReply: (text) => record("said", text.slice(0, 200)),
      onError: (message) => {
        lastError = message;
        record("error", message);
      },
    },
  );

  await session.start();
  record("state", "started");
  return session;
}

export async function stopDevice(): Promise<void> {
  await session?.stop();
  session = null;
}

export function deviceSnapshot(): DeviceDiagnostics | null {
  return session?.snapshot() ?? null;
}

/**
 * Start the loop on boot, when this machine is the appliance.
 *
 * Deliberately not awaited by the caller: the session talks to this same
 * server over loopback, so blocking startup on it would deadlock. It also
 * must not throw — a Pi with no microphone plugged in yet should still serve
 * the web UI, which is where you'd go to find out why.
 */
export function autoStart(): void {
  if (!deviceMode()) return;

  setTimeout(() => {
    void startDevice().catch((err) => {
      lastError = (err as Error).message;
      record("error", lastError);
      console.error(`[jarvis] device voice did not start: ${lastError}`);
    });
  }, 2000);
}
