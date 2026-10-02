import type { Settings } from "@/components/SettingsDialog";
import { QUALITY_OPTIONS } from "@/lib/voice/tts/kokoro";
import { cleanPrompts } from "@/lib/prompts";

/**
 * Moving your setup between browsers.
 *
 * Settings live in one browser's localStorage, so a second device or a cleared
 * profile starts from nothing. Export writes a file; import reads one back.
 *
 * API keys, endpoints' MAC addresses and anything else that is a secret are
 * left out of the file on purpose: a settings file gets emailed and pasted
 * into chats, and a key in it is a key leaked. Importing never touches the
 * keys already in this browser.
 *
 * Import trusts nothing in the file. Each field is checked for the right type
 * and clamped to a sane range, and anything unrecognised is dropped, so a
 * hand-edited or hostile file can change a setting but not break the app.
 */

/** Fields that never leave the browser in an export. */
const SECRET_FIELDS = ["keys", "macs"] as const;

export const FORMAT = "jarvis-settings";

export interface ExportedSettings {
  format: typeof FORMAT;
  version: 1;
  exportedAt: string;
  settings: Partial<Settings>;
}

export function exportSettings(settings: Settings, now = new Date()): ExportedSettings {
  const copy: Record<string, unknown> = { ...settings };
  for (const field of SECRET_FIELDS) delete copy[field];
  return { format: FORMAT, version: 1, exportedAt: now.toISOString(), settings: copy as Partial<Settings> };
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const num = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v, min, max) : undefined;

function cleanEndpoints(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [id, url] of Object.entries(v as Record<string, unknown>)) {
    // Only http(s) URLs: this value is later fetched by the server.
    if (typeof url === "string" && /^https?:\/\//i.test(url) && /^[\w-]{1,40}$/.test(id)) out[id] = url.slice(0, 300);
  }
  return out;
}

function cleanBudgets(v: unknown): Settings["budgets"] | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Settings["budgets"] = {};
  for (const [id, b] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[\w-]{1,40}$/.test(id) || !b || typeof b !== "object") continue;
    const context = num((b as { context?: unknown }).context, 512, 2_000_000);
    const maxOutput = num((b as { maxOutput?: unknown }).maxOutput, 16, 200_000);
    out[id] = { ...(context ? { context } : {}), ...(maxOutput ? { maxOutput } : {}) };
  }
  return out;
}

export type ImportResult = { ok: true; settings: Settings; changed: string[] } | { ok: false; error: string };

/** Merge a settings file into the current settings, field by field. */
export function importSettings(raw: string, current: Settings): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "That isn't a JSON file." };
  }
  const file = parsed as Partial<ExportedSettings> | null;
  if (!file || file.format !== FORMAT || typeof file.settings !== "object" || file.settings === null) {
    return { ok: false, error: "That isn't a JARVIS settings file." };
  }
  if (file.version !== 1) return { ok: false, error: `This file is version ${String(file.version)}; this JARVIS reads version 1.` };

  const incoming = file.settings as Record<string, unknown>;
  const next: Settings = { ...current };
  const changed: string[] = [];
  const set = <K extends keyof Settings>(key: K, value: Settings[K] | undefined) => {
    if (value === undefined) return;
    if (JSON.stringify(current[key]) !== JSON.stringify(value)) changed.push(key);
    next[key] = value;
  };

  set("persona", str(incoming.persona, 20_000));
  set("greeting", str(incoming.greeting, 500));
  set("temperature", num(incoming.temperature, 0, 2));
  set("ttsSpeed", num(incoming.ttsSpeed, 0.5, 2));
  set("wakeThreshold", num(incoming.wakeThreshold, 0.05, 0.99));
  if (typeof incoming.useTools === "boolean") set("useTools", incoming.useTools);
  set("ttsEngine", str(incoming.ttsEngine, 40));
  set("ttsVoice", str(incoming.ttsVoice, 80));
  const quality = QUALITY_OPTIONS.find((q) => q.id === incoming.ttsQuality);
  if (quality) set("ttsQuality", quality.id);
  // Saved prompts are text you wrote, not a secret, so they travel with the file.
  if (Array.isArray(incoming.prompts)) set("prompts", cleanPrompts(incoming.prompts));
  set("endpoints", cleanEndpoints(incoming.endpoints));
  set("budgets", cleanBudgets(incoming.budgets));

  // Keys and MAC addresses are never read from a file, whatever it holds.
  return { ok: true, settings: next, changed };
}
