"use client";

import { useState } from "react";
import { Check, FileText, ShieldAlert, Terminal, X } from "lucide-react";

export interface PendingApproval {
  id: string;
  kind: "write" | "command";
  summary: string;
  detail?: string;
  path?: string;
}

interface Props {
  approval: PendingApproval;
  onSettled: (id: string) => void;
}

/**
 * The gate between the model and your machine.
 *
 * Shows exactly what is about to happen — the command verbatim, or the full
 * file content — and nothing runs until this is answered. Deny is the safe
 * default and stays the default on timeout.
 */
export default function ApprovalCard({ approval, onSettled }: Props) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [expanded, setExpanded] = useState(approval.kind === "command");

  async function settle(decision: "approve" | "deny") {
    setBusy(decision);
    try {
      await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: approval.id, decision }),
      });
    } catch {
      /* the server-side timeout will deny it anyway */
    } finally {
      onSettled(approval.id);
    }
  }

  const isCommand = approval.kind === "command";

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-warn/40 bg-warn/[0.06]">
      <div className="flex items-center gap-2 border-b border-warn/20 px-3 py-2">
        <ShieldAlert size={14} className="shrink-0 text-warn" />
        <span className="text-[12.5px] font-medium text-warn">
          {isCommand ? "JARVIS wants to run a command" : "JARVIS wants to write a file"}
        </span>
      </div>

      <div className="px-3 py-2.5">
        <div className="flex items-start gap-2">
          {isCommand ? (
            <Terminal size={13} className="mt-0.5 shrink-0 text-ink-faint" />
          ) : (
            <FileText size={13} className="mt-0.5 shrink-0 text-ink-faint" />
          )}
          <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink">
            {approval.summary}
          </code>
        </div>

        {approval.detail && (
          <>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-[11px] text-ink-faint transition hover:text-ink"
            >
              {expanded ? "Hide" : isCommand ? "Show why" : "Show the file content"}
            </button>
            {expanded && (
              <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-line-soft bg-base p-2 font-mono text-[11px] leading-relaxed text-ink-dim">
                {approval.detail.slice(0, 8000)}
                {approval.detail.length > 8000 && "\n…[truncated for display]"}
              </pre>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-warn/20 px-3 py-2">
        <button
          onClick={() => void settle("approve")}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-md bg-arc-dim px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-arc disabled:opacity-50"
        >
          <Check size={12} />
          {busy === "approve" ? "Running…" : "Approve"}
        </button>
        <button
          onClick={() => void settle("deny")}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-dim transition hover:text-ink disabled:opacity-50"
        >
          <X size={12} />
          Deny
        </button>
        <span className="ml-auto text-[10.5px] text-ink-faint">
          Denied automatically after 5 minutes
        </span>
      </div>
    </div>
  );
}
