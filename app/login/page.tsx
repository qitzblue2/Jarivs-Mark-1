"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    void fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setConfigured(Boolean(d?.configured)))
      .catch(() => setConfigured(null));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Could not sign in.");
        return;
      }
      // Full reload so the middleware sees the new cookie.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-xs">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-arc-dim/15 text-[13px] font-bold text-arc ring-1 ring-arc-dim/30">
            J
          </div>
          <h1 className="text-lg font-semibold">JARVIS</h1>
          <p className="text-[12px] text-ink-faint">Sign in to continue</p>
        </div>

        {configured === false ? (
          <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2.5 text-[12px] leading-relaxed text-warn">
            No password is configured. Set <code className="font-mono">JARVIS_PASSWORD</code> in{" "}
            <code className="font-mono">.env.local</code> and restart the server.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-2 transition focus-within:border-arc-dim/60">
              <KeyRound size={14} className="shrink-0 text-ink-faint" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
                placeholder="Password"
                className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
              />
            </div>

            <button
              type="submit"
              disabled={busy || !password}
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg bg-arc-dim px-3 py-2 text-[13px] font-medium text-white transition hover:bg-arc disabled:bg-line disabled:text-ink-faint"
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              Sign in
            </button>

            {error && <p className="mt-2 text-center text-[12px] text-danger">{error}</p>}
          </>
        )}

        <p className="mt-5 text-center text-[10.5px] leading-relaxed text-ink-faint">
          On the machine JARVIS runs on, open{" "}
          <code className="font-mono">localhost:3000</code> — no password needed there.
        </p>
      </form>
    </main>
  );
}
