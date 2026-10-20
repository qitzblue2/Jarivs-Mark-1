import type { RuleContext } from "./rules";

/**
 * Is the model you're using failing you, and is there somewhere else to go?
 *
 * Looks only at the replies already in the chat: each reply that errored, or
 * that had to fall back to a different provider because the chosen one was
 * unavailable, counts. Two in a row is a pattern; the card offers a model that
 * is actually ready — one you starred if there is one.
 */

interface MessageLike {
  role: string;
  error?: string;
  fellBackFrom?: string;
  provider?: string;
  model?: string;
}

interface ProviderLike {
  id: string;
  label: string;
  ready: boolean;
  models: string[];
}

export function troubleOf(
  messages: MessageLike[],
  providers: ProviderLike[],
  current: { provider: string; model: string },
  favorites: string[],
): RuleContext["trouble"] {
  const replies = messages.filter((m) => m.role === "assistant");
  let failures = 0;
  for (let i = replies.length - 1; i >= 0; i--) {
    if (replies[i].error || replies[i].fellBackFrom) failures++;
    else break;
  }
  if (failures === 0) return null;

  const last = replies[replies.length - 1];
  const provider = last.fellBackFrom ?? last.provider ?? current.provider;
  const model = last.model ?? current.model;

  const usable = (p: string, m: string) => {
    const found = providers.find((x) => x.id === p);
    return Boolean(found?.ready && found.models.includes(m)) && !(p === provider && m === model) && p !== provider;
  };
  const label = (p: string, m: string) => `${m} · ${providers.find((x) => x.id === p)?.label ?? p}`;

  for (const key of favorites) {
    const at = key.indexOf(":");
    if (at < 1) continue;
    const [p, m] = [key.slice(0, at), key.slice(at + 1)];
    if (usable(p, m)) return { failures, provider, model, alternative: { provider: p, model: m, label: label(p, m) } };
  }
  for (const p of providers) {
    if (p.id !== provider && p.ready && p.models.length > 0) {
      return { failures, provider, model, alternative: { provider: p.id, model: p.models[0], label: label(p.id, p.models[0]) } };
    }
  }
  return { failures, provider, model, alternative: null };
}
