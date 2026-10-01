/**
 * Server startup hook.
 *
 * In device mode this is what makes JARVIS an appliance rather than a web
 * app: the voice loop comes up with the server, so a Pi that reboots is
 * listening again without anyone opening a browser.
 *
 * With self-editing on, it also starts the always-online sandbox.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { autoStart } = await import("./lib/voice/device/runtime");
  autoStart();

  // The sandbox copy comes up with JARVIS and is kept running, so there is
  // always somewhere to try a change before it reaches the real thing.
  const { selfEditEnabled } = await import("./lib/sandbox/paths");
  if (selfEditEnabled()) {
    const { startSandboxServer } = await import("./lib/sandbox/server");
    void startSandboxServer().catch((err) => console.error("[sandbox] failed to start:", err));
  }
}
