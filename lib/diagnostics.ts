/**
 * A plain-text summary of this install, for pasting into a bug report or a chat
 * for help: versions, what is configured, what is reachable, how big things
 * are. Built from a short list of named facts, so what can appear is decided
 * here — API keys, addresses and anything you wrote are not on the list, and
 * nothing is read off the page "in case it helps".
 */

export interface ServerFacts {
  app: { name: string; version: string };
  node: string;
  platform: string;
  uptimeSeconds: number;
  /** The last two parts of the data folder's path — enough to recognise it, not your home directory. */
  dataDir: string;
  storage: string;
  counts: { chats: number; trash: number; memory: number; pictures: number; scheduled: number };
  flags: { computerAccess: boolean; selfEdit: boolean; isSandbox: boolean; passwordSet: boolean; listensOnNetwork: boolean; applianceMode: boolean };
}

export interface ClientFacts {
  userAgent: string;
  language: string;
  timeZone: string;
  viewport: string;
  online: boolean;
  /** Provider names with whether each can answer from here and how many models it lists. */
  providers: { label: string; ready: boolean; models: number }[];
  appearance: { theme: string; textSize: string; density: string };
  settings: { temperature: number; toolsOn: boolean; toolsOff: number; favourites: number; savedPrompts: number; modelNotes: number; noFallback: boolean; replyLength: string };
  initiative: { enabled: boolean; level: string };
  prefs: { sendKey: string; font: string; accent: string; width: string };
}

const yes = (v: boolean) => (v ? "yes" : "no");

function uptime(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${(seconds / 3600).toFixed(1)} h`;
  return `${Math.round(seconds / 86_400)} days`;
}

export function formatDiagnostics(server: ServerFacts, client: ClientFacts, now = new Date()): string {
  const lines = [
    `${server.app.name} ${server.app.version} — diagnostics, ${now.toISOString()}`,
    "",
    "Server",
    `  node ${server.node} on ${server.platform}, up ${uptime(server.uptimeSeconds)}`,
    `  storage: ${server.storage} (${server.dataDir})`,
    `  ${server.counts.chats} chats, ${server.counts.trash} in the trash, ${server.counts.memory} memories, ${server.counts.pictures} pictures, ${server.counts.scheduled} scheduled tasks`,
    `  computer access: ${yes(server.flags.computerAccess)} · self-editing: ${yes(server.flags.selfEdit)}${server.flags.isSandbox ? " (this is the sandbox)" : ""}`,
    `  password set: ${yes(server.flags.passwordSet)} · listens on the network: ${yes(server.flags.listensOnNetwork)} · appliance mode: ${yes(server.flags.applianceMode)}`,
    "",
    "Providers (from this browser)",
    ...(client.providers.length ? client.providers.map((p) => `  ${p.label}: ${p.ready ? `ready, ${p.models} models` : "not ready"}`) : ["  none loaded"]),
    "",
    "This browser",
    `  ${client.userAgent}`,
    `  ${client.language}, ${client.timeZone}, window ${client.viewport}, ${client.online ? "online" : "offline"}`,
    `  theme ${client.appearance.theme}, text ${client.appearance.textSize}, ${client.appearance.density}; font ${client.prefs.font}, accent ${client.prefs.accent}, width ${client.prefs.width}; send with ${client.prefs.sendKey}`,
    "",
    "Settings (no keys, no text you wrote)",
    `  temperature ${client.settings.temperature}, reply length ${client.settings.replyLength}, tools ${client.settings.toolsOn ? `on (${client.settings.toolsOff} switched off)` : "off"}`,
    `  ${client.settings.favourites} favourite models, ${client.settings.modelNotes} model notes, ${client.settings.savedPrompts} saved prompts, fall back to other providers: ${yes(!client.settings.noFallback)}`,
    `  suggestions and interruptions: ${client.initiative.enabled ? client.initiative.level : "off"}`,
  ];
  return `${lines.join("\n")}\n`;
}

/** "/home/me/jarvis/data" → "jarvis/data" — where it is, without whose it is. */
export function shortPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
}
