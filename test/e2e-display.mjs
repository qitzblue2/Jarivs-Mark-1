/**
 * The room display, driven the way JARVIS drives it.
 *
 * A real browser on /display, a real SSE connection, and real POSTs to the
 * API — because every interesting failure here is in the transport. A mock
 * would prove the state machine and none of the things that actually break:
 * a stream that never opens, a late join that shows blank, a closed tab that
 * still counts as connected.
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const BASE = process.env.JARVIS_URL ?? "http://localhost:3000";
let pass = 0;
let fail = 0;

const check = (label, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
};

const api = async (body) => {
  const res = await fetch(`${BASE}/api/display`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const status = async () => (await fetch(`${BASE}/api/display`)).json();

/** Poll server state from here rather than from inside the page, which races. */
async function until(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await status();
    if (predicate(state)) return state;
    if (Date.now() > deadline) return state;
    await new Promise((r) => setTimeout(r, 200));
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

await api({ action: "clear" });

// --- nothing connected yet ---
const empty = await status();
check("no display connected at rest", empty.connected === 0, String(empty.connected));

// --- the kiosk connects ---
// NOT networkidle: the display holds its SSE connection open for as long as
// it is on the wall, so the network is never idle and never will be.
await page.goto(`${BASE}/display`, { waitUntil: "domcontentloaded" });
const connected = await until((s) => s.connected === 1);
check("kiosk registers as connected", connected.connected === 1, String(connected.connected));

// A powered projector showing black looks broken; it shows a clock.
const idle = await page.locator("body").innerText();
check("idle shows a clock, not a black rectangle", /\d{1,2}[:.]\d{2}/.test(idle), idle.split("\n")[0]);

// --- content arrives over the stream ---
await api({ action: "show", content: { kind: "markdown", body: "## Systems nominal", title: "Status" } });
await page.waitForFunction(() => document.body.innerText.includes("Systems nominal"), { timeout: 8000 });
check("markdown reaches the wall", true);
check("and its title is shown", (await page.locator("h1").innerText()) === "Status");

// --- the containment that matters: this content is model-authored ---
await api({
  action: "show",
  content: { kind: "markdown", body: "<script>window.__pwned = 1</script>after" },
});
await page.waitForFunction(() => document.body.innerText.includes("after"), { timeout: 8000 });
const pwned = await page.evaluate(() => window.__pwned);
check("a script tag is text, not script", pwned === undefined, `__pwned=${pwned}`);

// --- code keeps its shape ---
await api({ action: "show", content: { kind: "code", body: "def f():\n    return 1", language: "python" } });
await page.waitForFunction(() => document.body.innerText.includes("def f()"), { timeout: 8000 });
const code = await page.locator("pre").innerText();
check("code keeps its newlines", code.split("\n").length === 2, `${code.split("\n").length} lines`);

// --- an off-origin image is refused before it reaches a browser ---
const evil = await api({ action: "show", content: { kind: "image", src: "https://example.com/x.png" } });
check("an off-origin image is refused", evil.status === 400, String(evil.status));
const stillCode = await status();
check("and the display is left untouched", stillCode.content?.kind === "code");

const dataUri = await api({
  action: "show",
  content: { kind: "image", src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" },
});
check("a data: URI is allowed", dataUri.status === 200);

// --- late join: a kiosk that restarts must not sit blank ---
await api({ action: "show", content: { kind: "text", body: "Already on the wall" } });
const second = await browser.newPage();
await second.goto(`${BASE}/display`, { waitUntil: "domcontentloaded" });
await second.waitForFunction(() => document.body.innerText.includes("Already on the wall"), { timeout: 8000 });
check("a display joining late gets current content", true);
check("both displays are counted", (await until((s) => s.connected === 2)).connected === 2);

// --- and a closed one stops being counted ---
await second.close();
const afterClose = await until((s) => s.connected === 1);
check("a closed display deregisters", afterClose.connected === 1, String(afterClose.connected));

// --- view changes ---
await api({ action: "view", view: "fullscreen" });
check("view is accepted", (await status()).view === "fullscreen");
const badView = await api({ action: "view", view: "enormous" });
check("an unknown view is refused", badView.status === 400);

// --- power, with no CEC hardware anywhere near this machine ---
const power = await api({ action: "power", on: true });
const ps = (await status()).power;
check("power reports rather than throwing", power.status === 200);
check(
  "and names what to install when nothing is available",
  ps.available || /cec-utils/.test(ps.problem ?? ""),
  ps.problem?.slice(0, 60) ?? ps.method ?? "",
);

await api({ action: "clear" });
await page.waitForFunction(() => !document.body.innerText.includes("Already on the wall"), { timeout: 8000 });
check("clear empties the wall", true);

check("no console or page errors", errors.length === 0, errors[0] ?? "");

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
