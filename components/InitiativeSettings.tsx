"use client";

import { useState } from "react";
import { clearHistory, forgetLearned, offerNow, setConfig, setRule, useInitiative } from "@/lib/initiative/store";
import { inQuietHours, LEVEL_INFO, LEVELS, RULE_IDS, RULE_INFO, type Level } from "@/lib/initiative/config";
import type { Nudge } from "@/lib/initiative/rules";

function Switch({ label, hint, checked, onChange, name }: { label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void; name: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-initiative-switch={name}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-arc-solid)]"
      />
      <span className="min-w-0">
        <span className="block text-[12.5px] text-ink">{label}</span>
        {hint && <span className="block text-[11.5px] leading-relaxed text-ink-faint">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * How much JARVIS may speak first — whether it suggests things, interrupts, says
 * how it seems to be doing, and adjusts to how you sound. All of it is on this
 * device, applies at once, and starts at the gentle end.
 */
export default function InitiativeSettings() {
  const s = useInitiative();
  const c = s.config;
  const [note, setNote] = useState<string | null>(null);
  const muted = s.gate.learnedMutes;

  async function setDesktop(on: boolean) {
    setNote(null);
    if (!on) return setConfig({ desktop: false });
    if (typeof Notification === "undefined") {
      return setNote("This browser can't show desktop notifications.");
    }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") {
      setNote("The browser didn't allow notifications. Allow them for this site in its settings, then try again.");
      return;
    }
    setConfig({ desktop: true });
  }

  function setSpeak(on: boolean) {
    setNote(null);
    if (on && typeof speechSynthesis === "undefined") return setNote("This browser has no speech voice.");
    setConfig({ speak: on });
  }

  function testCard() {
    const now = Date.now();
    const nudge: Nudge = {
      id: `test:${now}`,
      rule: "inbox",
      title: "This is what a card looks like",
      body: "Suggestions appear here, never while you are typing. Nothing on one happens until you press it.",
      actions: [{ kind: "fill", label: "Put a line in the message box", text: "Hello — this was filled in by a test card." }],
      requested: true,
      at: now,
    };
    const d = offerNow(nudge);
    setNote(
      d.action === "show"
        ? "There it is, bottom right."
        : d.action === "queue"
          ? `Waiting for a calm moment (${d.reason}). Close Settings and it will appear.`
          : d.action === "inbox"
            ? `Held in the inbox instead (${d.reason}).`
            : `Not shown (${d.reason}).`,
    );
  }

  return (
    <section className="space-y-3" data-initiative-settings>
      <div>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">Initiative</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
          How much JARVIS speaks first. It notices things with plain rules in your browser — no model call, no quota — and never sends
          anything for you: a card&apos;s buttons only fill the message box or take you somewhere. Remembered on this device only.
        </p>
      </div>

      <Switch
        name="enabled"
        label="Let JARVIS suggest things and interrupt"
        hint="Off: nothing pops up. Scheduled results and failed backups still wait in the inbox."
        checked={c.enabled}
        onChange={(enabled) => setConfig({ enabled })}
      />

      <div role="radiogroup" aria-label="How often" data-choice="level" className="space-y-1">
        <span className="block text-[11.5px] text-ink-dim">How often</span>
        <div className="flex flex-wrap gap-1">
          {LEVELS.map((level: Level) => {
            const on = c.level === level;
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={on}
                data-value={level}
                disabled={!c.enabled}
                onClick={() => setConfig({ level })}
                className={`rounded-md border px-2.5 py-1 text-[12px] transition disabled:opacity-50 ${
                  on ? "border-arc-dim bg-arc-dim/15 text-ink" : "border-line text-ink-dim hover:border-arc-dim/50 hover:text-ink"
                }`}
              >
                {LEVEL_INFO[level].label}
              </button>
            );
          })}
        </div>
        <p className="text-[11.5px] text-ink-faint">{LEVEL_INFO[c.level].blurb}</p>
      </div>

      <fieldset className="space-y-0.5" disabled={!c.enabled}>
        <legend className="mb-1 text-[11.5px] text-ink-dim">What it may bring up</legend>
        {RULE_IDS.map((id) => (
          <Switch
            key={id}
            name={`rule-${id}`}
            label={RULE_INFO[id].label}
            hint={muted.includes(id) ? `${RULE_INFO[id].blurb} — stopped because you waved it away three times.` : RULE_INFO[id].blurb}
            checked={c.rules[id] && !muted.includes(id)}
            onChange={(on) => setRule(id, on)}
          />
        ))}
        {muted.length > 0 && (
          <button
            type="button"
            onClick={forgetLearned}
            data-initiative-forget
            className="mt-1 text-[11.5px] text-arc underline-offset-2 hover:underline"
          >
            Forget what it learned and let those back in
          </button>
        )}
      </fieldset>

      <div className="space-y-1.5">
        <Switch
          name="quiet-hours"
          label="Quiet hours"
          hint="No desktop notifications and no speech in these hours. Cards inside the app still follow the setting above."
          checked={c.quietHours.on}
          onChange={(on) => setConfig({ quietHours: { ...c.quietHours, on } })}
        />
        <div className="flex flex-wrap items-center gap-2 pl-6 text-[12px] text-ink-dim">
          <label className="flex items-center gap-1.5">
            From
            <input
              type="time"
              value={c.quietHours.from}
              disabled={!c.quietHours.on}
              onChange={(e) => e.target.value && setConfig({ quietHours: { ...c.quietHours, from: e.target.value } })}
              className="rounded-md border border-line bg-base px-1.5 py-0.5 text-[12px] text-ink disabled:opacity-50"
              data-quiet-from
            />
          </label>
          <label className="flex items-center gap-1.5">
            to
            <input
              type="time"
              value={c.quietHours.to}
              disabled={!c.quietHours.on}
              onChange={(e) => e.target.value && setConfig({ quietHours: { ...c.quietHours, to: e.target.value } })}
              className="rounded-md border border-line bg-base px-1.5 py-0.5 text-[12px] text-ink disabled:opacity-50"
              data-quiet-to
            />
          </label>
          {c.quietHours.on && <span className="text-ink-faint">{inQuietHours(new Date(), c.quietHours) ? "Quiet right now." : "Not quiet right now."}</span>}
        </div>
      </div>

      <div>
        <p className="mb-0.5 text-[11.5px] text-ink-dim">Louder, when you want it</p>
        <Switch
          name="desktop"
          label="Desktop notification when this tab is in the background"
          hint="Asks the browser for permission. Never during quiet hours."
          checked={c.desktop}
          onChange={(on) => void setDesktop(on)}
        />
        <Switch
          name="speak"
          label="Read cards aloud"
          hint="With the browser's own voice, when the tab is in front. Never during quiet hours."
          checked={c.speak}
          onChange={setSpeak}
        />
      </div>

      <div>
        <p className="mb-0.5 text-[11.5px] text-ink-dim">Personality</p>
        <Switch
          name="mood"
          label="Show how the session is going"
          hint="A dot and a word beside the title: calm, focused, pleased, concerned, sorry. A summary of thumbs, thanks and failed requests — not a feeling — and it fades back to calm."
          checked={c.showMood}
          onChange={(showMood) => setConfig({ showMood })}
        />
        <Switch
          name="adapt-tone"
          label="Match my tone"
          hint="If a message sounds frustrated or rushed, the reply is told to be more direct; if it sounds low, to be gentler. Read in your browser and not stored; the model gets one sentence of guidance for that reply, never a label for you. It can be wrong, and it is not a safety system."
          checked={c.adaptTone}
          onChange={(adaptTone) => setConfig({ adaptTone })}
        />
        <Switch
          name="follow-ups"
          label="Suggest follow-ups under replies"
          hint="Buttons that put a next question in the message box. Nothing is sent until you press Enter."
          checked={c.followUps}
          onChange={(followUps) => setConfig({ followUps })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        <button type="button" onClick={testCard} data-initiative-test className="rounded-md border border-line px-2.5 py-1 text-ink-dim transition hover:border-arc-dim/50 hover:text-ink">
          Show a test card
        </button>
        <button
          type="button"
          onClick={() => {
            clearHistory();
            setNote("Cleared the suggestion history.");
          }}
          className="text-ink-faint transition hover:text-ink"
        >
          Clear suggestion history
        </button>
      </div>
      {note && (
        <p role="status" className="text-[11.5px] text-ink-dim" data-initiative-note>
          {note}
        </p>
      )}
    </section>
  );
}
