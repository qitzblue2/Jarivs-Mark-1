import type { CheckResult } from "@/lib/sandbox/check";

/** The last check, and the exact sandbox state it ran against. */
const shared = globalThis as { __jarvisSandboxCheck?: { result: CheckResult; fingerprint: string } };

export function lastCheck() {
  return shared.__jarvisSandboxCheck ?? null;
}

export function rememberCheck(result: CheckResult, fingerprint: string): void {
  shared.__jarvisSandboxCheck = { result, fingerprint };
}

export const disabled = () =>
  Response.json(
    {
      error:
        "Self-editing is off. Set JARVIS_ALLOW_SELF_EDIT=1 in .env.local and restart JARVIS to turn it on.",
    },
    { status: 404 },
  );
