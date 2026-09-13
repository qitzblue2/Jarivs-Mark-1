/**
 * Server startup hook.
 *
 * In device mode this is what makes JARVIS an appliance rather than a web
 * app: the voice loop comes up with the server, so a Pi that reboots is
 * listening again without anyone opening a browser.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { autoStart } = await import("./lib/voice/device/runtime");
  autoStart();
}
