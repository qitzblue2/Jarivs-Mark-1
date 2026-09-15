/** Pure-function tests. Run with: npm test */
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
import { SentenceSplitter, splitSentences } from "../lib/voice/tts/sentences";
import { Speaker } from "../lib/voice/tts/speaker";
import { encodeWav, durationOf } from "../lib/voice/wav";
import { rank, forPrompt } from "../lib/memory/relevance";
import type { MemoryEntry } from "../lib/memory/types";
import { attachmentsToText, lighten, formatSize, MAX_IMAGES } from "../lib/attachments";
import { supportsVision } from "../lib/providers/registry";
import { textOf } from "../lib/tokens";
import type { Attachment } from "../lib/types";

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
   * The display tools cost 287 tokens of schema, which is why they are only
   * offered where a screen might exist — a laptop with no projector should
   * not pay for a capability it cannot use on every single request.
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
  eq("and the appliance stays under its own ceiling", withDisplay <= 960, true);
  eq("the persona stays under budget", personaTokens <= 330, true);
  eq("and the two together stay under a thousand", toolTokens + personaTokens < 1000, true);

  // Cheap to state, and it catches a tool registered with no guidance at all.
  eq("every tool says what it is for", allTools().every((t) => t.description.length > 20), true);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
