"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, Pause, Play, Trash2 } from "lucide-react";

/**
 * What JARVIS will do without being asked, and the means to stop it.
 *
 * The stop button is the reason this panel exists. A task that fires every
 * five minutes into a metered API, or reads a reminder aloud at three in the
 * morning, needs an off switch that does not depend on JARVIS understanding a
 * request to cancel it — which is exactly the thing that might be going wrong.
 */

interface Task {
  id: string;
  label: string;
  prompt: string;
  when: string;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt?: number;
  lastResult?: string;
  lastError?: string;
}

export default function SchedulePanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/schedule");
      const data = await res.json();
      if (!mounted.current) return;
      if (data.error) setNote(data.error);
      else setTasks(data.tasks ?? []);
    } catch (err) {
      if (mounted.current) setNote((err as Error).message);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    // The clock ticks once a minute, so anything faster would show the same
    // list back repeatedly.
    const timer = setInterval(() => void refresh(), 60_000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  async function toggle(task: Task) {
    setBusy(true);
    try {
      await fetch("/api/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, enabled: !task.enabled }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(task: Task) {
    setBusy(true);
    try {
      await fetch(`/api/schedule?id=${encodeURIComponent(task.id)}`, { method: "DELETE" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (tasks.length === 0) {
    return (
      <p className="text-[11.5px] leading-relaxed text-ink-faint">
        Nothing scheduled. Ask JARVIS to remind you about something, or to check
        something regularly, and it will appear here.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {note && (
        <p className="flex items-start gap-1.5 text-[11px] text-warn">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          {note}
        </p>
      )}

      {tasks.map((task) => (
        <div
          key={task.id}
          className={`rounded-lg border border-line px-2.5 py-2 ${task.enabled ? "" : "opacity-60"}`}
        >
          <div className="flex items-start gap-2">
            <CalendarClock size={12} className="mt-0.5 shrink-0 text-ink-faint" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] text-ink">{task.label}</p>
              <p className="text-[10.5px] text-ink-faint">
                {task.when}
                {task.enabled
                  ? ` · next ${new Date(task.nextRunAt).toLocaleString()}`
                  : " · paused"}
              </p>
              {/* Proof it actually ran, which is otherwise invisible: a task
                  that fires while you are asleep leaves no other trace. */}
              {task.lastError ? (
                <p className="mt-1 break-words text-[10.5px] text-warn">
                  Last run failed: {task.lastError}
                </p>
              ) : (
                task.lastResult && (
                  <p className="mt-1 line-clamp-2 break-words text-[10.5px] text-ink-dim">
                    Last said: {task.lastResult}
                  </p>
                )
              )}
            </div>
            <button
              onClick={() => void toggle(task)}
              disabled={busy}
              className="shrink-0 rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink disabled:opacity-40"
              title={task.enabled ? "Pause" : "Resume"}
            >
              {task.enabled ? <Pause size={12} /> : <Play size={12} />}
            </button>
            <button
              onClick={() => void remove(task)}
              disabled={busy}
              className="shrink-0 rounded p-1 text-ink-faint transition hover:bg-raised hover:text-danger disabled:opacity-40"
              title="Cancel for good"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
