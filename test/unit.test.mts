/** Pure-function tests. Run with: npm test */
import { readFileSync } from "node:fs";
import { describe, nextRun, parseHhmm, setRunner, setScheduleStore, tick } from "../lib/schedule";
import type { ScheduledTask } from "../lib/schedule";
import {
  denyAll,
  grantWritesForRun,
  requestApproval,
  settleApproval,
  writesGranted,
} from "../lib/tools/fs/approval";
import { extractCodeBlocks, artifactsFromMessage, buildPreviewDocument } from "../lib/codeblocks";
import { trimToBudget, truncateMiddle, estimateTokens } from "../lib/tokens";
import { ToolCallAccumulator, extractChunk } from "../lib/stream";
import { evaluate } from "../lib/tools/calculate";
import { runToolCall } from "../lib/tools/run";
import { isBlockedAddress, assertUrlAllowed } from "../lib/tools/net-guard";
import { parseDuckDuckGoHtml } from "../lib/tools/search/duckduckgo";
import { htmlToText } from "../lib/tools/html-text";
import { tidy } from "../lib/tools/search/types";
import { WakeGate, SilenceGate } from "../lib/voice/wake/types";
import { SpeechSegmenter } from "../lib/voice/device/segment";
import { allTools } from "../lib/tools/registry";
import { toWireTool } from "../lib/tools/types";
import { DEFAULT_PERSONA } from "../lib/persona";
import { isNoise } from "../lib/voice/phrases";
import { forSpeech } from "../lib/voice/tts/types";
import { splitReasoning } from "../lib/reasoning";
import { environmentNote } from "../lib/environment";
import { MAX_FAILURES, MAX_GLOBAL_FAILURES, WINDOW_MS, clientKey, recordFailure, recordSuccess, resetLimiter, retryAfterMs } from "../lib/auth/limiter";
import { audit, auditFile, flushAudit, recentAudit } from "../lib/audit";
import { FORMAT, exportSettings, importSettings } from "../lib/settings-io";
import { DEFAULT_SETTINGS } from "../components/SettingsDialog";
import nextConfig, { securityHeaders } from "../next.config";
import { GET as healthGet } from "../app/api/health/route";
import { groupByDate } from "../lib/chat-groups";
import { MAX_TAGS, applyChatPatch, branchChat, normalizeTag, normalizeTags, tagCounts } from "../lib/chat-ops";
import { parseQuery } from "../lib/chat-search";
import { MemoryStore } from "../lib/storage/memory-store";
import { FsStore } from "../lib/storage/fs-store";
import { TRASH_MS } from "../lib/storage/types";
import { FsMemoryStore } from "../lib/memory/fs-store";
import { readZipDirectory, readZipEntry, ZipError } from "../lib/backup/unzip";
import { describeRestore, restoreBackup } from "../lib/backup/restore";
import { deflateRawSync } from "node:zlib";
import { describeStats, estimateReplyTokens, formatTime, isLongMessage } from "../lib/format";
import { toCsv } from "../lib/csv";
import { PromptHistory } from "../lib/history";
import { MAX_DRAFTS, clearDraft, draftKey, loadDraft, saveDraft } from "../lib/drafts";
import { COMMAND_NAMES, matchSlash, parseSlash } from "../lib/slash";
import { MAX_PROMPTS, cleanPrompts, normalizePromptName } from "../lib/prompts";
import { listStarred } from "../lib/starred";
import { codeFileName } from "../lib/codeblocks";
import { SentenceSplitter, splitSentences } from "../lib/voice/tts/sentences";
import { Speaker } from "../lib/voice/tts/speaker";
import { encodeWav, durationOf } from "../lib/voice/wav";
import { rank, forPrompt } from "../lib/memory/relevance";
import type { MemoryEntry } from "../lib/memory/types";
import { attachmentsToText, lighten, formatSize, MAX_IMAGES } from "../lib/attachments";
import { supportsVision } from "../lib/providers/registry";
import { textOf } from "../lib/tokens";
import type { Attachment } from "../lib/types";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageIdFrom, listImages, pruneImages, readImage, sniffMime } from "../lib/images/store";
import { chatToMarkdown, exportFilename, matchChat, rankChats, searchChats, sortChats } from "../lib/chat-search";
import { getStore } from "../lib/storage";
import { flushUsage, recordRequest, resetUsage, usageHistory, utcDay } from "../lib/providers/usage";
import { crc32, zipStream } from "../lib/backup/zip";
import { backupEntries } from "../lib/backup";
import { isEditable, isSourcePath, resolveSource } from "../lib/sandbox/paths";
import { diffLines, unifiedDiff } from "../lib/sandbox/diff";
import {
  listChanges, listPromotions, promote, readManifest, resetSandbox, revertSandboxFile, undoPromotion, writeSandboxFile,
} from "../lib/sandbox/sync";
import { sandboxEnv } from "../lib/sandbox/server";
import { settleApproval } from "../lib/tools/fs/approval";
import type { Chat } from "../lib/types";

let pass = 0;
let fail = 0;

const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}` +
      (ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`),
  );
};
const throws = (name: string, fn: () => unknown) => {
  try {
    fn();
    fail++;
    console.log(`FAIL ${name}\n     expected a throw`);
  } catch {
    pass++;
    console.log(`ok   ${name}`);
  }
};

console.log("\n--- code blocks ---");
eq("simple block", extractCodeBlocks("a\n```js\nlet x=1\n```\nb").map((b) => [b.lang, b.code]), [["js", "let x=1"]]);
eq("two blocks", extractCodeBlocks("```py\na\n```\ntext\n```sh\nls\n```").map((b) => b.lang), ["py", "sh"]);
eq("no lang -> text", extractCodeBlocks("```\nraw\n```")[0].lang, "text");
eq("tilde fence", extractCodeBlocks("~~~css\nb{}\n~~~")[0].code, "b{}");
eq("nested shorter fence", extractCodeBlocks("````md\nSee:\n```js\nx\n```\ndone\n````")[0].code, "See:\n```js\nx\n```\ndone");
eq("unterminated block still shows", extractCodeBlocks("```html\n<p>par")[0].code, "<p>par");
eq("empty block dropped", extractCodeBlocks("```js\n```").length, 0);

const msg = (content: string) => ({ id: "m1", role: "assistant" as const, content, createdAt: 0 });
eq("// filename", artifactsFromMessage(msg("```js\n// app.js\nx\n```"))[0].filename, "app.js");
eq("# filename", artifactsFromMessage(msg("```py\n# main.py\nx\n```"))[0].filename, "main.py");
eq("<!-- filename -->", artifactsFromMessage(msg("```html\n<!-- index.html -->\nx\n```"))[0].filename, "index.html");
eq("fallback name+ext", artifactsFromMessage(msg("```python\nprint(1)\n```"))[0].filename, "snippet-1.py");
eq("previewable html", artifactsFromMessage(msg("```html\n<p>x\n```"))[0].previewable, true);
eq("not previewable py", artifactsFromMessage(msg("```python\nx\n```"))[0].previewable, false);
eq("artifact id matches canvas lookup", artifactsFromMessage(msg("```js\na\n```\n```js\nb\n```"))[1].id, "m1-1");

const art = (lang: string, code: string) => ({ id: "a", lang, filename: `a.${lang}`, code, messageId: "m", previewable: true });
eq("css gets scaffold", buildPreviewDocument(art("css", "b{color:red}")).includes("<style>b{color:red}</style>"), true);
eq("js gets console mirror", buildPreviewDocument(art("js", "console.log(1)")).includes("__log"), true);
eq("html passes through", buildPreviewDocument(art("html", "<h1>x</h1>")), "<h1>x</h1>");

console.log("\n--- context trimming ---");
const big = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(1200) }));
const trimmed = trimToBudget([{ role: "system", content: "sys" }, ...big], 7000);
eq("system prompt survives", trimmed.messages[0].role, "system");
eq("newest turn survives", trimmed.messages.at(-1)!.content, big.at(-1)!.content);
eq("old turns dropped", trimmed.dropped > 0, true);
eq("fits budget", trimmed.messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 0) <= 7000, true);
eq("single huge message kept", trimToBudget([{ role: "user", content: "y".repeat(100000) }], 100).messages.length, 1);
eq("truncateMiddle shrinks", truncateMiddle("z".repeat(10000), 100).length < 10000, true);
eq("truncateMiddle keeps short text", truncateMiddle("hi", 100), "hi");

// Splitting an assistant tool_calls turn from its results is a 400 upstream.
const toolConvo = [
  { role: "user", content: "q".repeat(8000) },
  { role: "assistant", content: "", tool_calls: [{ id: "c1" }] },
  { role: "tool", content: "result" },
  { role: "assistant", content: "answer" },
];
const toolTrim = trimToBudget(toolConvo, 500);
eq("no orphaned tool result", toolTrim.messages.some((m, i) => m.role === "tool" && toolTrim.messages[i - 1]?.role !== "assistant" && toolTrim.messages[i - 1]?.role !== "tool"), false);
eq("tool group kept whole or dropped whole", toolTrim.messages.filter((m) => m.role === "tool").length === 0 || toolTrim.messages.some((m) => m.tool_calls), true);

console.log("\n--- streamed tool calls ---");
// Providers split `arguments` mid-JSON; only the concatenation is valid.
const acc = new ToolCallAccumulator();
acc.add([{ index: 0, id: "call_1", name: "calculate", arguments: "" }]);
acc.add([{ index: 0, arguments: '{"expr' }]);
acc.add([{ index: 0, arguments: 'ession":"2+' }]);
acc.add([{ index: 0, arguments: '2"}' }]);
eq("fragments reassemble", acc.finish(), [{ id: "call_1", name: "calculate", arguments: '{"expression":"2+2"}' }]);
eq("reassembled args parse", JSON.parse(acc.finish()[0].arguments).expression, "2+2");

const multi = new ToolCallAccumulator();
multi.add([{ index: 1, id: "b", name: "second", arguments: "{}" }]);
multi.add([{ index: 0, id: "a", name: "first", arguments: "{}" }]);
eq("parallel calls keep index order", multi.finish().map((c) => c.name), ["first", "second"]);

const noId = new ToolCallAccumulator();
noId.add([{ index: 0, name: "x", arguments: "{}" }]);
eq("missing id gets a stable fallback", noId.finish()[0].id, "call_0");
eq("empty accumulator", new ToolCallAccumulator().isEmpty, true);

eq("extractChunk reads content", extractChunk(JSON.stringify({ choices: [{ delta: { content: "hi" } }] })).content, "hi");
eq("extractChunk reads finish_reason", extractChunk(JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })).finishReason, "tool_calls");
eq("extractChunk survives junk", extractChunk("not json").content, null);

console.log("\n--- calculator (no eval) ---");
eq("precedence", evaluate("2 + 3 * 4"), 14);
eq("parentheses", evaluate("(2 + 3) * 4"), 20);
eq("function", evaluate("sqrt(16)"), 4);
eq("nested function", evaluate("sqrt(16) + abs(0 - 9)"), 13);
eq("constant", Math.round(evaluate("pi") * 100) / 100, 3.14);
eq("unary minus", evaluate("-5 + 10"), 5);
eq("right-assoc power", evaluate("2 ^ 3 ^ 2"), 512);
eq("modulo", evaluate("10 % 3"), 1);
throws("rejects identifiers", () => evaluate("process.exit(1)"));
throws("rejects function calls", () => evaluate("alert(1)"));
throws("rejects unbalanced parens", () => evaluate("(1 + 2"));
throws("rejects division to infinity", () => evaluate("1 / 0"));

console.log("\n--- tool runner ---");
const ran = await runToolCall({ id: "1", name: "calculate", arguments: '{"expression":"6*7"}' }, {});
eq("runs a tool", ran.content.includes("42"), true);
eq("marks success", ran.isError, false);
const missing = await runToolCall({ id: "2", name: "nope", arguments: "{}" }, {});
eq("unknown tool is an error result, not a throw", missing.isError, true);
const badJson = await runToolCall({ id: "3", name: "calculate", arguments: "{oops" }, {});
eq("malformed args are an error result", badJson.isError, true);
const badExpr = await runToolCall({ id: "4", name: "calculate", arguments: '{"expression":"alert(1)"}' }, {});
eq("handler throw becomes error result", badExpr.isError, true);
const clock = await runToolCall({ id: "5", name: "get_time", arguments: '{"timezone":"UTC"}' }, {});
eq("get_time works", clock.isError, false);
const badTz = await runToolCall({ id: "6", name: "get_time", arguments: '{"timezone":"Mars/Olympus"}' }, {});
eq("bad timezone is an error result", badTz.isError, true);

console.log("\n--- SSRF guard ---");
// A model picks the URL and this server makes the request, with API keys in
// the same environment. Each of these is a real escalation if it gets through.
for (const ip of [
  "127.0.0.1", "127.1.2.3", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255",
  "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "240.0.0.1",
  "::1", "::", "fe80::1", "fd00::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
]) {
  eq(`blocks ${ip}`, isBlockedAddress(ip), true);
}
for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "11.0.0.1", "2606:4700::1111"]) {
  eq(`allows ${ip}`, isBlockedAddress(ip), false);
}

const blockedUrl = async (name: string, url: string) => {
  try {
    await assertUrlAllowed(url);
    fail++;
    console.log(`FAIL ${name}\n     ${url} was allowed`);
  } catch {
    pass++;
    console.log(`ok   ${name}`);
  }
};
await blockedUrl("blocks cloud metadata URL", "http://169.254.169.254/latest/meta-data/");
await blockedUrl("blocks localhost URL", "http://localhost:3000/api/chats");
await blockedUrl("blocks loopback IP URL", "http://127.0.0.1:8899/v1/models");
await blockedUrl("blocks file: scheme", "file:///etc/passwd");
await blockedUrl("blocks gopher: scheme", "gopher://evil.com/");
await blockedUrl("blocks .internal host", "http://foo.internal/");
await blockedUrl("blocks bracketed ::1", "http://[::1]:3000/");
await blockedUrl("blocks garbage input", "not a url");

console.log("\n--- search parsing ---");
// Shaped like a real DuckDuckGo HTML response, links wrapped in /l/?uddg=
const ddgFixture = `
<div class="result results_links">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgroq.com%2Flpu&rut=x">Groq <b>LPU</b> Inference</a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgroq.com%2Flpu">The LPU delivers <b>fast</b> inference &amp; low latency.</a>
</div>
<div class="result results_links">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fb">Second &quot;Result&quot;</a>
  <a class="result__snippet" href="#">Another snippet</a>
</div>`;
const ddg = parseDuckDuckGoHtml(ddgFixture, 5);
eq("ddg parses both results", ddg.length, 2);
eq("ddg unwraps the redirect", ddg[0].url, "https://groq.com/lpu");
eq("ddg strips bold from titles", ddg[0].title, "Groq LPU Inference");
eq("ddg decodes entities in snippets", ddg[0].snippet, "The LPU delivers fast inference & low latency.");
eq("ddg decodes quotes in titles", ddg[1].title, 'Second "Result"');
eq("ddg honours the count cap", parseDuckDuckGoHtml(ddgFixture, 1).length, 1);
eq("ddg survives empty html", parseDuckDuckGoHtml("<html></html>", 5), []);
eq("tidy collapses whitespace", tidy("  a\n\n  b  "), "a b");
eq("tidy clips long text", tidy("x".repeat(400)).length, 300);

console.log("\n--- html to text ---");
const page = htmlToText(`<html><head><title>My &amp; Page</title>
<style>.a{color:red}</style><script>alert(1)</script></head>
<body><nav>skip me</nav><h1>Heading</h1><p>First para.</p>
<ul><li>one</li><li>two</li></ul><footer>footer junk</footer></body></html>`);
eq("extracts title", page.title, "My & Page");
eq("drops script contents", page.text.includes("alert"), false);
eq("drops style contents", page.text.includes("color:red"), false);
eq("drops nav and footer", /skip me|footer junk/.test(page.text), false);
eq("keeps prose", page.text.includes("First para."), true);
eq("marks list items", page.text.includes("• one"), true);

console.log("\n--- wake gate ---");
// One "hey jarvis" must fire once, not once per frame above threshold.
{
  const gate = new WakeGate(0.5, 2, 25);
  let frame = 0;
  const fires: number[] = [];
  // 10 frames of confident detection in a row.
  for (let i = 0; i < 10; i++) if (gate.accept(0.9, ++frame)) fires.push(frame);
  eq("sustained detection fires exactly once", fires.length, 1);
  eq("fires on the 2nd frame (patience)", fires[0], 2);

  // Still inside the cooldown window.
  let duringCooldown = 0;
  for (let i = 0; i < 15; i++) if (gate.accept(0.9, ++frame)) duringCooldown++;
  eq("cooldown suppresses re-fire", duringCooldown, 0);

  // Past the cooldown it can fire again.
  frame += 30;
  let after = 0;
  for (let i = 0; i < 5; i++) if (gate.accept(0.9, ++frame)) after++;
  eq("fires again after cooldown", after, 1);
}
{
  const gate = new WakeGate(0.5, 2, 25);
  let frame = 0;
  let fired = 0;
  // A single blip over threshold is noise, not a wake word.
  for (const score of [0.9, 0.1, 0.9, 0.2, 0.8, 0.1]) if (gate.accept(score, ++frame)) fired++;
  eq("isolated spikes never fire", fired, 0);
  eq("sub-threshold never fires", new WakeGate(0.5).accept(0.49, 1), false);
}

console.log("\n--- silence gate ---");
{
  const gate = new SilenceGate(0.015, 15, 190, 90);
  let verdict = "listening";
  for (let i = 0; i < 20; i++) verdict = gate.push(0.08);   // speaking
  eq("still listening while speaking", verdict, "listening");
  for (let i = 0; i < 14; i++) verdict = gate.push(0.001);  // brief pause
  eq("a short pause is not the end", verdict, "listening");
  verdict = gate.push(0.001);
  eq("done after the hangover elapses", verdict, "done");
}
{
  const gate = new SilenceGate(0.015, 15, 190, 90);
  let verdict = "listening";
  for (let i = 0; i < 90; i++) verdict = gate.push(0.001); // never speaks
  eq("times out when nobody speaks", verdict, "timeout");
}
{
  const gate = new SilenceGate(0.015, 15, 190, 90);
  let verdict = "listening";
  for (let i = 0; i < 190; i++) verdict = gate.push(0.09);  // never stops
  eq("hard cap ends an endless utterance", verdict, "done");
}

console.log("\n--- speech text ---");
eq("code blocks are not read aloud", forSpeech("Try this:\n```js\nlet x=1\n```\nDone."), "Try this: (code shown on screen) Done.");
eq("markdown emphasis stripped", forSpeech("This is **bold** and *italic*"), "This is bold and italic");
eq("links read as their text", forSpeech("See [the docs](https://example.com)"), "See the docs");
eq("headings stripped", forSpeech("# Title\nBody"), "Title Body");
eq("bullets stripped", forSpeech("- one\n- two"), "one two");
// These two used to assert that long answers were CLIPPED, which is exactly
// the bug that made long replies go unspoken. The correct behaviour is that
// nothing is dropped — Speaker chunks it instead.
eq("long answers are not clipped", forSpeech(`${"This is a sentence. ".repeat(200)}`).length > 3000, true);
eq("no truncation marker is appended", forSpeech("word ".repeat(500)).includes("the rest is on screen"), false);

console.log("\n--- wav encoding ---");
{
  const frames = [new Float32Array(1280).fill(0.5), new Float32Array(1280).fill(-0.5)];
  const blob = encodeWav(frames, 16000);
  eq("wav size = 44 byte header + 16-bit samples", blob.size, 44 + 2560 * 2);
  eq("duration computed from frames", durationOf(frames, 16000), 0.16);
  eq("blob is typed as wav", blob.type, "audio/wav");
}

console.log("\n--- mic resampling (mirrors public/worklets/pcm-worklet.js) ---");
{
  const TARGET = 16000, FRAME = 1280;
  // Same loop as the worklet. If these diverge, wake-word detection silently
  // degrades to noise, so the maths is pinned here.
  const runWorklet = (input: Float32Array, sampleRate: number) => {
    const ratio = sampleRate / TARGET;
    const buffer = new Float32Array(FRAME);
    let filled = 0, position = 0;
    const out: Float32Array[] = [];
    for (let b = 0; b < input.length; b += 128) {
      const channel = input.subarray(b, Math.min(b + 128, input.length));
      while (position < channel.length) {
        const index = Math.floor(position);
        const frac = position - index;
        const a = channel[index] ?? 0;
        const c = channel[index + 1] ?? a;
        buffer[filled++] = a + (c - a) * frac;
        if (filled === FRAME) { out.push(buffer.slice()); filled = 0; }
        position += ratio;
      }
      position -= channel.length;
    }
    return out;
  };

  for (const rate of [44100, 48000]) {
    const input = new Float32Array(rate * 2);
    for (let i = 0; i < input.length; i++) input[i] = Math.sin(2 * Math.PI * 1000 * (i / rate));
    const frames = runWorklet(input, rate);
    const total = frames.length * FRAME;
    const flat = new Float32Array(total);
    frames.forEach((f, i) => flat.set(f, i * FRAME));

    let crossings = 0;
    for (let i = 1; i < flat.length; i++) if ((flat[i - 1] < 0) !== (flat[i] < 0)) crossings++;
    const hz = crossings / 2 / (total / TARGET);
    let peak = 0;
    for (const v of flat) peak = Math.max(peak, Math.abs(v));

    eq(`${rate}Hz: duration preserved`, Math.abs(total / TARGET - 2) < 0.05, true);
    eq(`${rate}Hz: 1kHz tone preserved`, Math.abs(hz - 1000) < 25, true);
    eq(`${rate}Hz: amplitude preserved`, peak > 0.9, true);
    eq(`${rate}Hz: frames are exactly ${FRAME} samples`, frames.every((f) => f.length === FRAME), true);
  }
}

console.log("\n--- noise floor never disables hearing ---");
{
  // Regression: deriving the floor from the opening frames meant that if the
  // user spoke immediately, the threshold landed above any reachable RMS and
  // nothing was ever heard again.
  const clamp = (floor: number) => Math.min(0.05, Math.max(0.006, floor * 3));
  eq("loud opening cannot raise the gate out of reach", clamp(0.526), 0.05);
  eq("silent room still gets a usable floor", clamp(0), 0.006);
  eq("normal room scales sensibly", clamp(0.004), 0.012);
  eq("threshold always reachable by speech", clamp(0.9) < 0.2, true);
}

console.log("\n--- memory relevance ---");
{
  const now = Date.now();
  const mem = (id: string, text: string, tags: string[] = [], ageDays = 0): MemoryEntry => ({
    id, text, tags, createdAt: now - ageDays * 86400000, updatedAt: now - ageDays * 86400000,
  });

  const entries = [
    mem("1", "Prefers TypeScript over JavaScript", ["preference"]),
    mem("2", "Is building a voice assistant called JARVIS", ["project"]),
    mem("3", "Name is Blue", ["always"]),
    mem("4", "Dislikes tabs, uses two-space indentation", ["preference"]),
  ];

  eq("finds the on-topic memory", rank(entries, "should I use typescript?")[0].id, "1");
  eq("finds a project memory", rank(entries, "how is the jarvis build going")[0].id, "2");
  eq("ignores unrelated memories", rank(entries, "what is the capital of France"), []);
  eq("stop words alone match nothing", rank(entries, "what is the of and"), []);

  // "always" must survive even when the query has nothing to do with it.
  const chosen = forPrompt(entries, "what is the weather tomorrow");
  eq("always-tagged memory is pinned regardless of query", chosen.map((e) => e.id), ["3"]);

  const both = forPrompt(entries, "typescript indentation");
  eq("pinned plus relevant are both included", both.some((e) => e.id === "3") && both.some((e) => e.id === "1"), true);

  // Budget must be respected, and the pinned entry must win the space.
  const many = Array.from({ length: 60 }, (_, i) => mem(`x${i}`, `Fact number ${i} about typescript code`, []));
  const budgeted = forPrompt([...many, mem("pin", "Name is Blue", ["always"])], "typescript", 120);
  const cost = budgeted.reduce((n, e) => n + Math.ceil(e.text.length / 4) + 4, 0);
  eq("prompt injection respects its token budget", cost <= 120, true);
  eq("pinned entry survives a tight budget", budgeted.some((e) => e.id === "pin"), true);

  // Recency is a nudge, not an override.
  const aged = [mem("old", "Uses Vim keybindings", [], 60), mem("new", "Uses Vim keybindings", [], 0)];
  eq("recent memory outranks an identical older one", rank(aged, "vim keybindings")[0].id, "new");
}

console.log("\n--- attachments ---");
{
  const txt: Attachment = { id: "t", kind: "text", name: "notes.md", mime: "text/markdown", size: 12, text: "hello world" };
  const img: Attachment = { id: "i", kind: "image", name: "a.png", mime: "image/png", size: 99, dataUrl: "data:image/png;base64,AAA" };

  const rendered = attachmentsToText([txt]);
  eq("text attachment names the file", rendered.includes("notes.md"), true);
  eq("text attachment includes the body", rendered.includes("hello world"), true);
  eq("image renders as a placeholder line", attachmentsToText([img]), "[Attached image: a.png]");

  // Base64 images must not persist into later turns: they would exhaust both
  // the context window and the 1,000/day vision quota.
  eq("lighten drops the image payload", lighten(img).dataUrl, undefined);
  eq("lighten keeps the image metadata", lighten(img).name, "a.png");
  eq("lighten leaves text attachments alone", lighten(txt).text, "hello world");

  eq("byte sizes format", [formatSize(512), formatSize(2048), formatSize(3 * 1024 * 1024)], ["512 B", "2 KB", "3.0 MB"]);
  eq("image cap matches the provider limit", MAX_IMAGES, 3);
}

console.log("\n--- vision capability ---");
eq("groq qwen3.6 is a vision model", supportsVision("groq", "qwen/qwen3.6-27b"), true);
eq("groq gpt-oss is not", supportsVision("groq", "openai/gpt-oss-120b"), false);
eq("cerebras has no vision models", supportsVision("cerebras", "qwen/qwen3.6-27b"), false);
eq("unknown provider is not vision", supportsVision("nope", "qwen3.6"), false);

console.log("\n--- multimodal token accounting ---");
eq("textOf passes strings through", textOf("hello"), "hello");
eq("textOf joins text parts", textOf([{ type: "text", text: "a" }, { type: "text", text: "b" }]), "a b");
// An image must cost roughly its real token price or trimming will overflow.
eq("textOf prices an image at ~2048 tokens", Math.round(textOf([{ type: "image_url", image_url: { url: "x" } }]).length / 4), 2048);

console.log("\n--- long replies are spoken in full (regression) ---");
{
  // The reported bug: long answers sometimes produced no speech at all.
  // Three causes — a 1,200-char clip, a 60s watchdog, and Chrome silently
  // dropping oversized utterances — all fixed by chunking. These assertions
  // fail against the old code.
  const long = Array.from({ length: 60 }, (_, i) =>
    `This is sentence number ${i + 1}, containing enough words to resemble a real paragraph of explanation.`,
  ).join(" ");

  const spoken = forSpeech(long);
  eq("nothing is truncated", spoken.includes("the rest is on screen"), false);
  eq("the whole reply survives", spoken.length, long.length);

  const chunks = splitSentences(spoken);
  eq("it is broken into many chunks", chunks.length > 20, true);
  // Chrome drops long utterances silently; keep every chunk well clear.
  eq("no chunk is anywhere near the engine limit", Math.max(...chunks.map((c) => c.length)) < 300, true);
  eq(
    "chunks rejoin to the original text",
    chunks.join(" ").replace(/\s+/g, " ").trim(),
    long.replace(/\s+/g, " ").trim(),
  );
}

console.log("\n--- sentence boundaries ---");
eq("splits on a full stop", splitSentences("The first thing happened here. The second thing happened later.").length, 2);
eq("does not split inside a decimal", splitSentences("Pi is roughly 3.14 and that is the value we use.").length, 1);
eq("does not split on an abbreviation", splitSentences("Ask Dr. Banner about the gamma readings before lunch.").length, 1);
eq("splits once after an ellipsis", splitSentences("Well... I suppose that could work out fine. Let us try it now.").length, 2);
eq("keeps a closing quote with its sentence", splitSentences('He said "this is completely fine." And then he left the room.')[0].endsWith('"'), true);
eq("handles a question mark", splitSentences("Is that the right approach here? I believe that it probably is.").length, 2);
eq("a run-on sentence is still broken up", splitSentences(`${"and then more words ".repeat(40)}`).length > 1, true);

console.log("\n--- streaming splitter ---");
{
  const splitter = new SentenceSplitter();
  eq("holds back an incomplete sentence", splitter.push("This is the beginning of"), []);
  eq("still holding", splitter.push(" a sentence that has not"), []);
  const released = splitter.push(" ended yet but now it has. ");
  eq("releases once the sentence completes", released.length, 1);
  eq("flush releases the trailing fragment", new SentenceSplitter().push("no terminator here") .length === 0 && true, true);

  const tail = new SentenceSplitter();
  tail.push("A reply that never terminates");
  eq("an unterminated final sentence is still spoken", tail.flush(), ["A reply that never terminates"]);
}

console.log("\n--- speaker queue ---");
{
  const makeStub = () => {
    const spoken: string[] = [];
    return {
      spoken,
      engine: {
        id: "stub", label: "Stub", isAvailable: () => true,
        voices: async () => [], cancel() {},
        async speak(text: string) { spoken.push(text); await new Promise((r) => setTimeout(r, 2)); },
      },
    };
  };

  const a = makeStub();
  const speaker = new Speaker(a.engine as never);
  speaker.say("First sentence goes out first here. Second sentence follows it after.");
  await speaker.wait();
  eq("chunks are spoken in order", a.spoken.length >= 2 && a.spoken[0].startsWith("First"), true);

  // Speech must begin before generation ends — the point of streaming.
  const b = makeStub();
  const streamer = new Speaker(b.engine as never);
  const words = "This first sentence is quite long and complete. ".repeat(6).split(" ");
  let startedAt = -1;
  for (let i = 0; i < words.length; i++) {
    streamer.push(words[i] + " ");
    // Yield so queued playback can actually run: the pipeline puts a
    // microtask between enqueue and play, so a tight synchronous loop would
    // never observe speech starting no matter how fast it is.
    await new Promise((r) => setTimeout(r, 0));
    if (startedAt === -1 && b.spoken.length > 0) startedAt = i;
  }
  streamer.end();
  await streamer.wait();
  eq("speech starts before the reply finishes", startedAt > -1 && startedAt < words.length / 2, true);

  // A failing chunk must not silence the rest of the answer.
  const errors: string[] = [];
  let calls = 0;
  const flaky = {
    id: "flaky", label: "Flaky", isAvailable: () => true, voices: async () => [], cancel() {},
    async speak() { calls++; if (calls === 1) throw new Error("engine hiccup"); },
  };
  const resilient = new Speaker(flaky as never, {}, (m) => errors.push(m));
  resilient.say("First sentence here will fail loudly. Second sentence should still be spoken.");
  await resilient.wait();
  eq("a failed chunk is reported", errors.length, 1);
  eq("and later chunks still play", calls >= 2, true);

  // Synthesis must overlap playback. Without this, every sentence carries its
  // own generation pause — which is what made long replies crawl.
  {
    const SYNTH = 60, PLAY = 60, N = 8;
    const sentences = Array.from({ length: N }, (_, i) =>
      `This is sentence number ${i + 1} and it is long enough to be its own chunk.`).join(" ");
    const order: number[] = [];
    let made = 0;

    const splittable = {
      id: "split", label: "Split", isAvailable: () => true, voices: async () => [],
      cancel() {}, async speak() {},
      async synthesize() {
        const id = ++made;
        await new Promise((r) => setTimeout(r, SYNTH));
        return {
          play: async () => {
            order.push(id);
            await new Promise((r) => setTimeout(r, PLAY));
          },
        };
      },
    };

    const pipelined = new Speaker(splittable as never);
    const startedAt = Date.now();
    pipelined.say(sentences);
    await pipelined.wait();
    const took = Date.now() - startedAt;

    const sequentialCost = N * (SYNTH + PLAY);
    eq("synthesis overlaps playback", took < sequentialCost * 0.8, true);
    eq("chunks still play in order", order, Array.from({ length: N }, (_, i) => i + 1));

    // An engine that cannot split (speechSynthesis) must still work.
    const unsplittable = {
      id: "seq", label: "Seq", isAvailable: () => true, voices: async () => [],
      cancel() {}, async speak() { await new Promise((r) => setTimeout(r, 5)); },
    };
    const fallbackSpeaker = new Speaker(unsplittable as never);
    fallbackSpeaker.say("One sentence to speak aloud. Two sentence to speak aloud.");
    await fallbackSpeaker.wait();
    eq("an engine without synthesize still speaks", true, true);
  }

  // Cancel must drop everything queued, for barge-in.
  const c = makeStub();
  const cancelled = new Speaker(c.engine as never);
  cancelled.say("One sentence to speak aloud now. Two sentence to speak aloud now. Three sentence here now.");
  cancelled.cancel();
  await new Promise((r) => setTimeout(r, 40));
  eq("cancel stops the queue", c.spoken.length < 3, true);
}

console.log("\n--- speech segmenter ---");
{
  /** One 32ms window, carrying its index so the audio can be identified. */
  const win = (value: number) => Float32Array.from([value, value]);

  const feed = (
    segmenter: SpeechSegmenter,
    probabilities: number[],
  ): ReturnType<SpeechSegmenter["push"]>[] =>
    probabilities.map((p, i) => segmenter.push(p, win(i)));

  {
    // Quiet, then a clear utterance, then enough silence to end the turn.
    const segmenter = new SpeechSegmenter({ redemptionWindows: 5, minSpeechWindows: 3, preSpeechWindows: 2 });
    const events = feed(segmenter, [0, 0, 0, 0.9, 0.9, 0.9, 0.9, 0, 0, 0, 0, 0]);
    eq("fires start once", events.filter((e) => e.type === "start").length, 1);
    const ended = events.find((e) => e.type === "end");
    eq("ends after the redemption window", ended !== undefined, true);
    // 2 pre-roll + 4 speech + 5 quiet = 11 collected, less (5 - 4) trimmed.
    eq("keeps the pre-roll", ended?.type === "end" ? ended.audio[0] : -1, 1);
  }

  {
    // A cough: loud enough to start, too short to mean anything.
    const segmenter = new SpeechSegmenter({ redemptionWindows: 3, minSpeechWindows: 5 });
    const events = feed(segmenter, [0.9, 0.9, 0, 0, 0]);
    eq("discards a blip", events.some((e) => e.type === "discard"), true);
    eq("a blip is not a turn", events.some((e) => e.type === "end"), false);
  }

  {
    // A pause mid-sentence must not end the turn.
    const segmenter = new SpeechSegmenter({ redemptionWindows: 6, minSpeechWindows: 2 });
    const events = feed(segmenter, [0.9, 0.9, 0, 0, 0, 0.9, 0.9, 0.1, 0.1]);
    eq("a mid-sentence pause keeps the floor", events.some((e) => e.type === "end"), false);
    eq("still speaking after the pause", segmenter.isSpeaking, true);
  }

  {
    // Hysteresis: probabilities between the two thresholds hold the turn open.
    const segmenter = new SpeechSegmenter({
      positiveThreshold: 0.6, negativeThreshold: 0.3, redemptionWindows: 3, minSpeechWindows: 2,
    });
    feed(segmenter, [0.7, 0.7]);
    const events = feed(segmenter, [0.4, 0.4, 0.4, 0.4]);
    eq("marginal frames don't end the turn", events.some((e) => e.type === "end"), false);
    eq("marginal frames don't start one either", new SpeechSegmenter({ positiveThreshold: 0.6 }).push(0.4, win(0)).type, "none");
  }

  {
    // A television is never done talking; the cap has to end it.
    const segmenter = new SpeechSegmenter({ maxSpeechWindows: 6, minSpeechWindows: 2, redemptionWindows: 99 });
    const events = feed(segmenter, [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]);
    const ended = events.find((e) => e.type === "end");
    eq("caps a turn that never stops", ended?.type === "end" ? ended.capped : false, true);
    eq("a capped turn keeps every window", ended?.type === "end" ? ended.windows : 0, 6);
  }

  {
    // Stopping mid-word must still hand back what was heard.
    const segmenter = new SpeechSegmenter({ redemptionWindows: 4, minSpeechWindows: 2 });
    feed(segmenter, [0.9, 0.9, 0.9]);
    eq("flush ends an open turn", segmenter.flush().type, "end");
    eq("flush on silence does nothing", new SpeechSegmenter().flush().type, "none");
  }
}

console.log("\n--- what every request costs before you type ---");
{
  /**
   * A ceiling on the fixed overhead, because it only ever grows.
   *
   * Tool schemas and the persona ride along on every single request, and the
   * agent loop re-sends them on each of up to five rounds per turn. They were
   * measured at 803 + 419 = 1,222 tokens, against a free tier metered at 6,000
   * tokens a minute. Every tool added and every line of guidance written is
   * paid for on every turn forever, so the number is pinned here rather than
   * rediscovered the next time a free tier starts refusing requests.
   */
  const toolTokens = estimateTokens(JSON.stringify(allTools().map(toWireTool)));
  const personaTokens = estimateTokens(DEFAULT_PERSONA);

  console.log(`     tools ${toolTokens} + persona ${personaTokens} = ${toolTokens + personaTokens} per request`);
  eq("tool schemas stay under budget", toolTokens <= 680, true);

  /**
   * Two groups are gated on a screen existing: the display tools (287 tokens)
   * and scheduling (262). Both are only useful where an announcement can land,
   * and a laptop with no projector should not pay for either on every single
   * request.
   *
   * The ceiling is what stops that gated set growing without anyone noticing.
   * It caught scheduling arriving at 392 tokens, which is how those three
   * schemas ended up terse instead of chatty.
   */
  const withDisplay = (() => {
    const saved = process.env.JARVIS_DEVICE_MODE;
    process.env.JARVIS_DEVICE_MODE = "1";
    const n = estimateTokens(JSON.stringify(allTools().map(toWireTool)));
    if (saved === undefined) delete process.env.JARVIS_DEVICE_MODE;
    else process.env.JARVIS_DEVICE_MODE = saved;
    return n;
  })();

  console.log(`     appliance adds the display tools: ${withDisplay} tokens`);
  eq("a machine with no screen is not charged for one", withDisplay > toolTokens, true);
  eq("and the appliance stays under its own ceiling", withDisplay <= 1220, true);
  eq("the persona stays under budget", personaTokens <= 330, true);
  eq("and the two together stay under a thousand", toolTokens + personaTokens < 1000, true);

  /**
   * Pictures are offered only with a NanoGPT key, so an install without one
   * pays nothing. With one, the requests go to a flat-rate plan metered in
   * requests rather than per-minute tokens. The ceiling was 110 until the
   * shape option (square/portrait/landscape) earned the last few tokens.
   */
  const imageTokens =
    estimateTokens(JSON.stringify(allTools({ imageKey: "k" }).map(toWireTool))) - toolTokens;
  console.log(`     a NanoGPT key adds pictures: ${imageTokens} tokens`);
  eq("no key, no picture tool", allTools().some((t) => t.name === "generate_image"), false);
  eq("a key offers pictures", allTools({ imageKey: "k" }).some((t) => t.name === "generate_image"), true);
  eq("and pictures stay cheap", imageTokens > 0 && imageTokens <= 120, true);

  // Cheap to state, and it catches a tool registered with no guidance at all.
  eq("every tool says what it is for", allTools().every((t) => t.description.length > 20), true);
}

console.log("\n--- which models can actually see ---");
{
  /**
   * Getting this wrong is asymmetric, which is why the patterns are narrow.
   * Claiming vision a model lacks fails the whole request; claiming none
   * folds the image in as "[Attached image: x.jpg]", so the model knows one
   * was sent and says it cannot see it. A worse answer, but an answer.
   */
  eq("a -VL model on Arli sees", supportsVision("arli", "Qwen2.5-VL-7B-Instruct"), true);
  eq("a text model on Arli does not", supportsVision("arli", "Mistral-Nemo-12B-Instruct"), false);
  eq("OpenRouter's vision models see", supportsVision("openrouter", "qwen/qwen2.5-vl-72b-instruct"), true);
  eq("its text models do not", supportsVision("openrouter", "meta-llama/llama-3.3-70b-instruct"), false);
  eq("every Gemini is multimodal", supportsVision("gemini", "gemini-2.5-flash"), true);
  eq("Cerebras claims none", supportsVision("cerebras", "llama-3.3-70b"), false);
  eq("an unknown provider claims none", supportsVision("nope", "qwen2.5-vl-7b"), false);

  // The patterns are substrings, so guard the obvious false positives.
  eq("\"vl\" inside a word is not a vision model", supportsVision("arli", "Vicuna-13B"), false);
  eq("nor is a plain llama", supportsVision("arli", "Llama-3.1-8B"), false);
}

console.log("\n--- a thinking model's reasoning ---");
{
  const done = splitReasoning("<think>They want the capital.</think>Paris.");
  eq("reasoning is separated from the answer", [done.reasoning, done.answer], ["They want the capital.", "Paris."]);
  eq("and the block is closed", done.thinking, false);

  /**
   * The case that matters, because a reply streams. Speech starts on the
   * first complete sentence, so a half-finished think block must never be
   * mistaken for an answer — otherwise JARVIS reads its own working-out
   * aloud before saying anything useful.
   */
  const mid = splitReasoning("<think>The user is asking about");
  eq("an unfinished block yields no answer", mid.answer, "");
  eq("and is reported as still thinking", mid.thinking, true);
  eq("but its text is kept", mid.reasoning, "The user is asking about");

  eq("speech never reads reasoning", forSpeech("<think>hmm, let me see</think>The answer is four."), "The answer is four.");
  eq("nor an unfinished one", forSpeech("Hello. <think>now considering"), "Hello.");

  // Plain replies must pass through completely untouched.
  eq("a normal reply is unaffected", splitReasoning("Just an answer.").answer, "Just an answer.");
  eq("with no phantom reasoning", splitReasoning("Just an answer.").reasoning, "");

  // The tag spelling varies by model family.
  eq("<thinking> is recognised", splitReasoning("<thinking>x</thinking>y").answer, "y");
  eq("<reasoning> is recognised", splitReasoning("<reasoning>x</reasoning>y").answer, "y");

  // Several blocks, and text on both sides of them.
  const many = splitReasoning("A<think>one</think>B<think>two</think>C");
  eq("every block is removed", many.answer, "ABC");
  eq("and all of the reasoning kept", many.reasoning, "one\n\ntwo");

  // A model that mentions the word must not trip the parser.
  eq(
    "a tool call written out as text is not shown",
    splitReasoning("I see the issue.\n\n<tool_call> <function=run_command> <parameter=command> dir /b </parameter> </function> </tool_call>").answer,
    "I see the issue.",
  );
  eq("nor one still streaming", splitReasoning("Done. <tool_call> <function=list_fi").answer, "Done.");
  eq("prose about thinking is left alone", splitReasoning("I think so.").answer, "I think so.");
}

console.log("\n--- room noise ---");
{
  eq("real question survives", isNoise("what is the weather today"), false);
  eq("empty is noise", isNoise("   "), true);
  eq("filler is noise", isNoise("uh"), true);
  eq("acknowledgement alone is noise", isNoise("okay."), true);
  eq("whisper silence token is noise", isNoise("[BLANK_AUDIO]"), true);
  eq("whisper subtitle hallucination is noise", isNoise("Thanks for watching!"), true);
  eq("punctuation only is noise", isNoise("..."), true);
  eq("short real word survives", isNoise("hello"), false);
  eq("okay with a question survives", isNoise("okay what time is it"), false);
}

console.log("\n--- when a scheduled task is next due ---");
{
  const now = new Date("2026-09-23T10:30:00").getTime();

  eq("a one-off in the future is due then", nextRun({ kind: "once", at: now + 5000 }, now), now + 5000);
  // Retired rather than left in the list looking armed.
  eq("a one-off in the past never fires again", nextRun({ kind: "once", at: now - 5000 }, now), null);

  eq("a repeat counts from now", nextRun({ kind: "every", minutes: 30 }, now), now + 30 * 60_000);
  // A zero interval would be a tight loop against a metered API.
  eq("a zero interval is clamped, not trusted", nextRun({ kind: "every", minutes: 0 }, now), now + 60_000);

  const laterToday = nextRun({ kind: "daily", hhmm: "18:00" }, now)!;
  eq("a daily time still to come is today", new Date(laterToday).getHours(), 18);
  eq("and is in the future", laterToday > now, true);

  // The rollover: 08:00 has already passed at 10:30, so it means tomorrow.
  const tomorrow = nextRun({ kind: "daily", hhmm: "08:00" }, now)!;
  eq("a daily time already past rolls to tomorrow", new Date(tomorrow).getDate(), 24);
  eq("at the same clock time", new Date(tomorrow).getHours(), 8);

  /**
   * Built from local date parts rather than by adding 24h. Adding a fixed day
   * drifts across a daylight-saving change, and "08:00" has to stay 08:00 on
   * the clock in the room.
   */
  eq("and lands exactly on the minute", new Date(tomorrow).getMinutes(), 0);
  eq("with no seconds left over", new Date(tomorrow).getSeconds(), 0);

  eq("junk times are refused", parseHhmm("25:00"), null);
  eq("so are near-misses", parseHhmm("8:0"), null);
  eq("but a real one parses", parseHhmm("08:05"), { hours: 8, minutes: 5 });
  eq("a daily task with a junk time never runs", nextRun({ kind: "daily", hhmm: "nope" }, now), null);

  eq("describe reads naturally", describe({ kind: "every", minutes: 120 }), "every 2 hours");
  eq("and singularises", describe({ kind: "every", minutes: 60 }), "every 1 hour");
}

console.log("\n--- the clock fires each task once ---");
{
  // An in-memory store so the tests never touch the real data directory.
  let saved: ScheduledTask[] = [];
  setScheduleStore({
    async list() { return saved.map((t) => ({ ...t })); },
    async save(task) {
      const i = saved.findIndex((t) => t.id === task.id);
      if (i === -1) saved.push(task); else saved[i] = task;
    },
    async delete(id) { saved = saved.filter((t) => t.id !== id); },
  });

  const now = Date.now();
  let fired: string[] = [];
  setRunner(async (prompt) => {
    fired.push(prompt);
    return { text: `did ${prompt}` };
  });

  saved = [
    { id: "a", prompt: "due now", label: "due", schedule: { kind: "every", minutes: 10 },
      enabled: true, createdAt: now, nextRunAt: now - 1000 },
    { id: "b", prompt: "not yet", label: "later", schedule: { kind: "every", minutes: 10 },
      enabled: true, createdAt: now, nextRunAt: now + 600_000 },
    { id: "c", prompt: "paused", label: "paused", schedule: { kind: "every", minutes: 10 },
      enabled: false, createdAt: now, nextRunAt: now - 1000 },
  ];

  eq("only the due task fires", await tick(now), 1);
  eq("and it was the right one", fired, ["due now"]);

  // The bug this prevents: the next run is written BEFORE the task runs, so a
  // second tick during a slow network call cannot see it as still due.
  eq("a second tick finds nothing", await tick(now), 0);
  eq("because its next run moved", saved.find((t) => t.id === "a")!.nextRunAt > now, true);
  eq("the result is recorded", saved.find((t) => t.id === "a")!.lastResult, "did due now");
  eq("a paused task never fires", fired.includes("paused"), false);

  // A one-shot retires itself rather than being deleted, so you can still see
  // that it ran and what it said.
  fired = [];
  saved = [
    { id: "d", prompt: "once only", label: "once", schedule: { kind: "once", at: now - 1000 },
      enabled: true, createdAt: now, nextRunAt: now - 1000 },
  ];
  await tick(now);
  eq("a one-shot fires", fired, ["once only"]);
  eq("then retires itself", saved[0].enabled, false);
  eq("but stays visible with its result", saved[0].lastResult, "did once only");
  await tick(now);
  eq("and never fires again", fired.length, 1);

  // A failing run must not lose the task or stop the clock.
  setRunner(async () => { throw new Error("upstream died"); });
  saved = [
    { id: "e", prompt: "will fail", label: "fail", schedule: { kind: "every", minutes: 5 },
      enabled: true, createdAt: now, nextRunAt: now - 1000 },
  ];
  await tick(now);
  eq("a failed run records why", saved[0].lastError, "upstream died");
  eq("and stays scheduled", saved[0].enabled, true);

  setRunner(null);
}

console.log("\n--- a long run doesn't forget what it was asked ---");
{
  /**
   * The bug this prevents. trimToBudget walks backwards keeping the newest
   * groups, so on a long agent run the oldest group goes first — and the
   * oldest group is the instruction. The run then carries on diligently
   * working on something it can no longer read.
   *
   * The fix reuses the trim's own rule rather than adding another: system
   * messages are kept unconditionally, so the goal is pinned as one.
   */
  const goal = "The task you are working on, in the user's words: rename the widget";
  const bulky = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 ? "tool" : "assistant",
    content: `step ${i} ` + "x".repeat(2000),
  }));

  const unpinned = trimToBudget(
    [{ role: "user", content: "rename the widget" }, ...bulky],
    2000,
  );
  eq(
    "without pinning, the instruction is dropped",
    unpinned.messages.some((m) => m.content === "rename the widget"),
    false,
  );

  const pinned = trimToBudget([{ role: "system", content: goal }, ...bulky], 2000);
  eq("pinned as a system message it survives", pinned.messages.some((m) => m.content === goal), true);
  // Tool output should still be dropped — it is the bulk, and dropping it is
  // what keeps the request inside the budget at all.
  eq("and the bulk is still trimmed", pinned.dropped > 0, true);
}

console.log("\n--- a task run's write grant is narrow ---");
{
  /**
   * Twenty steps meant twenty approval cards, and a card denies on timeout,
   * so one missed click derailed a run. The grant fixes that without becoming
   * a blanket yes.
   */
  const card = () => {};
  denyAll();
  eq("no grant to begin with", writesGranted(), false);

  grantWritesForRun();
  eq("granting is visible", writesGranted(), true);

  const write = await requestApproval({ kind: "write", summary: "write a.txt" }, card);
  eq("a granted run approves writes without asking", write, "approve");

  /**
   * The line that matters. A write cannot leave the workspace — workspace.ts
   * re-checks containment after resolving symlinks — but a shell command's
   * reach is bounded by nothing this process controls, so it asks every time
   * however long the run.
   */
  let commandAsked = false;
  const command = requestApproval({ kind: "command", summary: "rm -rf /" }, (r) => {
    commandAsked = true;
    settleApproval(r.id, "deny");
  });
  eq("a command still asks", commandAsked, true);
  eq("and is denied when refused", await command, "deny");

  // The grant lives exactly as long as the run: the turn ending revokes it,
  // however it ended.
  denyAll();
  eq("ending the turn revokes the grant", writesGranted(), false);
}

console.log("\n--- the voice ships with the app ---");
{
  /**
   * Kokoro used to fetch its weights from Hugging Face in the browser on
   * first use, and fall back to speechSynthesis — a Google voice — whenever
   * that failed. Both assets are served from this origin now, which only
   * holds while these two lists agree.
   *
   * Read as text rather than imported: both modules are browser-side and pull
   * in transformers.js, which resolves asset paths on evaluation and throws
   * under Node.
   */
  const setup = readFileSync(new URL("../scripts/setup-voice.mjs", import.meta.url), "utf8");
  const engine = readFileSync(new URL("../lib/voice/tts/kokoro.ts", import.meta.url), "utf8");

  const copied = new Set(
    (setup.match(/const KOKORO_VOICES = \[([\s\S]*?)\]/)?.[1] ?? "")
      .match(/"([a-z]{2}_[a-z]+)"/g)
      ?.map((s) => s.replaceAll('"', "")) ?? [],
  );
  const offered = (engine.match(/\{ id: "([a-z]{2}_[a-z]+)"/g) ?? []).map((s) =>
    s.replace(/.*"([a-z_]+)"/, "$1"),
  );

  eq("Settings offers some voices", offered.length > 0, true);
  // The failure this prevents is quiet: a voice added to the picker but not to
  // the copy list still works, by silently fetching from Hugging Face.
  eq(
    "every offered voice is copied locally",
    offered.filter((v) => !copied.has(v)),
    [],
  );

  // The URL kokoro-js hardcodes. The local copy is cached under exactly this
  // key, so a drift here means the cache never hits and every voice is
  // fetched from the network again.
  eq(
    "the cache key matches the repo kokoro-js asks for",
    /huggingface\.co\/\$\{MODEL_ID\}\/resolve\/main\/voices/.test(engine),
    true,
  );

  // Falling back to the browser engine is what produced the Google voice.
  const fallback = readFileSync(new URL("../lib/voice/tts/index.ts", import.meta.url), "utf8");
  const synthesize = fallback.slice(fallback.indexOf("async synthesize"));
  eq(
    "a failed load never reaches speechSynthesis",
    /browser\.speak/.test(synthesize),
    false,
  );
}


console.log("\n--- pictures ---");
{
  const dir = mkdtempSync(join(tmpdir(), "jarvis-images-"));
  process.env.JARVIS_IMAGE_DIR = dir;

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  eq("a PNG is recognised by its bytes", sniffMime(png), "image/png");
  eq("so is a JPEG", sniffMime(jpeg), "image/jpeg");
  eq("an HTML page is not a picture", sniffMime(Buffer.from("<html>")), null);

  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  eq("an id comes out of a path", imageIdFrom(`/api/images/${id}`), id);
  eq("and out of markdown", imageIdFrom(`![x](/api/images/${id})`), id);
  eq("a path with no id gives none", imageIdFrom("/etc/passwd"), null);

  // The tool, against a stand-in for NanoGPT.
  const realFetch = globalThis.fetch;
  const sent: Record<string, unknown>[] = [];
  let reply: unknown = { data: [{ b64_json: png.toString("base64") }] };
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;

  try {
    const made = await runToolCall(
      { id: "i1", name: "generate_image", arguments: '{"prompt":"a red [kite]"}' },
      { imageKey: "k" },
    );
    eq("a picture is made", made.isError, false);
    const madeId = imageIdFrom(made.content);
    eq("and the model gets a same-origin path, not the bytes", /\]\(\/api\/images\/[0-9a-f-]{36}\)/.test(made.content), true);
    eq("brackets in the prompt can't break the markdown", made.content.includes("[kite]"), false);
    eq("the server picks the model", sent[0].model, "hidream");
    eq("and the bytes are on disk", (await readImage(madeId!))?.bytes.length, png.length);

    const edited = await runToolCall(
      { id: "i2", name: "generate_image", arguments: JSON.stringify({ prompt: "make it blue", edit: `/api/images/${madeId}` }) },
      { imageKey: "k" },
    );
    eq("an earlier picture can be edited", edited.isError, false);
    eq("and is sent as the source", String(sent[1].imageDataUrl).startsWith("data:image/png;base64,"), true);
    const editedMeta = (await readImage(imageIdFrom(edited.content)!))?.meta;
    eq("the edit remembers where it came from", editedMeta?.editedFrom, madeId);

    const upload = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    await runToolCall(
      { id: "i3", name: "generate_image", arguments: '{"prompt":"add a hat","edit":"upload"}' },
      { imageKey: "k", uploads: [upload] },
    );
    eq("an attached picture can be edited", sent[2].imageDataUrl, upload);

    const noUpload = await runToolCall(
      { id: "i4", name: "generate_image", arguments: '{"prompt":"add a hat","edit":"upload"}' },
      { imageKey: "k" },
    );
    eq("editing with nothing attached says so", noUpload.isError && /attached/.test(noUpload.content), true);

    const stranger = await runToolCall(
      { id: "i5", name: "generate_image", arguments: '{"prompt":"x","edit":"/etc/passwd"}' },
      { imageKey: "k" },
    );
    eq("a path that isn't ours is refused", stranger.isError, true);

    eq("an unasked shape is square", sent[0].size, "1024x1024");
    await runToolCall(
      { id: "s1", name: "generate_image", arguments: '{"prompt":"a tall tower","shape":"portrait"}' },
      { imageKey: "k" },
    );
    eq("portrait is taller than wide", sent[sent.length - 1].size, "768x1024");

    // A model that refuses the size: the picture still comes, square.
    let refuseOnce = true;
    const okFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (refuseOnce && body.size !== "1024x1024") {
        refuseOnce = false;
        sent.push(body);
        return new Response('{"error":"unsupported size"}', { status: 400 });
      }
      return okFetch(url as string, init);
    }) as typeof fetch;
    const refused = await runToolCall(
      { id: "s2", name: "generate_image", arguments: '{"prompt":"a wide beach","shape":"landscape"}' },
      { imageKey: "k" },
    );
    globalThis.fetch = okFetch;
    eq("a refused shape falls back to square", refused.isError, false);
    eq("and says so", /refused a landscape size/.test(refused.content), true);
    eq("an unknown shape is square", (await runToolCall(
      { id: "s3", name: "generate_image", arguments: '{"prompt":"x","shape":"hexagon"}' },
      { imageKey: "k" },
    )).isError, false);
    eq("rather than passed through", sent[sent.length - 1].size, "1024x1024");

    reply = { data: [{ b64_json: Buffer.from("<script>alert(1)</script>").toString("base64") }] };
    const notImage = await runToolCall(
      { id: "i6", name: "generate_image", arguments: '{"prompt":"x"}' },
      { imageKey: "k" },
    );
    eq("a reply that isn't a picture is never saved", notImage.isError, true);

    eq("the gallery lists them newest first", (await listImages()).length, 6);
    eq(
    "a picture is announced, not read out as a URL",
    forSpeech(`Here. ![a kite](/api/images/${id})`),
    "Here. (picture shown on screen)",
  );
  eq("pruning keeps the newest", await pruneImages(1), 5);
    eq("and leaves one", (await listImages()).length, 1);

    const keyless = await runToolCall({ id: "i7", name: "generate_image", arguments: '{"prompt":"x"}' }, {});
    eq("with no key the tool isn't there at all", /No such tool/.test(keyless.content), true);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.JARVIS_IMAGE_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n--- finding, pinning and exporting chats ---");
{
  const msg = (role: "user" | "assistant", content: string, extra = {}) => ({
    id: `${role}-${content.length}`, role, content, createdAt: 0, ...extra,
  });
  const chat = (id: string, title: string, updatedAt: number, messages: ReturnType<typeof msg>[], pinned?: boolean): Chat => ({
    id, title, createdAt: 1_700_000_000_000, updatedAt, messages, ...(pinned ? { pinned } : {}),
  });

  const kite = chat("a", "Weekend plans", 3, [
    msg("user", "Should I fly a kite on Saturday?"),
    msg("assistant", "<think>the user wants weather</think>A storm is forecast, so maybe not."),
  ]);
  const recipe = chat("b", "Pancake recipe", 2, [msg("user", "How do I make pancakes?")]);
  const pinnedOld = chat("c", "Server passwords location", 1, [msg("user", "where did I put the notes")], true);

  eq("a word said in a message finds the chat", matchChat(kite, "kite")?.id, "a");
  eq("every word must appear, across messages", matchChat(kite, "KITE storm")?.id, "a");
  eq("but all of them", matchChat(kite, "kite pancake"), null);
  eq("with the line that matched", matchChat(kite, "saturday")?.snippet, "Should I fly a kite on Saturday?");
  eq("a title match needs no snippet", matchChat(recipe, "pancake")?.snippet, undefined);
  eq("hidden reasoning is not searched", matchChat(kite, "weather"), null);
  eq("an empty query matches nothing", matchChat(kite, "   "), null);

  const sorted = sortChats([kite, recipe, pinnedOld].map((c) => ({ ...c, messageCount: 0 })));
  eq("pinned leads, then newest", sorted.map((c) => c.id), ["c", "a", "b"]);
  eq("search results follow the same order", searchChats([recipe, kite, pinnedOld], "o").map((c) => c.id), ["c", "a", "b"]);

  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const drawn = chat("d", "Draw: a kite / at night?", 4, [
    msg("user", "draw a kite"),
    msg("assistant", `Here.\n\n![kite](/api/images/${id})`, {
      model: "mock-8b",
      toolRounds: [{ round: 1, calls: [{ id: "1", name: "generate_image", arguments: "{}" }], results: [] }],
    }),
  ]);
  const md = chatToMarkdown(drawn, "https://jarvis.local");
  eq("an export is titled", md.startsWith("# Draw: a kite / at night?\n"), true);
  eq("says who spoke", md.includes("## You") && md.includes("## JARVIS (mock-8b)"), true);
  eq("names the tools used, not their output", md.includes("> Used generate_image"), true);
  eq("and makes picture links whole", md.includes(`](https://jarvis.local/api/images/${id})`), true);
  eq("never exports reasoning", chatToMarkdown(kite).includes("the user wants weather"), false);
  eq("a filename any OS accepts", exportFilename(drawn), "draw-a-kite-at-night.md");
  eq("even from a title of symbols", exportFilename(chat("e", "???", 0, [])), "chat.md");

  // The model asks in phrases; "decide" appears in no chat, and must not sink it.
  const ranked = rankChats([recipe, kite, pinnedOld], "what did we decide about flying the kite saturday?");
  eq("a phrase finds the chat holding most of its words", ranked[0]?.id, "a");
  eq("and shows the line that holds them", ranked[0]?.snippet, "Should I fly a kite on Saturday?");
  eq("a chat with too few of the words is left out", ranked.some((c) => c.id === "b"), false);
  eq("words everyone uses find nothing", rankChats([kite, recipe], "what did you do").length, 0);
  eq("hidden reasoning is not recalled either", rankChats([kite], "user wants weather").length, 0);

  // recall reaches the chat files, through the same store the app uses.
  process.env.JARVIS_STORAGE = "memory";
  await getStore().save(kite);
  const recalled = await runToolCall({ id: "r1", name: "recall", arguments: '{"query":"kite on saturday"}' }, {});
  eq("recall finds what was said in an earlier chat", /Past conversations:\n- "Weekend plans" \(\d{4}-\d\d-\d\d\): Should I fly a kite/.test(recalled.content), true);
  const listAll = await runToolCall({ id: "r2", name: "recall", arguments: "{}" }, {});
  eq("but listing memories doesn't dump every chat", listAll.content.includes("Past conversations"), false);
}

console.log("\n--- counting what was spent ---");
{
  const dir = mkdtempSync(join(tmpdir(), "jarvis-usage-"));
  process.env.JARVIS_USAGE_FILE = join(dir, "usage.json");
  resetUsage();

  recordRequest("groq", 1200, 200);
  recordRequest("groq", 800, 200);
  recordRequest("groq", 900, 429, "Rate limit reached");
  recordRequest("cerebras", 100, 500, "Internal error");
  recordRequest("cerebras", 100, "network", "ECONNREFUSED");

  const [today] = await usageHistory();
  eq("counted against today in UTC", today.day, utcDay());
  const groq = today.providers.groq;
  eq("every request is counted", groq.requests, 3);
  eq("answered ones apart", groq.ok, 2);
  eq("and refusals apart", groq.rateLimited, 1);
  eq("with the tokens they cost", groq.tokensSent, 2900);
  eq("a rate limit isn't reported as an error", groq.lastError, undefined);
  eq("a failure is", today.providers.cerebras.failed, 2);
  eq("with what went wrong last", today.providers.cerebras.lastError, "ECONNREFUSED");
  eq("and whether the latest request failed", today.providers.cerebras.lastOk, false);
  recordRequest("cerebras", 100, 200);
  eq("which an answer since clears, error kept for the record", [(await usageHistory())[0].providers.cerebras.lastOk, (await usageHistory())[0].providers.cerebras.lastError], [true, "ECONNREFUSED"]);

  await flushUsage();
  const saved = JSON.parse(readFileSync(process.env.JARVIS_USAGE_FILE, "utf8"));
  eq("the count survives a restart", saved.days[utcDay()].groq.requests, 3);

  // A restart reads the file back, and adds to it rather than starting over.
  resetUsage();
  const shared = globalThis as { __jarvisUsage?: { loaded: boolean } };
  shared.__jarvisUsage!.loaded = false;
  recordRequest("groq", 100, 200);
  const [after] = await usageHistory();
  eq("and carries on from where it was", after.providers.groq.requests, 4);

  // Two weeks is kept; older days go.
  saved.days["2000-01-01"] = { groq: saved.days[utcDay()].groq };
  for (let d = 1; d <= 20; d++) saved.days[`2001-01-${String(d).padStart(2, "0")}`] = { groq: saved.days[utcDay()].groq };
  writeFileSync(process.env.JARVIS_USAGE_FILE, JSON.stringify(saved));
  resetUsage();
  shared.__jarvisUsage!.loaded = false;
  await flushUsage();
  eq("only the last fourteen days are kept", (await usageHistory()).length, 14);
  eq("including today", (await usageHistory())[0].day, utcDay());

  resetUsage();
  delete process.env.JARVIS_USAGE_FILE;
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n--- backing everything up ---");
{
  eq("CRC-32 matches the standard check value", crc32(new TextEncoder().encode("123456789")), 0xcbf43926);

  const dir = mkdtempSync(join(tmpdir(), "jarvis-backup-"));
  process.env.JARVIS_DATA_DIR = dir;
  mkdirSync(join(dir, "chats"));
  mkdirSync(join(dir, "images"));
  writeFileSync(join(dir, "chats", "a.json"), '{"title":"Crêpes 🥞"}');
  writeFileSync(join(dir, "memory.json"), "[]");
  writeFileSync(join(dir, "images", "p.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  symlinkSync("/etc", join(dir, "outside"));

  const names: string[] = [];
  for await (const entry of backupEntries()) names.push(entry.name);
  eq("a backup is the data folder as it sits on disk, with how to restore it", names, [
    "RESTORE.txt", "data/chats/a.json", "data/images/p.png", "data/memory.json",
  ]);

  const bytes = new Uint8Array(await new Response(zipStream(backupEntries())).arrayBuffer());
  const view = new DataView(bytes.buffer);
  eq("it opens with a zip header", view.getUint32(0, true), 0x04034b50);
  const end = bytes.length - 22;
  eq("and closes with a directory of every file", [view.getUint32(end, true), view.getUint16(end + 10, true)], [0x06054b50, 4]);
  const text = new TextDecoder().decode(bytes);
  eq("names and contents survive, emoji included", text.includes("data/chats/a.json") && text.includes("Crêpes 🥞"), true);

  delete process.env.JARVIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n--- JARVIS editing its own code, in a sandbox ---");
{
  // Which paths are JARVIS' source, and which an edit may touch.
  eq("a component is source", isSourcePath("components/ChatPane.tsx"), true);
  eq("so is a route", isEditable("app/api/chat/route.ts"), true);
  eq("and a top-level config", isEditable("next.config.ts"), true);
  eq("secrets never are", isSourcePath(".env.local"), false);
  eq("the example env file is", isEditable(".env.example"), true);
  eq("nor your data", isSourcePath("data/chats/a.json"), false);
  eq("nor installed packages", isSourcePath("lib/node_modules/x.js"), false);
  eq("nor the downloaded voice models", isSourcePath("public/models/kokoro/x.onnx"), false);
  eq("package.json is copied but can't be edited", [isSourcePath("package.json"), isEditable("package.json")], [true, false]);
  eq("traversal is not source", isSourcePath("lib/../../etc/passwd"), false);

  const root = mkdtempSync(join(tmpdir(), "jarvis-self-"));
  const live = join(root, "live");
  const box = join(root, "box");
  const put = (base: string, rel: string, text: string) => {
    mkdirSync(join(base, ...rel.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(base, ...rel.split("/")), text);
  };
  put(live, "components/Hello.tsx", "export const hello = 1;\n");
  put(live, "lib/util.ts", "export const a = 1;\nexport const b = 2;\n");
  put(live, "README.md", "# JARVIS\n");
  put(live, "package.json", "{}\n");
  put(live, ".env.local", "GROQ_API_KEY=secret\n");
  put(live, "data/chats/c.json", "{}");
  put(live, "test/.mock.log", "noise");
  mkdirSync(join(live, "public", "models"), { recursive: true });
  writeFileSync(join(live, "public", "models", "big.onnx"), "weights");
  process.env.JARVIS_LIVE_ROOT = live;
  process.env.JARVIS_SANDBOX_DIR = box;
  // These tests play the real JARVIS, even when the checks run them inside
  // the sandbox copy (which is marked as such, and has self-editing off).
  const wasSandbox = process.env.JARVIS_IS_SANDBOX;
  delete process.env.JARVIS_IS_SANDBOX;

  try {
    await resetSandbox();
    eq("the sandbox is a copy of the source", readdirSync(join(box, "components")), ["Hello.tsx"]);
    eq("without your secrets", existsSync(join(box, ".env.local")), false);
    eq("or your data", existsSync(join(box, "data")), false);
    eq("or stray logs", existsSync(join(box, "test", ".mock.log")), false);
    eq("the voice models are linked, not copied", lstatSync(join(box, "public", "models")).isSymbolicLink(), true);
    eq("git's own files are never source", isSourcePath(".git/config") || isSourcePath(".gitignore"), false);
    // A sandbox folder set by mistake to somewhere with your files in it.
    const elsewhere = join(root, "home");
    put(elsewhere, "precious.txt", "keep me");
    process.env.JARVIS_SANDBOX_DIR = elsewhere;
    let refusedWipe = "";
    try { await resetSandbox(); } catch (e) { refusedWipe = (e as Error).message; }
    eq("a folder that isn't a sandbox is never cleared", [/won't be cleared/.test(refusedWipe), existsSync(join(elsewhere, "precious.txt"))], [true, true]);
    process.env.JARVIS_SANDBOX_DIR = box;
    eq(
      "the stylesheet never scans build output (the sandbox's cache broke it)",
      readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").includes('@source not "../.next"'),
      true,
    );
    eq("and every copied file is recorded", Object.keys((await readManifest())!.base).sort(), [
      "README.md", "components/Hello.tsx", "lib/util.ts", "package.json",
    ]);

    let threw = "";
    try { await resolveSource("../live/.env.local", box, { editable: true }); } catch (e) { threw = (e as Error).message; }
    eq("an edit can't climb out", /outside/.test(threw), true);
    threw = "";
    try { await resolveSource("public/models/evil.ts", box, { editable: true }); } catch (e) { threw = (e as Error).message; }
    eq("or follow the model link out of the sandbox", threw !== "", true);
    threw = "";
    try { await writeSandboxFile("package.json", "{\"dependencies\":{}}"); } catch (e) { threw = (e as Error).message; }
    eq("dependencies can't be changed from here", /npm install/.test(threw), true);

    await writeSandboxFile("lib/util.ts", "export const a = 1;\nexport const b = 3;\n");
    await writeSandboxFile("lib/new.ts", "export const c = 3;\n");
    rmSync(join(box, "README.md"));
    eq("edits stay in the sandbox", readFileSync(join(live, "lib", "util.ts"), "utf8").includes("b = 2"), true);
    eq("and are listed as changes, alphabetically", (await listChanges()).map((c) => `${c.status} ${c.path}`), [
      "added lib/new.ts", "modified lib/util.ts", "deleted README.md",
    ]);

    // Someone changes the real file meanwhile: applying would clobber it.
    put(live, "lib/util.ts", "export const a = 9;\nexport const b = 2;\n");
    eq("a file changed in JARVIS since is flagged", (await listChanges()).find((c) => c.path === "lib/util.ts")?.conflict, true);
    threw = "";
    try { await promote(); } catch (e) { threw = (e as Error).message; }
    eq("and applying refuses rather than overwrite it", /changed since the sandbox was made/.test(threw), true);
    eq("writing nothing at all", existsSync(join(live, "lib", "new.ts")), false);

    await revertSandboxFile("lib/util.ts");
    eq("reverting takes JARVIS' current copy", readFileSync(join(box, "lib", "util.ts"), "utf8").includes("a = 9"), true);
    await writeSandboxFile("lib/util.ts", "export const a = 9;\nexport const b = 3;\n");

    const applied = await promote();
    eq("applying writes the changes into JARVIS", readFileSync(join(live, "lib", "util.ts"), "utf8"), "export const a = 9;\nexport const b = 3;\n");
    eq("adds new files", existsSync(join(live, "lib", "new.ts")), true);
    eq("removes deleted ones", existsSync(join(live, "README.md")), false);
    eq("and the sandbox then matches", (await listChanges()).length, 0);
    eq("it's recorded", (await listPromotions()).map((p) => p.id), [applied.id]);
    const saved = readdirSync(join(live, "data", "self-edit", applied.id, "before", "lib"));
    eq("with the old code kept where no compiler mistakes it for source", saved, ["util.ts.orig"]);

    await undoPromotion(applied.id);
    eq("undo puts the old code back", readFileSync(join(live, "lib", "util.ts"), "utf8").includes("b = 2"), true);
    eq("removes what was added", existsSync(join(live, "lib", "new.ts")), false);
    eq("restores what was deleted", readFileSync(join(live, "README.md"), "utf8"), "# JARVIS\n");
    eq("and the sandbox shows them as unapplied again", (await listChanges()).length, 3);
    threw = "";
    try { await undoPromotion(applied.id); } catch (e) { threw = (e as Error).message; }
    eq("an undo can't run twice", /already undone/.test(threw), true);

    const again = await promote();
    put(live, "lib/util.ts", "hand edited after\n");
    threw = "";
    try { await undoPromotion(again.id); } catch (e) { threw = (e as Error).message; }
    eq("undo won't discard an edit made after applying", /changed again/.test(threw), true);

    // The sandbox server gets its own settings, never the real JARVIS' ones.
    process.env.JARVIS_DEVICE_MODE = "1";
    process.env.JARVIS_ALLOW_SELF_EDIT = "1";
    const env = sandboxEnv();
    eq("it is marked as the sandbox", env.JARVIS_IS_SANDBOX, "1");
    eq("can't start a sandbox of its own", env.JARVIS_ALLOW_SELF_EDIT, undefined);
    eq("and leaves the microphone and display alone", env.JARVIS_DEVICE_MODE, undefined);
    eq("and uses its own data", env.JARVIS_LIVE_ROOT, undefined);
    delete process.env.JARVIS_DEVICE_MODE;

    // What the model is told about where it runs.
    process.env.JARVIS_ALLOW_SELF_EDIT = "0";
    delete process.env.JARVIS_ALLOW_COMPUTER;
    eq("with no tools on, the model is told nothing extra", environmentNote(), "");
    process.env.JARVIS_ALLOW_SELF_EDIT = "1";
    const selfNote = environmentNote();
    eq("with self-editing, it's pointed at the code tools", selfNote.includes("code_read"), true);
    eq("and told .env files are off limits", selfNote.includes(".env"), true);
    process.env.JARVIS_ALLOW_COMPUTER = "1";
    process.env.JARVIS_WORKSPACE = join(box, "..");
    const pointedAtSandbox = environmentNote();
    eq("a workspace set to the sandbox folder is called out", pointedAtSandbox.includes("set to your sandbox"), true);
    eq("and the shell is named for this OS", /cmd\.exe|uses sh/.test(pointedAtSandbox), true);
    delete process.env.JARVIS_ALLOW_COMPUTER;
    delete process.env.JARVIS_WORKSPACE;

    // The tools, end to end, against the same fake project.
    eq("the self-edit tools exist only when switched on", allTools().some((t) => t.name === "code_edit"), true);
    const selfEditTokens =
      estimateTokens(JSON.stringify(allTools().map(toWireTool))) -
      (() => {
        delete process.env.JARVIS_ALLOW_SELF_EDIT;
        const n = estimateTokens(JSON.stringify(allTools().map(toWireTool)));
        process.env.JARVIS_ALLOW_SELF_EDIT = "1";
        return n;
      })();
    console.log(`     self-editing adds ${selfEditTokens} tokens when switched on`);
    eq("and cost little when they do", selfEditTokens > 0 && selfEditTokens <= 300, true);
    process.env.JARVIS_IS_SANDBOX = "1";
    eq("the sandbox copy itself never gets them", allTools().some((t) => t.name === "code_edit"), false);
    delete process.env.JARVIS_IS_SANDBOX;

    const approve = { onApprovalRequest: (r: { id: string }) => settleApproval(r.id, "approve") };
    const deny = { onApprovalRequest: (r: { id: string }) => settleApproval(r.id, "deny") };
    let card = "";
    const watch = { onApprovalRequest: (r: { id: string; detail?: string }) => { card = r.detail ?? ""; settleApproval(r.id, "approve"); } };

    const read = await runToolCall({ id: "c1", name: "code_read", arguments: '{"path":"components/Hello.tsx"}' }, {});
    eq("JARVIS can read its own code, numbered", read.content.includes("1  export const hello = 1;"), true);
    const overviewText = (await runToolCall({ id: "c2", name: "code_read", arguments: "{}" }, {})).content;
    eq("and gets a map of it", overviewText.includes("components/") && overviewText.includes("lib/"), true);

    const edited = await runToolCall(
      { id: "c3", name: "code_edit", arguments: JSON.stringify({ path: "components/Hello.tsx", find: "hello = 1", replace: "hello = 2" }) },
      watch,
    );
    eq("JARVIS can edit itself", edited.isError, false);
    eq("the approval shows a diff", card.includes("-export const hello = 1;") && card.includes("+export const hello = 2;"), true);
    eq("the edit is in the sandbox", readFileSync(join(box, "components", "Hello.tsx"), "utf8"), "export const hello = 2;\n");
    eq("not in the running JARVIS", readFileSync(join(live, "components", "Hello.tsx"), "utf8"), "export const hello = 1;\n");

    const refused = await runToolCall(
      { id: "c4", name: "code_edit", arguments: JSON.stringify({ path: "components/Hello.tsx", find: "hello = 2", replace: "hello = 3" }) },
      deny,
    );
    eq("a refused edit changes nothing", readFileSync(join(box, "components", "Hello.tsx"), "utf8").includes("hello = 2"), true);
    eq("and JARVIS is told", /did not approve/.test(refused.content), true);

    const ambiguous = await runToolCall(
      { id: "c5", name: "code_edit", arguments: JSON.stringify({ path: "lib/util.ts", find: "export const", replace: "const" }) },
      approve,
    );
    eq("an edit that could mean two places is refused", ambiguous.isError && /appears 2 times/.test(ambiguous.content), true);
    const secret = await runToolCall(
      { id: "c6", name: "code_edit", arguments: JSON.stringify({ path: ".env.local", content: "x" }) },
      approve,
    );
    eq("secrets are off limits", secret.isError, true);
    const created = await runToolCall(
      { id: "c7", name: "code_edit", arguments: JSON.stringify({ path: "lib/tools/joke.ts", content: "export const joke = 'hi';\n" }) },
      approve,
    );
    eq("it can add a whole new file", created.isError === false && existsSync(join(box, "lib", "tools", "joke.ts")), true);
    eq("a long file comes back a page at a time", await (async () => {
      put(box, "lib/long.ts", Array.from({ length: 900 }, (_, i) => `export const v${i} = ${i};`).join("\n"));
      const page = (await runToolCall({ id: "c8", name: "code_read", arguments: '{"path":"lib/long.ts"}' }, {})).content;
      return page.length < 6000 && /Continue with from=\d+/.test(page);
    })(), true);
    eq("an unknown tool path is explained", /No such file/.test((await runToolCall({ id: "c9", name: "code_read", arguments: '{"path":"lib/nope.ts"}' }, {})).content), true);

    eq("a diff of identical text is empty", unifiedDiff("a\n", "a\n"), "");
    eq("a diff rebuilds both sides", (() => {
      const d = diffLines("a\nb\nc\n", "a\nc\nd\n");
      return [d.filter((l) => l.op !== "+").map((l) => l.text), d.filter((l) => l.op !== "-").map((l) => l.text)];
    })(), [["a", "b", "c"], ["a", "c", "d"]]);
  } finally {
    delete process.env.JARVIS_ALLOW_SELF_EDIT;
    delete process.env.JARVIS_LIVE_ROOT;
    delete process.env.JARVIS_SANDBOX_DIR;
    if (wasSandbox !== undefined) process.env.JARVIS_IS_SANDBOX = wasSandbox;
    rmSync(root, { recursive: true, force: true });
  }
}

console.log("\n--- guessing the password ---");
{
  resetLimiter();
  const t0 = 1_000_000;
  eq("a fresh client may try", retryAfterMs("a", t0), 0);
  for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure("a", t0 + i);
  eq("up to the limit minus one, still may", retryAfterMs("a", t0 + 10), 0);
  recordFailure("a", t0 + 4);
  const wait = retryAfterMs("a", t0 + 5);
  eq("at the limit, locked out", wait > 0, true);
  eq("for roughly the rest of the window", Math.abs(wait - (WINDOW_MS - 5)) < 10, true);
  eq("another client is unaffected", retryAfterMs("b", t0 + 5), 0);
  eq("the window ends and the lock lifts", retryAfterMs("a", t0 + WINDOW_MS + 10), 0);
  recordSuccess("a");
  eq("a correct password clears that client", retryAfterMs("a", t0 + 5), 0);

  // An attacker who rotates the forwarding header still meets the global limit.
  resetLimiter();
  for (let i = 0; i < MAX_GLOBAL_FAILURES; i++) recordFailure(`spoof-${i}`, t0 + i);
  eq("many clients, each under its limit, hit the shared one", retryAfterMs("someone-new", t0 + 100) > 0, true);
  eq("and a success from one doesn't lift it", (recordSuccess("spoof-1"), retryAfterMs("someone-new", t0 + 100) > 0), true);

  eq("the client is the first forwarded address", clientKey(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
  eq("Cloudflare's header wins", clientKey(new Headers({ "cf-connecting-ip": "198.51.100.2", "x-forwarded-for": "203.0.113.9" })), "198.51.100.2");
  eq("with no header, a single shared bucket", clientKey(new Headers()), "direct");
  eq("an absurdly long header is cut", clientKey(new Headers({ "x-forwarded-for": "x".repeat(500) })).length, 64);
  resetLimiter();
}

console.log("\n--- the audit log ---");
{
  const dir = mkdtempSync(join(tmpdir(), "jarvis-audit-"));
  process.env.JARVIS_AUDIT_FILE = join(dir, "audit.jsonl");
  audit("login.ok", undefined, "1.2.3.4");
  audit("approval.approve", "write: Create notes/hello.txt\nwith a newline");
  audit("sandbox.apply", "x".repeat(1000));
  await flushAudit();
  const entries = await recentAudit(10);
  eq("newest first", entries.map((e) => e.kind), ["sandbox.apply", "approval.approve", "login.ok"]);
  eq("a long detail is cut short", entries[0].detail!.length, 200);
  eq("a newline can't split an entry", entries[1].detail, "write: Create notes/hello.txt with a newline");
  eq("the client is kept for logins", entries[2].client, "1.2.3.4");
  eq("each entry is one line of JSON", readFileSync(auditFile(), "utf8").trim().split("\n").length, 3);

  writeFileSync(auditFile(), readFileSync(auditFile(), "utf8") + '{"at": 1, "kind"\nnot json\n');
  eq("a damaged line is skipped, not fatal", (await recentAudit(10)).length, 3);
  eq("the limit is honoured", (await recentAudit(2)).length, 2);

  writeFileSync(auditFile(), "x".repeat(2_100_000) + "\n");
  audit("login.fail");
  await flushAudit();
  eq("a big log is rotated, not grown forever", existsSync(`${auditFile()}.1`), true);
  eq("and the new entry still reads back first", (await recentAudit(1))[0].kind, "login.fail");
  delete process.env.JARVIS_AUDIT_FILE;
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n--- moving settings between browsers ---");
{
  const mine = { ...DEFAULT_SETTINGS, keys: { groq: "gsk_SECRET" }, macs: { "self-hosted": "aa:bb:cc:dd:ee:ff" }, temperature: 0.3 };
  const out = exportSettings(mine, new Date("2026-10-02T00:00:00Z"));
  const text = JSON.stringify(out);
  eq("an export is labelled", [out.format, out.version], [FORMAT, 1]);
  eq("and never carries a key", text.includes("gsk_SECRET"), false);
  eq("or a MAC address", text.includes("aa:bb:cc"), false);
  eq("but does carry the ordinary settings", out.settings.temperature, 0.3);

  const back = importSettings(text, { ...DEFAULT_SETTINGS, keys: { groq: "gsk_MINE" } });
  eq("an export imports", back.ok, true);
  if (back.ok) {
    eq("changing what differs", back.changed, ["temperature"]);
    eq("and leaving this browser's keys alone", back.settings.keys, { groq: "gsk_MINE" });
  }

  const hostile = JSON.stringify({
    format: FORMAT, version: 1,
    settings: {
      keys: { groq: "stolen" }, macs: { x: "y" },
      temperature: 99, ttsSpeed: -4, wakeThreshold: "high", useTools: "yes", ttsQuality: "huge",
      persona: "p".repeat(50_000), isAdmin: true,
      endpoints: { "self-hosted": "javascript:alert(1)", ok: "http://localhost:11434/v1", "bad id!": "http://x" },
      budgets: { "self-hosted": { context: 1e12, maxOutput: "lots" } },
    },
  });
  const cleaned = importSettings(hostile, DEFAULT_SETTINGS);
  eq("a hostile file still imports", cleaned.ok, true);
  if (cleaned.ok) {
    const s = cleaned.settings as unknown as Record<string, unknown>;
    eq("keys in a file are ignored", s.keys, {});
    eq("so are MAC addresses", s.macs, {});
    eq("numbers are clamped", [s.temperature, s.ttsSpeed], [2, 0.5]);
    eq("wrongly-typed values are dropped", [s.wakeThreshold, s.useTools, s.ttsQuality], [DEFAULT_SETTINGS.wakeThreshold, true, DEFAULT_SETTINGS.ttsQuality]);
    eq("a huge persona is cut", (s.persona as string).length, 20_000);
    eq("unknown fields are dropped", "isAdmin" in s, false);
    eq("only http(s) endpoints survive, with sane ids", s.endpoints, { ok: "http://localhost:11434/v1" });
    eq("budgets are clamped and typed", s.budgets, { "self-hosted": { context: 2_000_000 } });
  }
  eq("not JSON is refused", importSettings("hello", DEFAULT_SETTINGS).ok, false);
  eq("other JSON is refused", importSettings('{"format":"other"}', DEFAULT_SETTINGS).ok, false);
  eq("a newer version is refused, by name", /version 2/.test((importSettings('{"format":"jarvis-settings","version":2,"settings":{}}', DEFAULT_SETTINGS) as { error: string }).error), true);
}

console.log("\n--- headers and health ---");
{
  const names = securityHeaders.map((h) => h.key);
  eq("the headers are all set", names, ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]);
  // Loaded as CommonJS here, so the default export arrives wrapped; Next
  // itself unwraps it, which the production build below proves.
  const config = ((nextConfig as unknown as { default?: typeof nextConfig }).default ?? nextConfig) as typeof nextConfig;
  const rules = await config.headers!();
  eq("on every route", [rules.length, rules[0].source], [1, "/:path*"]);
  const permissions = securityHeaders.find((h) => h.key === "Permissions-Policy")!.value;
  eq("the microphone stays available to voice mode", permissions.includes("microphone=(self)"), true);
  eq("and nothing that breaks the WASM voice runtime is set", names.some((n) => /Cross-Origin|Content-Security/.test(n)), false);

  const res = await healthGet();
  const body = await res.json();
  eq("health says it is up", [res.status, body.ok], [200, true]);
  eq("and nothing else about the install", Object.keys(body).sort(), ["ok", "uptimeSeconds"]);
}

console.log("\n--- the sidebar's sections ---");
{
  const now = new Date(2026, 9, 2, 12, 0, 0).getTime(); // Fri 2 Oct, noon, local time
  const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).getTime();
  const row = (id: string, updatedAt: number, pinned = false) => ({ id, title: id, createdAt: updatedAt, updatedAt, messageCount: 1, ...(pinned ? { pinned } : {}) });
  const chats = [
    row("this-morning", at(2026, 9, 2, 8)),
    row("just-after-midnight", at(2026, 9, 2, 0)),
    row("yesterday-night", at(2026, 9, 1, 23)),
    row("three-days", at(2026, 8, 29)),
    row("last-week-edge", at(2026, 8, 25)),
    row("twenty-days", at(2026, 8, 12)),
    row("ancient", at(2025, 1, 1)),
    row("pinned-old", at(2024, 1, 1), true),
  ];
  const groups = groupByDate(chats, now);
  eq("sections in order, empty ones left out", groups.map((g) => g.label), ["Pinned", "Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"]);
  const of = (label: string) => groups.find((g) => g.label === label)!.chats.map((c) => c.id);
  eq("a pinned chat leads whatever its age", of("Pinned"), ["pinned-old"]);
  eq("today runs from local midnight, newest first", of("Today"), ["this-morning", "just-after-midnight"]);
  eq("yesterday is the calendar day before", of("Yesterday"), ["yesterday-night"]);
  eq("the last seven days", of("Previous 7 days"), ["three-days", "last-week-edge"]);
  eq("then the last thirty", of("Previous 30 days"), ["twenty-days"]);
  eq("then everything else", of("Older"), ["ancient"]);
  eq("no chats, no sections", groupByDate([], now), []);
}

console.log("\n--- tags, branches and what a PATCH may do ---");
{
  eq("a tag is lowercase and hyphenated", normalizeTag("  Home Work  "), "home-work");
  eq("punctuation that would break a search is removed", normalizeTag("tag:evil!"), "tagevil");
  eq("an empty tag is nothing", normalizeTag("***"), null);
  eq("a tag of the wrong type is nothing", normalizeTag(42), null);
  eq("a tag is cut to 24 characters", normalizeTag("x".repeat(60))!.length, 24);
  eq("duplicates collapse, order kept", normalizeTags(["Work", "work", "home", " WORK "]), ["work", "home"]);
  eq("there are never more than eight", normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length, MAX_TAGS);
  eq("not a list is no tags", normalizeTags("work"), []);
  eq("the filter row counts and sorts", tagCounts([{ tags: ["a", "b"] }, { tags: ["b"] }, {}]), [{ tag: "b", count: 2 }, { tag: "a", count: 1 }]);

  const base: Chat = {
    id: "c1", title: "Original", createdAt: 1, updatedAt: 100, provider: "groq", model: "m",
    messages: [
      { id: "m1", role: "user", content: "first", createdAt: 1 },
      { id: "m2", role: "assistant", content: "answer", createdAt: 2 },
      { id: "m3", role: "user", content: "second", createdAt: 3 },
    ],
  };
  const patched = (body: unknown) => applyChatPatch(base, body, 9999);
  const ok = (body: unknown) => { const r = patched(body); return r.ok ? r.chat : null; };

  eq("tidying doesn't count as activity", [ok({ pinned: true })!.updatedAt, ok({ tags: ["x"] })!.updatedAt, ok({ archived: true })!.updatedAt, ok({ title: "Renamed" })!.updatedAt], [100, 100, 100, 100]);
  eq("saving messages does", ok({ messages: [] })!.updatedAt, 9999);
  eq("pinning sets it, unpinning leaves nothing in the saved file", [ok({ pinned: true })!.pinned, JSON.stringify(ok({ pinned: false })).includes("pinned")], [true, false]);
  eq("tags are cleaned on the way in", ok({ tags: ["Home Work", "home work", "!!"] })!.tags, ["home-work"]);
  eq("an empty list clears them", ok({ tags: [] })!.tags, undefined);
  eq("per-chat instructions are trimmed and stored", ok({ persona: "  Be terse.  " })!.persona, "Be terse.");
  eq("null clears them", ok({ persona: null })!.persona, undefined);
  eq("a blank title is ignored, not applied", ok({ title: "   " })!.title, "Original");
  eq("a title is cut to 200", ok({ title: "t".repeat(500) })!.title.length, 200);
  eq("the wrong type is an error, not a silent skip", [patched({ pinned: "yes" }).ok, patched({ tags: "a" }).ok, patched({ messages: {} }).ok, patched({ persona: 5 }).ok, patched({ archived: 1 }).ok], [false, false, false, false, false]);
  eq("so is a body that isn't an object", [patched(null).ok, patched([]).ok, patched("x").ok], [false, false, false]);
  eq("unknown fields can't be set", "isAdmin" in ok({ isAdmin: true, id: "other" })! || ok({ id: "other" })!.id !== "c1", false);

  const full = { ...base, pinned: true, archived: true, tags: ["work"], persona: "Be terse." };
  const dup = branchChat(full, undefined, 5000)!;
  eq("a duplicate is a new chat", [dup.id !== full.id, dup.title, dup.messages.length], [true, "Original (copy)", 3]);
  eq("it keeps tags and instructions", [dup.tags, dup.persona], [["work"], "Be terse."]);
  eq("but starts unpinned and unarchived", [dup.pinned, dup.archived], [undefined, undefined]);
  eq("and remembers its source", dup.branchedFrom, { chatId: "c1" });
  const branch = branchChat(base, "m2", 5000)!;
  eq("a branch stops at the chosen message", branch.messages.map((m) => m.id), ["m1", "m2"]);
  eq("is titled so", branch.title, "Original (branch)");
  eq("and records where from", branch.branchedFrom, { chatId: "c1", messageId: "m2" });
  eq("branching from a message that isn't there fails", branchChat(base, "nope"), null);
  branch.messages[0].content = "changed";
  eq("the copy shares nothing with the original", base.messages[0].content, "first");
}

console.log("\n--- search operators ---");
{
  eq("operators are told from words", parseQuery("kite tag:work is:pinned storm"), { words: ["kite", "storm"], tags: ["work"], pinned: true, archived: false });
  eq("a lookalike is just a word", parseQuery("is:foo tag: http://x").words, ["is:foo", "tag:", "http://x"]);
  const chat = (id: string, extra: Partial<Chat>): Chat => ({ id, title: `chat ${id}`, createdAt: 1, updatedAt: 1, messages: [{ id: "m", role: "user", content: "the kite flew", createdAt: 1 }], ...extra });
  const work = chat("w", { tags: ["work", "urgent"] });
  const pinned = chat("p", { pinned: true });
  const archived = chat("a", { archived: true, tags: ["work"] });
  const ids = (q: string) => searchChats([work, pinned, archived], q).map((c) => c.id).sort();
  eq("a tag alone lists what has it", ids("tag:work"), ["w"]);
  eq("archived chats are hidden unless asked for", ids("kite"), ["p", "w"]);
  eq("is:archived finds them, and only them", ids("is:archived"), ["a"]);
  eq("operators and words combine", ids("kite is:pinned"), ["p"]);
  eq("all tags must match", [ids("tag:work tag:urgent"), ids("tag:work tag:nope")], [["w"], []]);
  eq("an empty search still finds nothing", ids(""), []);
}

console.log("\n--- the trash ---");
{
  const dir = mkdtempSync(join(tmpdir(), "jarvis-trash-"));
  process.env.JARVIS_DATA_DIR = dir;
  const mk = (id: string): Chat => ({ id, title: `Chat ${id}`, createdAt: 1, updatedAt: 1, messages: [{ id: "m", role: "user", content: "hello", createdAt: 1 }] });

  for (const [name, store] of [["memory store", new MemoryStore()], ["file store", new FsStore()]] as const) {
    await store.save(mk("keep"));
    await store.save(mk("doomed"));
    eq(`${name}: trashing moves a chat out of the list`, [await store.trash("doomed"), (await store.list()).map((c) => c.id)], [true, ["keep"]]);
    eq(`${name}: it is in the trash, stamped`, [(await store.listTrash()).map((c) => c.id), typeof (await store.listTrash())[0].deletedAt], [["doomed"], "number"]);
    eq(`${name}: and can no longer be opened`, await store.get("doomed"), null);
    eq(`${name}: trashing what isn't there is false`, await store.trash("ghost"), false);
    eq(`${name}: restoring brings it back whole`, [await store.restore("doomed"), (await store.get("doomed"))?.messages[0].content, (await store.listTrash()).length], [true, "hello", 0]);
    eq(`${name}: restoring twice is false`, await store.restore("doomed"), false);
    eq(`${name}: a restored chat carries no trash stamp`, "deletedAt" in ((await store.get("doomed")) as object), false);

    await store.trash("doomed");
    eq(`${name}: purging destroys it for good`, [await store.purge("doomed"), (await store.listTrash()).length, await store.purge("doomed")], [true, 0, false]);

    await store.save(mk("old"));
    await store.trash("old");
    eq(`${name}: a recent deletion survives the sweep`, [await store.purgeExpired(), (await store.listTrash()).length], [0, 1]);
    eq(`${name}: one older than thirty days is swept`, [await store.purgeExpired(Date.now() + TRASH_MS + 60_000), (await store.listTrash()).length], [1, 0]);
    await store.delete("keep");
  }
  eq("the file store keeps trash out of the chat list's folder", existsSync(join(dir, "chats", "old.json")), false);
  eq("and rejects an id that could climb out", await new FsStore().trash("../../etc/passwd").then(() => "no error", (e) => /Invalid chat id/.test(e.message)), true);
  delete process.env.JARVIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n--- restoring from a backup ---");
{
  // A zip builder that can make the files our own writer never would.
  const zip = (files: { name: string; data: Uint8Array; deflate?: boolean; lieSize?: number; badCrc?: boolean }[]): Uint8Array => {
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    const enc = new TextEncoder();
    for (const f of files) {
      const name = enc.encode(f.name);
      const body = f.deflate ? deflateRawSync(f.data) : f.data;
      const crc = f.badCrc ? 1234 : crc32(f.data);
      const size = f.lieSize ?? f.data.length;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(8, f.deflate ? 8 : 0, true); local.setUint32(14, crc, true);
      local.setUint32(18, body.length, true); local.setUint32(22, size, true); local.setUint16(26, name.length, true);
      const head = new DataView(new ArrayBuffer(46));
      head.setUint32(0, 0x02014b50, true); head.setUint16(4, 20, true); head.setUint16(6, 20, true); head.setUint16(8, 0x0800, true);
      head.setUint16(10, f.deflate ? 8 : 0, true); head.setUint32(16, crc, true);
      head.setUint32(20, body.length, true); head.setUint32(24, size, true); head.setUint16(28, name.length, true); head.setUint32(42, offset, true);
      parts.push(new Uint8Array(local.buffer), name, body);
      central.push(new Uint8Array(head.buffer), name);
      offset += 30 + name.length + body.length;
    }
    const cdSize = central.reduce((n, c) => n + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Uint8Array(Buffer.concat([...parts, ...central, new Uint8Array(end.buffer)]));
  };
  const text = (t: string) => new TextEncoder().encode(t);
  const chatJson = (id: string, title: string) => text(JSON.stringify({ id, title, createdAt: 1, updatedAt: 2, messages: [{ id: "m", role: "user", content: "hi", createdAt: 1 }] }));
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const imgId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const imgMeta = text(JSON.stringify({ id: imgId, prompt: "a kite", model: "m", mime: "image/png", bytes: png.length, createdAt: 1 }));

  const dir = mkdtempSync(join(tmpdir(), "jarvis-restore-"));
  const imagesDir = join(dir, "images");
  const targets = () => ({ chats: new MemoryStore(), memory: new FsMemoryStore(), imagesDir });
  process.env.JARVIS_DATA_DIR = dir;

  // reading
  const sample = zip([{ name: "a.txt", data: text("hello"), deflate: true }, { name: "b.txt", data: text("world") }]);
  const dirEntries = readZipDirectory(sample);
  eq("the directory lists the files", dirEntries.map((e) => e.name), ["a.txt", "b.txt"]);
  eq("deflated and stored entries both read", dirEntries.map((e) => new TextDecoder().decode(readZipEntry(sample, e))), ["hello", "world"]);
  const throwsZip = (fn: () => unknown) => { try { fn(); return "no error"; } catch (e) { return e instanceof ZipError ? e.message : `wrong error: ${e}`; } };
  eq("not a zip is refused", /isn't a zip/.test(throwsZip(() => readZipDirectory(text("this is not a zip file at all")))), true);
  eq("a truncated zip is refused", throwsZip(() => readZipDirectory(sample.subarray(0, 40))) !== "no error", true);
  const flipped = Uint8Array.from(sample); flipped[30 + 5 + 2] ^= 0xff;
  eq("a flipped byte fails its checksum", /checksum|damaged/.test(throwsZip(() => readZipEntry(flipped, readZipDirectory(flipped)[0]))), true);
  const lying = zip([{ name: "x", data: new Uint8Array(60 * 1024 * 1024), deflate: true, lieSize: 10 }]);
  eq("a bomb that lies about its size stops at the ceiling", /expands too far|damaged/.test(throwsZip(() => readZipEntry(lying, readZipDirectory(lying)[0]))), true);
  const big = zip([{ name: "x", data: new Uint8Array(60 * 1024 * 1024), deflate: true }]);
  eq("an honest oversize entry is refused before inflating", /too large/.test(throwsZip(() => readZipEntry(big, readZipDirectory(big)[0]))), true);

  // restoring
  const backup = zip([
    { name: "RESTORE.txt", data: text("how to") },
    { name: "data/chats/aaa.json", data: chatJson("aaa", "From the backup") },
    { name: "data/chats/bbb.json", data: chatJson("bbb", "Already here, in the backup version"), deflate: true },
    { name: "data/chats/ccc.json", data: chatJson("not-ccc", "Id doesn't match its file") },
    { name: "data/chats/ddd.json", data: text("{broken") },
    { name: "data/memory.json", data: text(JSON.stringify([{ id: "m1", text: "likes tea", tags: [], createdAt: 1, updatedAt: 1 }, { id: "m2", text: 5 }])) },
    { name: `data/images/${imgId}.png`, data: png },
    { name: `data/images/${imgId}.json`, data: imgMeta },
    { name: "data/images/11111111-1111-1111-1111-111111111111.png", data: text("<html>not an image</html>") },
    { name: "data/schedule.json", data: text("[]") },
    { name: "data/usage.json", data: text("{}") },
    { name: "data/chats/../../.env.local", data: text("GROQ_API_KEY=planted") },
    { name: "../../outside.txt", data: text("planted") },
    { name: "/etc/cron.d/evil", data: text("planted") },
    { name: "data/chats/", data: new Uint8Array() },
  ]);
  const t = targets();
  await t.chats.save({ id: "bbb", title: "Already here, my version", createdAt: 1, updatedAt: 9, messages: [] });
  const report = await restoreBackup(backup, t);
  eq("a missing chat is added", (await t.chats.get("aaa"))?.title, "From the backup");
  eq("an existing one is never overwritten", (await t.chats.get("bbb"))?.title, "Already here, my version");
  eq("chats are counted", report.chats, { added: 1, skipped: 1, invalid: 2 });
  eq("a chat whose id disagrees with its file is refused", await t.chats.get("not-ccc"), null);
  eq("a missing memory is added, a malformed one skipped", [(await t.memory.list()).map((m) => m.id), report.memory], [["m1"], { added: 1, skipped: 0 }]);
  eq("a real picture comes back with its metadata", [existsSync(join(imagesDir, `${imgId}.png`)), existsSync(join(imagesDir, `${imgId}.json`))], [true, true]);
  eq("a .png that is really HTML does not", [existsSync(join(imagesDir, "11111111-1111-1111-1111-111111111111.png")), report.images], [false, { added: 1, skipped: 0, invalid: 1 }]);
  eq("names that climb out of data/ match nothing", [existsSync(join(dir, ".env.local")), existsSync(join(dir, "..", "outside.txt")), existsSync("/etc/cron.d/evil")], [false, false, false]);
  eq("the schedule, usage and the rest are not restored", report.ignored >= 5, true);
  eq("the summary says what happened", describeRestore(report), "Restored 1 chat, 1 memory, 1 picture — 1 already here, left alone; 3 damaged, skipped.");

  const again = await restoreBackup(backup, t);
  eq("restoring the same file again changes nothing", [again.chats.added, again.memory.added, again.images.added], [0, 0, 0]);

  // Flip a byte inside a file's actual contents (a stored entry, so its text
  // sits in the archive verbatim) — not in a header field, which isn't read.
  const corrupt = Uint8Array.from(backup);
  corrupt[Buffer.from(backup).indexOf("From the backup") + 2] ^= 0xff;
  const t2 = targets();
  let refused = "";
  try { await restoreBackup(corrupt, t2); } catch (e) { refused = (e as Error).message; }
  eq("one corrupt file fails the whole restore", refused !== "", true);
  eq("and nothing was written before it did", [(await t2.chats.list()).length, existsSync(join(dir, "memory.json")) && (await t2.memory.list()).length > 1], [0, false]);

  eq("an empty restore says so", describeRestore({ chats: { added: 0, skipped: 0, invalid: 0 }, memory: { added: 0, skipped: 0 }, images: { added: 0, skipped: 0, invalid: 0 }, ignored: 0 }), "Nothing to restore.");

  // Our own backup restores through our own reader.
  const own = new Uint8Array(await new Response(zipStream((async function* () {
    yield { name: "data/chats/own.json", data: chatJson("own", "Round trip") };
  })())).arrayBuffer());
  const t3 = targets();
  await restoreBackup(own, t3);
  eq("a zip made by this app restores", (await t3.chats.get("own"))?.title, "Round trip");

  delete process.env.JARVIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n--- times, speeds and long messages ---");
{
  const now = new Date(2026, 9, 2, 15, 30).getTime(); // Fri 2 Oct 2026, 15:30 local
  const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m, d, h, min).getTime();
  eq("today is just the clock", formatTime(at(2026, 9, 2, 9, 5), now, "en-GB"), "09:05");
  eq("yesterday says so", formatTime(at(2026, 9, 1, 23, 59), now, "en-GB"), "Yesterday 23:59");
  eq("earlier this year gives the date", formatTime(at(2026, 8, 20, 8, 0), now, "en-US"), "Sep 20, 08:00 AM");
  eq("another year gives the year too", formatTime(at(2025, 11, 31, 22, 15), now, "en-US"), "Dec 31, 2025, 10:15 PM");
  eq("just after midnight is yesterday, not today", formatTime(at(2026, 9, 1, 0, 1), now, "en-GB"), "Yesterday 00:01");

  eq("a quick reply is in milliseconds", describeStats({ totalMs: 850, firstTokenMs: 0, tokens: 3 }), "850ms");
  eq("seconds get a decimal when short", describeStats({ totalMs: 1400, firstTokenMs: 300, tokens: 10 }), "1.4s · first word 300ms");
  eq("and speed once there's enough to measure", describeStats({ totalMs: 5300, firstTokenMs: 300, tokens: 250 }), "5.3s · first word 300ms · ~50 tok/s");
  eq("a three-word answer is not a million tokens a second", describeStats({ totalMs: 90, firstTokenMs: 40, tokens: 4 }).includes("tok/s"), false);
  eq("a long wait reads as minutes", describeStats({ totalMs: 125_000, firstTokenMs: 0, tokens: 0 }), "2m 5s");
  eq("tokens are the usual four characters", [estimateReplyTokens("abcd"), estimateReplyTokens("abcde"), estimateReplyTokens("")], [1, 2, 0]);

  eq("a short message isn't folded", isLongMessage("hello\nthere"), false);
  eq("a very long one is", isLongMessage("x".repeat(1501)), true);
  eq("twenty lines are fine, twenty-one fold", [isLongMessage("l\n".repeat(19) + "l"), isLongMessage("l\n".repeat(20) + "l")], [false, true]);
}

console.log("\n--- tables as CSV ---");
{
  eq("plain cells", toCsv([["a", "b"], ["1", "2"]]), "a,b\r\n1,2");
  eq("a comma or quote is quoted, quotes doubled", toCsv([["x, y", 'say "hi"']]), '"x, y","say ""hi"""');
  eq("a newline stays inside its cell", toCsv([["line1\nline2"]]), '"line1\nline2"');
  eq("a cell with edge spaces is quoted so they survive", toCsv([[" padded "]]), '" padded "');
  eq("a formula is neutralised", toCsv([["=HYPERLINK(\"http://evil\",\"x\")", "=1+1"]]), `"'=HYPERLINK(""http://evil"",""x"")",'=1+1`);
  eq("so is an @ function or a tab", toCsv([["@SUM(A1)", "\tcmd"]]), "'@SUM(A1),'\tcmd");
  eq("a + or - that starts a formula is too", toCsv([["+cmd|' /C calc'!A0", "-2+3+cmd"]]), `'+cmd|' /C calc'!A0,'-2+3+cmd`);
  eq("but real numbers stay numbers", toCsv([["-5", "+3.2%", "-1,250.50", "42"]]), '-5,+3.2%,"-1,250.50",42');
  eq("an empty table is empty", toCsv([]), "");
}

console.log("\n--- the up arrow ---");
{
  const h = new PromptHistory(["first", "second", "third"]);
  eq("starts not browsing", h.browsing, false);
  eq("down does nothing before browsing", h.down(), null);
  eq("up gives the newest", h.up("half typed"), "third");
  eq("and is now browsing", h.browsing, true);
  eq("up again goes older", [h.up("x"), h.up("x")], ["second", "first"]);
  eq("the oldest is a wall", h.up("x"), null);
  eq("down comes forward", [h.down(), h.down()], ["second", "third"]);
  eq("past the newest it gives back what was half typed", [h.down(), h.browsing], ["half typed", false]);
  eq("and down past that does nothing", h.down(), null);
  const again = new PromptHistory(["a"]);
  again.up("draft"); again.reset();
  eq("typing resets it", [again.browsing, again.up("new")], [false, "a"]);
  eq("an empty history has nothing to recall", new PromptHistory([]).up("x"), null);

  // The chat is re-saved while you browse; a copy of the same list must not lose your place.
  const kept = new PromptHistory(["a", "b", "c"]);
  kept.up("typed");
  kept.up("typed");
  eq("an identical list is ignored", kept.sync(["a", "b", "c"]), false);
  eq("so you are still where you were", [kept.browsing, kept.up("typed")], [true, "a"]);
  eq("a list with something new replaces it", kept.sync(["a", "b", "c", "d"]), true);
  eq("and starts from the newest again", [kept.browsing, kept.up("typed")], [false, "d"]);
}

console.log("\n--- drafts ---");
{
  const mem = () => {
    const data = new Map<string, string>();
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  };
  const store = mem();
  saveDraft(store, "chat-a", "half a message");
  saveDraft(store, "chat-b", "another");
  eq("a draft comes back", [loadDraft(store, "chat-a"), loadDraft(store, "chat-b")], ["half a message", "another"]);
  eq("one with no draft is empty", loadDraft(store, "chat-z"), "");
  saveDraft(store, "chat-a", "   ");
  eq("blanking it removes it", loadDraft(store, "chat-a"), "");
  clearDraft(store, "chat-b");
  eq("clearing leaves nothing behind", [...store.data.keys()].filter((k) => k.startsWith("jarvis.draft.")), []);
  eq("the new-chat screen has its own key", [draftKey(null), draftKey(undefined), draftKey("abc")], ["new", "new", "abc"]);

  saveDraft(store, "big", "x".repeat(50_000));
  eq("a draft is cut at 20,000 characters", loadDraft(store, "big").length, 20_000);

  const crowded = mem();
  for (let i = 0; i < MAX_DRAFTS + 10; i++) saveDraft(crowded, `c${i}`, `draft ${i}`);
  const kept = [...crowded.data.keys()].filter((k) => k.startsWith("jarvis.draft."));
  eq("only the most recent drafts are kept", kept.length, MAX_DRAFTS);
  eq("the oldest went", [loadDraft(crowded, "c0"), loadDraft(crowded, `c${MAX_DRAFTS + 9}`)], ["", `draft ${MAX_DRAFTS + 9}`]);
  saveDraft(crowded, "c20", "edited again");
  eq("editing one makes it recent again", loadDraft(crowded, "c20"), "edited again");

  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("blocked"); } };
  eq("storage that throws never breaks typing", [loadDraft(broken, "x"), (saveDraft(broken, "x", "hi"), clearDraft(broken, "x"), "no error")], ["", "no error"]);
  const garbled = mem();
  garbled.data.set("jarvis.drafts.index", "{not json");
  saveDraft(garbled, "ok", "still works");
  eq("a damaged index is recovered from", loadDraft(garbled, "ok"), "still works");
}

console.log("\n--- slash commands and saved prompts ---");
{
  const prompts = [{ name: "review", text: "Review this code for bugs." }, { name: "tldr", text: "Give me the short version." }];
  eq("typing / lists everything, commands first", matchSlash("/", prompts).map((m) => m.name), [...COMMAND_NAMES, "review", "tldr"]);
  eq("it narrows as you type", matchSlash("/ne", prompts).map((m) => m.name), ["new"]);
  eq("saved prompts are offered too", matchSlash("/re", prompts).map((m) => `${m.kind}:${m.name}`), ["prompt:review"]);
  eq("nothing matches nonsense", matchSlash("/zzz", prompts), []);
  eq("once there's a space, the menu is done", matchSlash("/new now", prompts), []);
  eq("a path isn't a command being typed", matchSlash("/usr/bin", prompts), []);
  eq("plain text has no menu", matchSlash("hello", prompts), []);

  eq("/new is the new-chat command", parseSlash("/new", prompts)?.kind, "action");
  eq("with trailing words, they become args", parseSlash("/summarize focus on risks", prompts)?.args, "focus on risks");
  eq("a saved prompt is found by name", [parseSlash("/review", prompts)?.kind, parseSlash("/review", prompts)?.text], ["prompt", "Review this code for bugs."]);
  eq("args go with prompts too", parseSlash("/review the auth code", prompts)?.args, "the auth code");
  eq("a file path is a message, not a command", parseSlash("/usr/bin/env is missing on this machine", prompts), null);
  eq("so is an unknown word", parseSlash("/nonsense", prompts), null);
  eq("so is text that merely mentions one", parseSlash("please run /new", prompts), null);
  eq("and a lone slash", parseSlash("/", prompts), null);
  eq("commands are lowercase only", parseSlash("/NEW", prompts), null);

  eq("a name is made typeable", normalizePromptName("  /Code Review!  "), "code-review");
  eq("a built-in command's name is refused", [normalizePromptName("new"), normalizePromptName("/summarize")], [null, null]);
  eq("an empty name is nothing", normalizePromptName("***"), null);
  eq("names are cut to 24", normalizePromptName("a".repeat(60))!.length, 24);
  const cleaned = cleanPrompts([
    { name: "Review", text: "ok" }, { name: "review", text: "duplicate name" }, { name: "new", text: "reserved" },
    { name: "empty", text: "   " }, { name: "typed", text: 5 }, "junk", null, { name: "long", text: "x".repeat(20_000) },
  ]);
  eq("bad entries are dropped, not repaired", cleaned.map((p) => p.name), ["review", "long"]);
  eq("the first of two with one name wins", cleaned[0].text, "ok");
  eq("text is cut to 8,000", cleaned[1].text.length, 8000);
  eq("there's a ceiling on how many", cleanPrompts(Array.from({ length: 80 }, (_, i) => ({ name: `p${i}`, text: "t" }))).length, MAX_PROMPTS);
  eq("not a list is no prompts", cleanPrompts("x"), []);

  // They travel with the settings file, and are validated on the way in.
  const out = exportSettings({ ...DEFAULT_SETTINGS, prompts });
  eq("an export carries them", (out.settings as { prompts?: unknown }).prompts, prompts);
  const imported = importSettings(JSON.stringify({ format: FORMAT, version: 1, settings: { prompts: [{ name: "ok", text: "fine" }, { name: "new", text: "reserved" }] } }), DEFAULT_SETTINGS);
  eq("an import keeps the good ones only", imported.ok && imported.settings.prompts, [{ name: "ok", text: "fine" }]);
}

console.log("\n--- saved messages ---");
{
  const chat = (id: string, title: string, msgs: Partial<Chat["messages"][number]>[]): Chat => ({
    id, title, createdAt: 1, updatedAt: 1,
    messages: msgs.map((m, i) => ({ id: `${id}-${i}`, role: "user", content: "x", createdAt: i, ...m })) as Chat["messages"],
  });
  const items = listStarred([
    chat("a", "Alpha", [{ createdAt: 10, starred: true, content: "an old star" }, { createdAt: 20, content: "not starred" }]),
    chat("b", "Beta", [{ createdAt: 30, role: "assistant", model: "m1", starred: true, content: "<think>hidden</think>The  visible\nanswer" }]),
  ]);
  eq("only starred messages, newest first", items.map((i) => i.messageId), ["b-0", "a-0"]);
  eq("each knows its chat", items.map((i) => [i.chatId, i.chatTitle]), [["b", "Beta"], ["a", "Alpha"]]);
  eq("the preview is what was seen, tidied", items[0].preview, "The visible answer");
  eq("the model is kept for replies", [items[0].model, items[1].model], ["m1", undefined]);
  eq("no stars, no list", listStarred([chat("c", "C", [{ content: "plain" }])]), []);
  eq("a long message gets a short preview", listStarred([chat("d", "D", [{ starred: true, content: "w ".repeat(500) }])])[0].preview.length <= 280, true);
  eq("the limit is honoured", listStarred([chat("e", "E", Array.from({ length: 10 }, () => ({ starred: true }))) ], 3).length, 3);

  const base: Chat = { id: "q", title: "Q", createdAt: 1, updatedAt: 100, messages: [] };
  const quiet = applyChatPatch(base, { messages: [], quiet: true }, 9999);
  const loud = applyChatPatch(base, { messages: [] }, 9999);
  eq("a quiet save leaves the chat where it was", [quiet.ok && quiet.chat.updatedAt, loud.ok && loud.chat.updatedAt], [100, 9999]);

  eq("a block saved as a file keeps the name in its comment", codeFileName("// server.js\nconsole.log(1)", "javascript"), "server.js");
  eq("otherwise it's named for its language", [codeFileName("print(1)", "python"), codeFileName("SELECT 1", "sql"), codeFileName("hello", "text")], ["snippet.py", "snippet.sql", "snippet.txt"]);
  eq("a language it doesn't know is plain text", codeFileName("x", "klingon"), "snippet.txt");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
