import { splitReasoning } from "@/lib/reasoning";
import type { Chat } from "@/lib/types";

/**
 * A chat as one self-contained web page: no scripts, no links out, its own
 * styles, light or dark to match the reader's system. For keeping a
 * conversation or sending it to someone who has no JARVIS.
 *
 * Every piece of text goes through `esc`. Nothing in a conversation — a pasted
 * page, a model's reply — is ever treated as markup, so opening the file can't
 * run anything. Formatting is deliberately plain: paragraphs and code blocks.
 */

export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Fenced blocks become <pre>; everything else is escaped text that keeps its line breaks. */
export function bodyToHtml(body: string): string {
  const parts: string[] = [];
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  let last = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const before = body.slice(last, m.index).trim();
    if (before) parts.push(`<div class="text">${esc(before)}</div>`);
    const lang = m[1].trim().replace(/[^\w+#.-]/g, "").slice(0, 20);
    parts.push(`<pre${lang ? ` data-lang="${esc(lang)}"` : ""}><code>${esc(m[2].replace(/\n$/, ""))}</code></pre>`);
    last = m.index + m[0].length;
  }
  const rest = body.slice(last).trim();
  if (rest) parts.push(`<div class="text">${esc(rest)}</div>`);
  return parts.join("\n") || `<div class="text empty">(no text)</div>`;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f8fb;--panel:#fff;--ink:#111827;--dim:#4b5563;--line:#d3dae6;--code:#eef2f7;--arc:#075985}
@media (prefers-color-scheme:dark){:root{--bg:#0a0d13;--panel:#0f131c;--ink:#dbe3f0;--dim:#97a3ba;--line:#202839;--code:#151b27;--arc:#38bdf8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:46rem;margin:0 auto;padding:2rem 1rem 4rem}h1{font-size:1.4rem;margin:0 0 .25rem}.meta{color:var(--dim);font-size:.85rem;margin:0 0 2rem}
.msg{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:1rem 1.1rem;margin:0 0 1rem}
.who{font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--arc);margin:0 0 .4rem}
.msg.user .who{color:var(--dim)}.text{white-space:pre-wrap;overflow-wrap:anywhere}.text+.text,.text+pre,pre+.text,pre+pre{margin-top:.75rem}
.tools,.files{font-size:.8rem;color:var(--dim);margin:.5rem 0 0}
pre{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:.75rem;overflow:auto;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0}
@media print{body{background:#fff;color:#000}.msg{break-inside:avoid;border-color:#bbb}}
`;

export function chatToHtml(chat: Chat): string {
  const blocks: string[] = [];
  for (const m of chat.messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const isUser = m.role === "user";
    const who = isUser ? "You" : `JARVIS${m.model ? ` · ${m.model}` : ""}`;
    const body = isUser ? m.content : splitReasoning(m.content).answer || m.content;
    const tools = (m.toolRounds ?? []).flatMap((r) => r.calls.map((c) => c.name));
    blocks.push(
      `<section class="msg ${isUser ? "user" : "assistant"}">` +
        `<p class="who">${esc(who)}</p>` +
        bodyToHtml(body) +
        (tools.length ? `<p class="tools">Used ${esc([...new Set(tools)].join(", "))}</p>` : "") +
        (m.attachments?.length ? `<p class="files">${m.attachments.map((a) => `📎 ${esc(a.name)}`).join(" · ")}</p>` : "") +
        `</section>`,
    );
  }
  const date = new Date(chat.createdAt).toISOString().slice(0, 10);
  return (
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="generator" content="JARVIS">` +
    `<title>${esc(chat.title)}</title><style>${STYLE}</style></head><body><main>` +
    `<h1>${esc(chat.title)}</h1><p class="meta">Exported from JARVIS · ${date} · ${blocks.length} message${blocks.length === 1 ? "" : "s"}</p>` +
    `${blocks.join("\n")}</main></body></html>\n`
  );
}

export function htmlFilename(chat: Chat): string {
  const base = chat.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${base || "chat"}.html`;
}
