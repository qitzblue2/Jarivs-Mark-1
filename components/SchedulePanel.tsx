"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, Pause, Play, Plus, Trash2, X } from "lucide-react";
import { TASK_TEMPLATES, buildFromTemplate, type TaskTemplate } from "@/lib/schedule/templates";

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

  async function add(template: TaskTemplate, values: { time: string; minutes: string; fields: Record<string, string> }) {
    const built = buildFromTemplate(template, values);
    if (!built.ok) return built.error;
    const res = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: built.prompt, label: built.label, ...built.schedule }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return data.error ?? "That couldn't be scheduled.";
    await refresh();
    return null;
  }

  return (
    <div className="space-y-1.5">
      {tasks.length === 0 && (
        <p className="text-[11.5px] leading-relaxed text-ink-faint">
          Nothing scheduled. Ask JARVIS to remind you about something, or to check
          something regularly, and it will appear here — or start from a template.
        </p>
      )}

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
      <Templates onAdd={add} />
    </div>
  );
}

/** Ready-made tasks: pick one, set the time (or interval) and anything it asks for, and it is scheduled. */
function Templates({
  onAdd,
}: {
  onAdd: (template: TaskTemplate, values: { time: string; minutes: string; fields: Record<string, string> }) => Promise<string | null>;
}) {
  const [chosen, setChosen] = useState<TaskTemplate | null>(null);
  const [time, setTime] = useState("");
  const [minutes, setMinutes] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function choose(template: TaskTemplate) {
    setChosen(template);
    setTime(template.when.kind === "daily" ? template.when.hhmm : "");
    setMinutes(template.when.kind === "every" ? String(template.when.minutes) : "");
    setFields({});
    setError(null);
  }

  async function submit() {
    if (!chosen) return;
    setSaving(true);
    const problem = await onAdd(chosen, { time, minutes, fields });
    setSaving(false);
    if (problem) setError(problem);
    else setChosen(null);
  }

  return (
    <div className="mt-2 border-t border-line-soft pt-2" data-schedule-templates>
      <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-ink-dim">
        <Plus size={11} aria-hidden /> Start from a template
      </p>
      {!chosen ? (
        <ul className="flex flex-wrap gap-1.5">
          {TASK_TEMPLATES.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => choose(t)}
                data-template={t.id}
                title={t.blurb}
                className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-dim transition hover:border-arc-dim/50 hover:text-ink"
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <form
          className="space-y-2 rounded-lg border border-line bg-base p-2.5"
          data-template-form={chosen.id}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[12px] font-medium text-ink">{chosen.name}</p>
              <p className="text-[11px] text-ink-faint">{chosen.blurb}</p>
            </div>
            <button type="button" onClick={() => setChosen(null)} aria-label="Cancel" className="rounded p-1 text-ink-faint hover:text-ink">
              <X size={12} />
            </button>
          </div>

          {chosen.when.kind === "daily" ? (
            <label className="block text-[11.5px] text-ink-dim">
              Every day at
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
                data-template-time
                className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1 text-[12px] text-ink outline-none focus:border-arc-dim"
              />
            </label>
          ) : (
            <label className="block text-[11.5px] text-ink-dim">
              Every (minutes)
              <input
                type="number"
                min={1}
                max={10080}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                required
                data-template-minutes
                className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1 text-[12px] text-ink outline-none focus:border-arc-dim"
              />
            </label>
          )}

          {(chosen.fields ?? []).map((f) => (
            <label key={f.id} className="block text-[11.5px] text-ink-dim">
              {f.label}
              {f.required ? "" : " (optional)"}
              <input
                value={fields[f.id] ?? ""}
                onChange={(e) => setFields((all) => ({ ...all, [f.id]: e.target.value }))}
                placeholder={f.placeholder}
                required={f.required}
                maxLength={200}
                data-template-field={f.id}
                className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-arc-dim"
              />
            </label>
          ))}

          <p className="text-[10.5px] leading-relaxed text-ink-faint">
            Runs with no browser open, so it needs an API key in <code className="font-mono">.env.local</code>.
            {chosen.costly ? " Each time it runs it spends one request." : ""}
          </p>
          {error && (
            <p role="alert" className="text-[11px] text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setChosen(null)} className="rounded-md border border-line px-2.5 py-1 text-[12px] text-ink-dim hover:text-ink">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              data-template-submit
              className="rounded-md bg-arc-solid px-2.5 py-1 text-[12px] font-medium text-white hover:bg-arc-solid-hover disabled:opacity-50"
            >
              Schedule it
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
