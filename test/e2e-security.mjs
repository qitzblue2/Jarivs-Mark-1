/**
 * Login throttling, headers, health and the audit log, over real HTTP.
 *
 * Needs a PRODUCTION server started WITH a password, on a port of its own —
 * it locks the login out for 15 minutes, which you don't want on the server
 * you are using:
 *   npm run build
 *   JARVIS_PASSWORD=correct-horse npx next start -p 3200
 *   BASE_URL=http://localhost:3200 JARVIS_PASSWORD=correct-horse npm run test:security
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const PASSWORD = process.env.JARVIS_PASSWORD ?? "correct-horse";

let failed = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
};

const login = (password, headers = {}) =>
  fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ password }),
  });

// --- headers on real responses ---
const home = await fetch(BASE);
check("nosniff is sent", home.headers.get("x-content-type-options") === "nosniff");
check("framing is limited to this site", home.headers.get("x-frame-options") === "SAMEORIGIN");
check("referrers stay home", home.headers.get("referrer-policy") === "same-origin");
check("the microphone is allowed, the camera is not", /microphone=\(self\)/.test(home.headers.get("permissions-policy") ?? "") && /camera=\(\)/.test(home.headers.get("permissions-policy") ?? ""));
const api = await fetch(`${BASE}/api/health`);
check("API responses carry them too", api.headers.get("x-content-type-options") === "nosniff");

// --- health ---
const health = await api.json();
check("health reports up", health.ok === true && typeof health.uptimeSeconds === "number");
check("and reveals nothing else", Object.keys(health).length === 2, Object.keys(health).join(","));

// --- the lockout ---
const ip = { "x-forwarded-for": "203.0.113.50" };
const results = [];
for (let i = 0; i < 5; i++) results.push((await login("wrong-" + i, ip)).status);
check("five wrong passwords are answered as wrong", results.every((s) => s === 401), results.join(","));

const locked = await login("wrong-again", ip);
check("the sixth is refused as too many", locked.status === 429, String(locked.status));
check("with a Retry-After", Number(locked.headers.get("retry-after")) > 800, locked.headers.get("retry-after") ?? "");
check("and a message that says how long", /minutes?/.test((await locked.json()).error ?? ""));

const rightButLocked = await login(PASSWORD, ip);
check("even the right password is refused while locked out", rightButLocked.status === 429, String(rightButLocked.status));
check("and no session is given", !rightButLocked.headers.get("set-cookie"));

const other = await login(PASSWORD, { "x-forwarded-for": "198.51.100.77" });
check("a different client can still sign in", other.status === 200, String(other.status));
check("receiving a session cookie", /jarvis_session=/.test(other.headers.get("set-cookie") ?? ""));

// --- the record ---
const { entries } = await (await fetch(`${BASE}/api/audit?limit=50`)).json();
const kinds = entries.map((e) => e.kind);
check("failed logins are recorded", kinds.filter((k) => k === "login.fail").length >= 5);
check("the lockout is recorded", kinds.includes("login.locked"));
check("the good sign-in is recorded", kinds.includes("login.ok"));
check("with the client but never the password", entries.some((e) => e.client === "203.0.113.50") && !JSON.stringify(entries).includes(PASSWORD) && !JSON.stringify(entries).includes("wrong-"));

process.exit(failed ? 1 : 0);
