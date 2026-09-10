/** Pure-function tests. Run with: npm test */
import { extractCodeBlocks, artifactsFromMessage, buildPreviewDocument } from "../lib/codeblocks";
import { trimToBudget, truncateMiddle, estimateTokens } from "../lib/tokens";
import { ToolCallAccumulator, extractChunk } from "../lib/stream";
import { evaluate } from "../lib/tools/calculate";
import { runToolCall } from "../lib/tools/run";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
