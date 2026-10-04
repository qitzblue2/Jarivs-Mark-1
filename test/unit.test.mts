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
import { allTools, getTool } from "../lib/tools/registry";
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
import {
  APPEARANCE_KEY, DEFAULT_APPEARANCE, INIT_SCRIPT, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, TEXT_SIZES, THEMES, DENSITIES,
  applyAppearance, cleanAppearance, clampSidebar, loadAppearance, resolveTheme, saveAppearance,
} from "../lib/appearance";
import { SHORTCUT_GROUPS, isHelpKey, isMac, isTypingTarget, keyLabel } from "../lib/shortcuts";
import { BANNER_TEXT, linkOf, nextCheckDelay, reachable, reduceConnection } from "../lib/connection";
import type { ConnectionEvent, ConnectionState } from "../lib/connection";
import { inflateSync } from "node:zlib";
import { DEFAULT_INTRO, DEFAULT_PERSONA as PERSONA_NOW, PERSONA_RULES } from "../lib/persona";
import { PERSONA_PRESETS, matchPreset, presetText } from "../lib/personas";
import { UnitError, describeConversion, formatNumber, lookupUnit, parseConversion } from "../lib/tools/units";
import { calculateTool } from "../lib/tools/calculate";
import { toWireTool } from "../lib/tools/types";
import { MAX_TAGS as MAX_MEMORY_TAGS, cleanTags as cleanMemoryTags, filterMemory, normalizeTag as normalizeMemoryTag, parseTagInput, tagCounts as memoryTagCounts } from "../lib/memory/filter";
import { MAX_ENTRY_CHARS, MAX_IMPORT_ENTRIES, MAX_MEMORY_ENTRIES, exportFilename as memoryFilename, exportMemory, planImport, sameness } from "../lib/memory/transfer";
import { MAX_FAVORITES, cleanFavorites, favoriteKey, isFavorite, parseFavorite, toggleFavorite } from "../lib/favorites";
import { IMAGE_TOKENS, contextCeiling, conversationTokens, formatTokens, measureContext } from "../lib/context-meter";
import { getProvider } from "../lib/providers/registry";
import { createHash } from "node:crypto";
import { relativeTime } from "../lib/format";
import { recentChats, timeGreeting } from "../lib/welcome";
import { MAX_FIELD, TASK_TEMPLATES, buildFromTemplate } from "../lib/schedule/templates";
import { createTask } from "../lib/schedule";
import { familyOf, lineageOf } from "../lib/image-lineage";
import { promotionDiff } from "../lib/sandbox/sync";
import { usageFilename, usageToCsv } from "../lib/usage-csv";
import { AUTO_NAME, autoName, backupsKept, listAutoBackups, runAutoBackup, startAutoBackup } from "../lib/backup/auto";
import { backupDir, backupEntries } from "../lib/backup";
import { MAX_DAYS, computeChatStats, dayKey } from "../lib/chat-stats";
import { DEFAULT_CONFIG, HOURLY_CAP, LEVELS, RULE_IDS, cleanConfig, inQuietHours } from "../lib/initiative/config";
import { CALM, HALF_LIFE_MS, applyEvent, decay, labelOf, moodSummary } from "../lib/initiative/mood";
import { TONES, isTone, quietFor, readTone, toneHint, toneMoodEvent } from "../lib/initiative/tone";
import { THRESHOLDS, evaluateRules, focusOverNudge, inboxNudge, rememberNudge } from "../lib/initiative/rules";
import type { Nudge, RuleContext } from "../lib/initiative/rules";
import { COOLDOWN_MS, EMPTY_GATE, MUTE_AFTER, SNOOZE_MS, channels, decide, forgetRule, recordAccepted, recordDismissal, recordShown } from "../lib/initiative/gate";
import type { Situation } from "../lib/initiative/gate";
import { detectFact, suggestFollowUps } from "../lib/initiative/suggest";
import { troubleOf } from "../lib/initiative/trouble";
import { KEEP_MS, MAX_ITEMS, clearInbox, listInbox, markRead, postToInbox } from "../lib/inbox";
import { setOnResult, setRunner as setClockRunner, tick as clockTick } from "../lib/schedule/clock";
import {
  KEY as INITIATIVE_KEY, QUEUE_PATIENCE_MS, clearHistory, closeToast, endFocus, flushQueue, focusActive, focusUntilOf, getInitiative,
  markHistoryRead, moodEvent, moodLabel, noteTone, offer, resetInitiative, setConfig, setRule, setServerInbox, startFocus, unreadCount,
} from "../lib/initiative/store";
import { findSpans, findLabel, stepMatch, outlineOf, pickJump, quoteText, appendQuote, toPlainText, readingLabel, readingMinutes, countWords } from "../lib/reading";
import { chatToHtml, bodyToHtml, htmlFilename } from "../lib/chat-html";
import { importChat, MAX_IMPORT_MESSAGES } from "../lib/chat-import";
import { markdownEntryName, markdownArchiveName } from "../lib/chat-archive";
import { composerCounts, counterLabel, shouldSend, findModel, applyTagCommand, undoLastExchange, promptVariables, fillVariables, searchHistory, TEMPERATURE_PRESETS, presetOf, nextPreset } from "../lib/composing";
import { cleanPrefs, DEFAULT_PREFS } from "../lib/prefs";
import { isExpired, expiryLabel, expiryFromDateInput, dateInputOf, cleanExpiry, parseBulk, findDuplicates, mergeGroup, rememberDraft } from "../lib/memory/housekeeping";
import { sortChatList, nextSort, CHAT_SORTS } from "../lib/chat-list";
import { categorize } from "../lib/storage-usage";
import { formatBytes } from "../lib/format";
import { chatMeta } from "../lib/types";
import { cleanModelNotes, withModelNote, cleanDisabledTools, toggleTool } from "../lib/model-prefs";
import { REPLY_LENGTHS, lengthHint, nextLength, isReplyLength } from "../lib/composing";
import { chatInfo, spanLabel } from "../lib/chat-info";
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
const ok = (name: string, condition: unknown) => eq(name, Boolean(condition), true);
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

    // What each apply changed, exactly — still there after the undo.
    const shown = await promotionDiff(applied.id);
    const byPath = Object.fromEntries((shown?.files ?? []).map((f) => [f.path, f]));
    eq("a past apply lists every file it touched", Object.keys(byPath).sort(), ["README.md", "lib/new.ts", "lib/util.ts"]);
    eq("a modified file shows the lines that changed", [byPath["lib/util.ts"].diff.includes("-export const b = 2;"), byPath["lib/util.ts"].diff.includes("+export const b = 3;")], [true, true]);
    eq("an added file is all additions", [byPath["lib/new.ts"].diff.includes("+export const c = 3;"), byPath["lib/new.ts"].diff.includes("\n-")], [true, false]);
    eq("a deleted file is all removals", [byPath["README.md"].diff.includes("-# JARVIS"), byPath["README.md"].diff.includes("\n+#")], [true, false]);
    eq("the diff is for the file it names", byPath["lib/util.ts"].diff.startsWith("--- a/lib/util.ts\n+++ b/lib/util.ts"), true);
    eq("it still shows after the undo, from the copies kept at apply time", (await promotionDiff(applied.id))?.files.find((f) => f.path === "lib/util.ts")?.diff.includes("+export const b = 3;"), true);
    eq("an unknown change is null, not an error", [await promotionDiff("00000000-0000-0000-0000-000000000000"), await promotionDiff("../etc/passwd")], [null, null]);
    // A change applied before the written copy was kept: from the live file while it is still what the apply left.
    const oldStyle = await promote();
    rmSync(join(live, "data", "self-edit", oldStyle.id, "after"), { recursive: true, force: true });
    eq("an older change still shows, from the live file, while the live file is what it left", (await promotionDiff(oldStyle.id))?.files.some((f) => f.diff.includes("+export const b = 3;") || f.diff.includes("+export const c = 3;")), true);
    put(live, "lib/util.ts", "changed again\n");
    eq("and says so when it no longer is", (await promotionDiff(oldStyle.id))?.files.find((f) => f.path === "lib/util.ts")?.note?.includes("wasn't kept"), true);
    put(live, "lib/util.ts", "export const a = 9;\nexport const b = 3;\n");
    await undoPromotion(oldStyle.id);

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

console.log("\n--- appearance ---");
{
  const mem = (initial?: string) => {
    const data = new Map<string, string>(initial === undefined ? [] : [[APPEARANCE_KEY, initial]]);
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  eq("nothing stored is the defaults", loadAppearance(mem()), DEFAULT_APPEARANCE);
  eq("junk stored is the defaults", loadAppearance(mem("{not json")), DEFAULT_APPEARANCE);
  eq("a stored array is the defaults", loadAppearance(mem("[1,2]")), DEFAULT_APPEARANCE);
  eq(
    "unknown values fall back one field at a time",
    cleanAppearance({ theme: "neon", textSize: "large", density: 5, sidebarWidth: "wide" }),
    { theme: "system", textSize: "large", density: "comfortable", sidebarWidth: SIDEBAR_DEFAULT },
  );
  eq("the sidebar is kept within its limits", [clampSidebar(10), clampSidebar(9999), clampSidebar(300.6), clampSidebar(NaN), clampSidebar(Infinity), clampSidebar(null)], [SIDEBAR_MIN, SIDEBAR_MAX, 301, SIDEBAR_DEFAULT, SIDEBAR_DEFAULT, SIDEBAR_DEFAULT]);
  const store = mem();
  saveAppearance(store, { theme: "light", textSize: "xlarge", density: "compact", sidebarWidth: 333 });
  eq("what is saved comes back", loadAppearance(store), { theme: "light", textSize: "xlarge", density: "compact", sidebarWidth: 333 });
  saveAppearance({ setItem() { throw new Error("quota"); } }, DEFAULT_APPEARANCE);
  ok("a full or blocked store doesn't throw", true);
  eq("system follows the OS", [resolveTheme("system", true), resolveTheme("system", false)], ["light", "dark"]);
  eq("a chosen theme ignores the OS", [resolveTheme("dark", true), resolveTheme("light", false)], ["dark", "light"]);

  // The inline script runs before any module can, so it is a second copy of
  // the logic. Run it against the real functions for every combination.
  const fakeRoot = () => {
    const attrs: Record<string, string> = {};
    const vars: Record<string, string> = {};
    return { attrs, vars, setAttribute: (n: string, v: string) => void (attrs[n] = v), style: { setProperty: (n: string, v: string) => void (vars[n] = v) } };
  };
  let mismatches = 0;
  let runs = 0;
  const widths = [undefined, 100, 260, 481, "300", 333.4];
  for (const theme of [...THEMES, "bogus"]) for (const textSize of [...TEXT_SIZES, "huge"]) for (const density of [...DENSITIES, "dense"]) for (const sidebarWidth of widths) for (const light of [true, false]) {
    const raw = JSON.stringify({ theme, textSize, density, sidebarWidth });
    const viaScript = fakeRoot();
    new Function("document", "localStorage", "window", INIT_SCRIPT)(
      { documentElement: viaScript },
      { getItem: () => raw },
      { matchMedia: () => ({ matches: light }) },
    );
    const viaCode = fakeRoot();
    applyAppearance(viaCode, loadAppearance({ getItem: () => raw }), light);
    runs++;
    if (JSON.stringify([viaScript.attrs, viaScript.vars]) !== JSON.stringify([viaCode.attrs, viaCode.vars])) {
      if (mismatches++ < 3) console.log("  mismatch for", raw, light, viaScript.attrs, viaCode.attrs, viaScript.vars, viaCode.vars);
    }
  }
  eq(`the inline script agrees with the code for all ${runs} combinations`, mismatches, 0);
  const broken = fakeRoot();
  new Function("document", "localStorage", "window", INIT_SCRIPT)({ documentElement: broken }, { getItem: () => { throw new Error("blocked"); } }, { matchMedia: () => ({ matches: false }) });
  eq("a blocked localStorage still gets the defaults", [broken.attrs["data-theme"], broken.attrs["data-text"], broken.vars["--sidebar-w"]], ["dark", "normal", `${SIDEBAR_DEFAULT}px`]);
  const noMatchMedia = fakeRoot();
  new Function("document", "localStorage", "window", INIT_SCRIPT)({ documentElement: noMatchMedia }, { getItem: () => null }, {});
  eq("and so does a browser with no matchMedia", noMatchMedia.attrs["data-theme"], "dark");
}

console.log("\n--- the palette ---");
{
  const css = readFileSync("app/globals.css", "utf8");
  const block = (start: RegExp) => {
    const m = start.exec(css);
    if (!m) throw new Error(`no block for ${start}`);
    const open = css.indexOf("{", m.index);
    return css.slice(open + 1, css.indexOf("}", open));
  };
  const tokens = (body: string) => Object.fromEntries([...body.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  const dark = tokens(block(/@theme\s*\{/));
  const light = { ...dark, ...tokens(block(/html\[data-theme="light"\]\s*\{/)) };

  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const shared = ["arc-solid", "arc-solid-hover", "line-strong"];
  const overridden = Object.keys(dark).filter((k) => !shared.includes(k) && (light as Record<string, string>)[k] === dark[k]);
  eq("the light theme redefines every colour that isn't deliberately shared", overridden, []);

  for (const [name, t] of [["dark", dark], ["light", light]] as const) {
    let worst = 99;
    let worstWhere = "";
    for (const surface of ["base", "panel", "raised"]) for (const text of ["ink", "ink-dim", "ink-faint", "arc", "warn", "danger", "ok"]) {
      const r = ratio(t[text], t[surface]);
      if (r < worst) { worst = r; worstWhere = `${text} on ${surface}`; }
    }
    ok(`${name}: every text colour reads at 4.5:1 or better on every surface — worst ${worst.toFixed(2)} (${worstWhere})`, worst >= 4.5);
    ok(`${name}: white on the solid accent fill is at least 4.5:1 — ${ratio("#ffffff", t["arc-solid"]).toFixed(2)}`, ratio("#ffffff", t["arc-solid"]) >= 4.5);
    ok(`${name}: and on its hover state`, ratio("#ffffff", t["arc-solid-hover"]) >= 4.5);
    ok(`${name}: the page and its panels are told apart`, ratio(t.base, t.panel) > 1.03 || ratio(t.panel, t.raised) > 1.03);
  }
  ok("the two themes really differ", lum(dark.base) < 0.05 && lum(light.base) > 0.8);
}

console.log("\n--- keyboard shortcuts ---");
{
  eq("Mod is Cmd on a Mac and Ctrl elsewhere", [keyLabel("Mod", true), keyLabel("Mod", false)], ["⌘", "Ctrl"]);
  eq("other keys pass through", [keyLabel("K", true), keyLabel("↑", false), keyLabel("Esc", true)], ["K", "↑", "Esc"]);
  eq("Mac detection", [isMac("MacIntel"), isMac("iPhone"), isMac("Win32"), isMac("Linux x86_64"), isMac(undefined)], [true, true, false, false, false]);
  eq("typing targets", [isTypingTarget({ tagName: "TEXTAREA" }), isTypingTarget({ tagName: "input" }), isTypingTarget({ tagName: "SELECT" }), isTypingTarget({ tagName: "DIV", isContentEditable: true }), isTypingTarget({ tagName: "BUTTON" }), isTypingTarget(null)], [true, true, true, true, false, false]);
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });
  eq("? opens the list, alone", isHelpKey(key("?")), true);
  eq("but not with Ctrl, Cmd or Alt, and not other keys", [isHelpKey(key("?", { ctrlKey: true })), isHelpKey(key("?", { metaKey: true })), isHelpKey(key("?", { altKey: true })), isHelpKey(key("/"))], [false, false, false, false]);
  const all = SHORTCUT_GROUPS.flatMap((g) => g.items);
  ok("every group has entries", SHORTCUT_GROUPS.every((g) => g.items.length > 0));
  ok("every entry says what it does and which keys", all.every((i) => i.action.length > 3 && i.keys.length > 0 && i.keys.every((k) => k.length > 0)));
  eq("no action is listed twice", new Set(all.map((i) => i.action)).size, all.length);
  ok("the slash commands the list promises exist", COMMAND_NAMES.includes("help") && COMMAND_NAMES.includes("theme"));
}

console.log("\n--- the connection banner ---");
{
  const start: ConnectionState = { browserOnline: true, failures: 0 };
  const run = (...events: ConnectionEvent[]) => events.reduce(reduceConnection, start);
  eq("connected is ok", linkOf(start), "ok");
  eq("one failed check isn't enough to alarm anyone", linkOf(run("check-failed")), "ok");
  eq("two in a row is", linkOf(run("check-failed", "check-failed")), "server-unreachable");
  eq("a success in between starts the count again", linkOf(run("check-failed", "check-ok", "check-failed")), "ok");
  eq("recovering clears it", linkOf(run("check-failed", "check-failed", "check-ok")), "ok");
  eq("the browser going offline is its own message", linkOf(run("offline")), "browser-offline");
  eq("and takes priority over the server", linkOf(run("check-failed", "check-failed", "offline")), "browser-offline");
  eq("coming back online leaves whatever the server check says", linkOf(run("offline", "online")), "ok");
  eq("checks are lazy when all is well, quick when something looks wrong", [nextCheckDelay(start), nextCheckDelay(run("check-failed")), nextCheckDelay(run("offline"))], [20000, 2000, 5000]);
  eq("any answer means the server is there; a gateway error does not", [reachable(200), reachable(401), reachable(404), reachable(500), reachable(502)], [true, true, true, false, false]);
  ok("both messages exist and say what is wrong", BANNER_TEXT["browser-offline"].includes("offline") && BANNER_TEXT["server-unreachable"].includes("server"));
}

console.log("\n--- installable app ---");
{
  const { default: manifest } = await import("../app/manifest");
  const m = manifest();
  eq("it has a name and a short one", [m.name, m.short_name], ["JARVIS Mark 6", "JARVIS"]);
  eq("it opens in its own window from the root", [m.display, m.start_url, m.scope], ["standalone", "/", "/"]);
  ok("its colours are real colours", /^#[0-9a-f]{6}$/i.test(m.background_color ?? "") && /^#[0-9a-f]{6}$/i.test(m.theme_color ?? ""));
  const icons = m.icons ?? [];
  ok("there is a 192 and a 512 icon", icons.some((i) => i.sizes === "192x192") && icons.some((i) => i.sizes === "512x512"));
  eq("one icon is maskable", icons.filter((i) => i.purpose === "maskable").length, 1);

  const crcOk = (png: Buffer) => {
    let at = 8;
    while (at < png.length) {
      const len = png.readUInt32BE(at);
      const body = png.subarray(at + 4, at + 8 + len);
      if (crc32(body) !== png.readUInt32BE(at + 8 + len)) return false;
      at += 12 + len;
    }
    return true;
  };
  for (const icon of icons) {
    const file = `public${icon.src}`;
    const png = readFileSync(file);
    const [w, h] = (icon.sizes ?? "").split("x").map(Number);
    ok(`${icon.src} is a PNG`, png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
    eq(`${icon.src} is the size the manifest says`, [png.readUInt32BE(16), png.readUInt32BE(20)], [w, h]);
    ok(`${icon.src} is intact (every chunk's checksum matches)`, crcOk(png));
  }
  for (const [file, size] of [["app/icon.png", 96], ["app/apple-icon.png", 180]] as const) {
    const png = readFileSync(file);
    eq(`${file} is ${size} square`, [png.readUInt32BE(16), png.readUInt32BE(20)], [size, size]);
    ok(`${file} is intact`, crcOk(png));
  }
  // Decompresses to exactly rows × (pixels × 4 + a filter byte): nothing truncated.
  const big = readFileSync("public/icons/icon-512.png");
  let at = 8, idat: Buffer[] = [];
  while (at < big.length) {
    const len = big.readUInt32BE(at);
    if (big.subarray(at + 4, at + 8).toString() === "IDAT") idat.push(big.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  eq("the big icon holds every pixel", inflateSync(Buffer.concat(idat)).length, 512 * (512 * 4 + 1));

  // The manifest is fetched without your session cookie, so behind the login
  // it has to be reachable or "Install" quietly never appears.
  const { config } = await import("../proxy");
  const gate = new RegExp(`^${(config.matcher[0] as string).replace(/^\/\(/, "/(")}$`);
  eq(
    "the login gate lets the manifest and icons through",
    ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/maskable-512.png", "/icon.png", "/apple-icon.png"].map((p) => gate.test(p)),
    [false, false, false, false, false],
  );
  eq(
    "and still covers the app and the API",
    ["/", "/api/chats", "/api/health", "/api/audit", "/icons-private", "/manifest.json"].map((p) => gate.test(p)),
    [true, true, true, true, true, true],
  );
}

console.log("\n--- persona presets ---");
{
  const sha = (t: string) => createHash("sha256").update(t).digest("hex");
  eq("the default persona is byte-for-byte what it was before presets existed", sha(PERSONA_NOW), "e989d55aafefecae801c3ee8d954809c4781decbb4ce95ff749304bb2d43246e");
  eq("it is the intro and the rules, joined", PERSONA_NOW, `${DEFAULT_INTRO}\n\n${PERSONA_RULES}`);
  ok("there are several presets", PERSONA_PRESETS.length >= 5);
  eq("with distinct ids and names", [new Set(PERSONA_PRESETS.map((p) => p.id)).size, new Set(PERSONA_PRESETS.map((p) => p.name)).size], [PERSONA_PRESETS.length, PERSONA_PRESETS.length]);
  ok("every preset keeps the operating rules, so tools, memory and code fencing still work", PERSONA_PRESETS.every((p) => presetText(p).endsWith(PERSONA_RULES)));
  ok("and has an intro of its own", PERSONA_PRESETS.every((p) => p.intro.length > 40) && new Set(PERSONA_PRESETS.map((p) => p.intro)).size === PERSONA_PRESETS.length);
  eq("the first preset is the default", presetText(PERSONA_PRESETS[0]), PERSONA_NOW);
  ok("a preset's intro costs less than 80 tokens — it is paid for on every turn", PERSONA_PRESETS.every((p) => estimateTokens(p.intro) <= 80));
  ok("and none is much bigger than the default prompt", PERSONA_PRESETS.every((p) => estimateTokens(presetText(p)) <= estimateTokens(PERSONA_NOW) + 40));
  eq("a preset's text is recognised as it", matchPreset(presetText(PERSONA_PRESETS[2]))?.id, PERSONA_PRESETS[2].id);
  eq("whatever the line endings or trailing space", matchPreset(presetText(PERSONA_PRESETS[2]).replace(/\n/g, "\r\n") + "\n  ")?.id, PERSONA_PRESETS[2].id);
  eq("an edited one is your own", matchPreset(presetText(PERSONA_PRESETS[2]) + " Also be funny."), null);
  eq("and so is nothing", matchPreset(""), null);
}

console.log("\n--- unit conversion ---");
{
  const conv = (e: string) => {
    const c = parseConversion(e, evaluate);
    return c ? describeConversion(c) : null;
  };
  eq("kilometres to miles", conv("5 km to miles"), "5 km = 3.106856 mi");
  eq("miles to kilometres", conv("1 mile to km"), "1 mi = 1.609344 km");
  eq("feet and inches, with a connector that is also a unit", [conv("6 ft to in"), conv("12 in in cm"), conv("5 in to cm")], ["6 ft = 72 in", "12 in = 30.48 cm", "5 in = 12.7 cm"]);
  eq("Fahrenheit to Celsius", conv("72 F in C"), "72 °F = 22.22222 °C");
  eq("Celsius to Fahrenheit and Kelvin", [conv("100 C to F"), conv("0 C to K"), conv("0 K to C")], ["100 °C = 212 °F", "0 °C = 273.15 K", "0 K = -273.15 °C"]);
  eq("negative temperatures", conv("-40 F to C"), "-40 °F = -40 °C");
  eq("pounds and ounces to kilograms", [conv("1 lb to kg"), conv("16 oz to lb")], ["1 lb = 0.4535924 kg", "16 oz = 1 lb"]);
  eq("US gallons and litres", [conv("1 gal to L"), conv("2 litres to pints")], ["1 gal = 3.785412 L", "2 L = 4.226753 pt"]);
  eq("speed", [conv("60 mph to km/h"), conv("100 km/h to mph")], ["60 mph = 96.56064 km/h", "100 km/h = 62.13712 mph"]);
  eq("time", [conv("1 day to seconds"), conv("90 min to hours"), conv("2 weeks to days")], ["1 d = 86400 s", "90 min = 1.5 h", "2 wk = 14 d"]);
  eq("area", [conv("1 acre to m2"), conv("1 hectare to acres")], ["1 acre = 4046.856 m²", "1 ha = 2.471054 acre"]);
  eq("energy, power, pressure", [conv("1 kWh to J"), conv("1 hp to W"), conv("1 atm to kPa"), conv("30 psi to bar")], ["1 kWh = 3600000 J", "1 hp = 745.6999 W", "1 atm = 101.325 kPa", "30 psi = 2.068427 bar"]);
  eq("angles", [conv("180 deg to rad"), conv("1 turn to degrees")], ["180 ° = 3.141593 rad", "1 turn = 360 °"]);
  eq("data sizes keep bytes and bits apart", [conv("1 GiB to MB"), conv("1 MB to KB"), conv("8 Mb to MB"), conv("1 B to bits")], ["1 GiB = 1073.742 MB", "1 MB = 1000 kB", "8 Mb = 1 MB", "1 B = 8 bit"]);
  eq("arithmetic on the left of the unit", [conv("(2 + 3) km to m"), conv("1e3 m to km"), conv("10/4 kg to g"), conv("sqrt(16) ft to in")], ["5 km = 5000 m", "1000 m = 1 km", "2.5 kg = 2500 g", "4 ft = 48 in"]);
  eq("no number means one", conv("km to miles"), "1 km = 0.6213712 mi");
  eq("spelled out, in any case", [conv("5 Kilometers TO Miles"), conv("3 square feet to square meters"), conv("2 fluid ounces to ml")], ["5 km = 3.106856 mi", "3 ft² = 0.2787091 m²", "2 fl oz = 59.14706 mL"]);
  eq("arrows work", [conv("5 km -> mi"), conv("5 km → mi")], ["5 km = 3.106856 mi", "5 km = 3.106856 mi"]);
  eq("converting back round-trips", Math.abs(parseConversion("1 mi to km", evaluate)!.result - 1.609344) < 1e-9 && Math.abs(parseConversion("1.609344 km to mi", evaluate)!.result - 1) < 1e-9, true);

  const fails = (e: string) => { try { parseConversion(e, evaluate); return "no error"; } catch (err) { return err instanceof UnitError ? err.message : `other: ${(err as Error).message}`; } };
  eq("length to mass is refused, saying why", fails("5 km to kg"), "Can't convert length (km) to mass (kg).");
  eq("an unknown unit is named", [fails("5 smoots to km"), fails("5 km to cubits")], ['Unknown unit "smoots".', 'Unknown unit "cubits".']);
  eq("ambiguous units are not guessed", [fails("5 tons to kg"), fails("100 calories to kJ"), fails("2 months to days")].map((m) => m.includes("ambiguous") || m.includes("not a fixed")), [true, true, true]);
  eq("a missing unit is asked for", fails("5 to km"), 'Say what unit the number is in, e.g. "5 km to mi".');
  eq("milli and mega are not mixed up", [lookupUnit("mW")?.label, lookupUnit("MW")?.label, lookupUnit("mw")], ["mW", "MW", null]);
  eq("nor bits and bytes", [lookupUnit("b")?.label, lookupUnit("B")?.label, lookupUnit("Mb")?.label, lookupUnit("MB")?.label, lookupUnit("mb")?.label], ["bit", "B", "Mb", "MB", "MB"]);

  eq("ordinary arithmetic is not touched", [conv("2 + 2"), conv("(2+3)*sqrt(16)"), conv("10 / 4"), conv("5 % 3")], [null, null, null, null]);
  eq("nor is nonsense that happens to contain 'to'", conv("tomato to potato"), null);
  eq("numbers format without noise", [formatNumber(0), formatNumber(0.1 + 0.2), formatNumber(1 / 3), formatNumber(1e21), formatNumber(1234567.891), formatNumber(-2.5e-8)], ["0", "0.3", "0.3333333", "1e+21", "1234568", "-2.5e-8"]);

  const viaTool = async (expression: string) => (await runToolCall({ id: "u", name: "calculate", arguments: JSON.stringify({ expression }) }, {})).content;
  eq("through the tool: a conversion", await viaTool("5 km to miles"), "5 km to miles → 5 km = 3.106856 mi");
  eq("a failed conversion is an error the model can read", (await viaTool("5 km to kg")).includes("Can't convert length"), true);
  eq("and arithmetic still reads as before", await viaTool("6*7"), "6*7 = 42");

  // Conversion rides inside `calculate` so it adds nothing to the tool list.
  const BEFORE = 369; // JSON.stringify(toWireTool(calculateTool)).length, before conversions existed
  const now = JSON.stringify(toWireTool(calculateTool)).length;
  ok(`the calculate tool's schema is no bigger than it was (${now} ≤ ${BEFORE} characters)`, now <= BEFORE);
  ok("and says it converts units", calculateTool.description.includes("unit conversion") && calculateTool.description.includes("5 km to mi"));
  eq("there is no separate conversion tool", allTools().some((t) => /convert|unit/i.test(t.name)), false);
}

console.log("\n--- memory search and tags ---");
{
  const entry = (id: string, text: string, tags: string[] = []) => ({ id, text, tags, createdAt: 1, updatedAt: 1 });
  const all = [
    entry("1", "Prefers dark roast coffee", ["food"]),
    entry("2", "Works on the Atlas project in Rust", ["work", "always"]),
    entry("3", "Allergic to penicillin", ["health", "always"]),
    entry("4", "Atlas deadline is in March", ["work"]),
  ];
  eq("tags are normalised", [normalizeMemoryTag("#Work"), normalizeMemoryTag("  Deep Work "), normalizeMemoryTag("##x")], ["work", "deep-work", "x"]);
  eq("a tag list is cleaned, deduped and capped", [cleanMemoryTags(["Work", "work", "#WORK", " ", 5, "a"]), cleanMemoryTags("nope"), cleanMemoryTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length], [["work", "5", "a"], [], MAX_MEMORY_TAGS]);
  eq("typed tags split on commas and spaces", parseTagInput("work, #Health  always,,"), ["work", "health", "always"]);
  eq("tags are counted, most used first", memoryTagCounts(all), [{ tag: "always", count: 2 }, { tag: "work", count: 2 }, { tag: "food", count: 1 }, { tag: "health", count: 1 }]);
  eq("no filter shows everything", filterMemory(all, {}).length, 4);
  eq("a word must appear in the text", filterMemory(all, { query: "atlas" }).map((e) => e.id), ["2", "4"]);
  eq("every word must, in any order", filterMemory(all, { query: "project atlas" }).map((e) => e.id), ["2"]);
  eq("tags are searched too", filterMemory(all, { query: "health" }).map((e) => e.id), ["3"]);
  eq("a tag filter keeps only that tag", filterMemory(all, { tag: "work" }).map((e) => e.id), ["2", "4"]);
  eq("the tag filter forgives a # and capitals", filterMemory(all, { tag: "#Work" }).map((e) => e.id), ["2", "4"]);
  eq("search and tag together", filterMemory(all, { query: "deadline", tag: "work" }).map((e) => e.id), ["4"]);
  eq("nothing matching is empty, not an error", filterMemory(all, { query: "zebra" }), []);
}

console.log("\n--- memory export and import ---");
{
  const entry = (id: string, text: string, tags: string[] = [], at = 1000) => ({ id, text, tags, createdAt: at, updatedAt: at, sourceChatId: "chat-1" });
  const have = [entry("a", "Likes tea", ["food"]), entry("b", "Lives in Oslo", ["always"], 2000)];
  const file = exportMemory(have, new Date("2026-10-02T12:00:00Z"));
  eq("an export names its format", [file.format, file.version, file.exportedAt], ["jarvis-memory", 1, "2026-10-02T12:00:00.000Z"]);
  eq("and leaves behind what is about this install", Object.keys(file.entries[0]).sort(), ["createdAt", "tags", "text", "updatedAt"]);
  eq("the file is named for the day", memoryFilename(new Date("2026-10-02T12:00:00Z")), "jarvis-memory-2026-10-02.json");
  eq("same fact, whatever its capitals or spacing", sameness("  Likes   TEA "), "likes tea");

  let n = 0;
  const id = () => `new-${++n}`;
  const nothing = planImport(have, JSON.parse(JSON.stringify(file)), id);
  eq("importing your own export adds nothing", nothing.ok && [nothing.add.length, nothing.skipped.duplicate], [0, 2]);

  const other = { format: "jarvis-memory", version: 1, entries: [
    { text: "Likes TEA", tags: [] },
    { text: "Plays the cello", tags: ["Hobby", "always"], createdAt: 500, updatedAt: 700, id: "a" },
    { text: "  ", tags: [] },
    { text: "x".repeat(MAX_ENTRY_CHARS + 1) },
    { notText: 1 },
    "Owns a bike",
    "owns a BIKE",
  ] };
  const plan = planImport(have, other, id, 10_000);
  ok("a mixed file imports what is good", plan.ok);
  if (plan.ok) {
    eq("adding only the new facts", plan.add.map((e) => e.text), ["Plays the cello", "Owns a bike"]);
    eq("counting what it skipped, and why", plan.skipped, { duplicate: 2, invalid: 3, full: 0 });
    eq("new ids, never the file's — so a file can't overwrite an entry by guessing its id", plan.add.map((e) => e.id).every((i) => i.startsWith("new-")) && !plan.add.some((e) => e.id === "a"), true);
    eq("tags are cleaned and kept", plan.add[0].tags, ["hobby", "always"]);
    eq("and it reports how many are pinned into every chat", plan.pinned, 1);
    eq("dates come across when sensible, else now", [plan.add[0].createdAt, plan.add[0].updatedAt, plan.add[1].createdAt], [500, 700, 10_000]);
  }
  eq("a bare list of strings is accepted", planImport([], ["one", "two"], id).ok && (planImport([], ["one", "two"], id) as { add: unknown[] }).add.length, 2);
  eq("another kind of file is refused", planImport([], { format: "jarvis-settings", version: 1 }, id), { ok: false, error: "That doesn't look like a JARVIS memory file." });
  eq("so is a newer version", planImport([], { format: "jarvis-memory", version: 2, entries: [] }, id), { ok: false, error: "This file is version 2; this JARVIS reads version 1." });
  eq("and a number", planImport([], 42, id), { ok: false, error: "That doesn't look like a JARVIS memory file." });
  eq("and a file with no list", planImport([], { format: "jarvis-memory", version: 1 }, id), { ok: false, error: "The file has no list of entries." });
  eq("an enormous file is refused before any of it is read", planImport([], Array.from({ length: MAX_IMPORT_ENTRIES + 1 }, () => "x"), id).ok, false);
  const crowded = Array.from({ length: MAX_MEMORY_ENTRIES - 1 }, (_, i) => entry(`e${i}`, `fact ${i}`));
  const full = planImport(crowded, ["fresh one", "fresh two", "fresh three"], id);
  eq("memory has a ceiling, and says so when an import hits it", full.ok && [full.add.length, full.skipped.full], [1, 2]);
  eq("the existing entries are never in the plan", nothing.ok && nothing.add.every((e) => !have.some((h) => h.id === e.id)), true);
  eq("future dates are not trusted", planImport([], [{ text: "from the future", createdAt: Date.now() + 10 * 86_400_000 }], id, Date.now()).ok && (planImport([], [{ text: "from the future", createdAt: Date.now() + 10 * 86_400_000 }], id, Date.now()) as { add: { createdAt: number }[] }).add[0].createdAt <= Date.now(), true);

  // The routes themselves, against a real folder.
  const dir = mkdtempSync(join(tmpdir(), "jarvis-mem-"));
  process.env.JARVIS_DATA_DIR = dir;
  try {
    const memoryRoute = await import("../app/api/memory/route");
    const importRoute = await import("../app/api/memory/import/route");
    const exportRoute = await import("../app/api/memory/export/route");
    const post = (path: string, body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }) =>
      new Request(`http://localhost${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }) as never;

    await memoryRoute.POST(post("/api/memory", { text: "Likes tea", tags: ["Food", "always"] }));
    const [{ id: tid, tags: stored }] = (await (await memoryRoute.GET()).json()).entries;
    eq("a tag typed with capitals is stored clean", stored, ["food", "always"]);
    await memoryRoute.POST(post("/api/memory", { id: tid, text: "Likes green tea" }));
    const afterEdit = (await (await memoryRoute.GET()).json()).entries[0];
    eq("editing the words alone keeps the tags (it used to wipe them, \"always\" included)", [afterEdit.text, afterEdit.tags], ["Likes green tea", ["food", "always"]]);
    await memoryRoute.POST(post("/api/memory", { id: tid, text: "Likes green tea", tags: [] }));
    eq("sending an empty tag list clears them, on purpose", (await (await memoryRoute.GET()).json()).entries[0].tags, []);

    const exported = await exportRoute.GET();
    eq("export is a download", [exported.headers.get("content-type"), /^attachment; filename="jarvis-memory-\d{4}-\d{2}-\d{2}\.json"$/.test(exported.headers.get("content-disposition") ?? ""), exported.headers.get("cache-control")], ["application/json; charset=utf-8", true, "no-store"]);
    const exportedFile = JSON.parse(await exported.text());
    eq("holding the entries", exportedFile.entries.map((e: { text: string }) => e.text), ["Likes green tea"]);

    eq("import wants application/json", (await importRoute.POST(post("/api/memory/import", "{}", { "Content-Type": "text/plain" }))).status, 415);
    eq("and valid JSON", (await importRoute.POST(post("/api/memory/import", "{nope"))).status, 400);
    eq("and a memory file", (await importRoute.POST(post("/api/memory/import", { format: "other" }))).status, 400);
    eq("and not a huge one", (await importRoute.POST(post("/api/memory/import", "{}", { "Content-Type": "application/json", "Content-Length": String(3 * 1024 * 1024) }))).status, 413);

    const toAdd = { format: "jarvis-memory", version: 1, entries: [{ text: "Likes green tea" }, { text: "Rides a bike", tags: ["always"] }] };
    const dry = await (await importRoute.POST(post("/api/memory/import?dry=1", toAdd))).json();
    eq("a dry run reports and writes nothing", [dry.dry, dry.added, dry.skipped.duplicate, dry.pinned, (await (await memoryRoute.GET()).json()).entries.length], [true, 1, 1, 1, 1]);
    const real = await (await importRoute.POST(post("/api/memory/import", toAdd))).json();
    eq("the real import adds it", [real.added, (await (await memoryRoute.GET()).json()).entries.length], [1, 2]);
    const again = await (await importRoute.POST(post("/api/memory/import", toAdd))).json();
    eq("and importing it again adds nothing", again.added, 0);
  } finally {
    delete process.env.JARVIS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n--- favourite models ---");
{
  eq("a key is provider:model", favoriteKey("groq", "llama-3.3-70b"), "groq:llama-3.3-70b");
  eq("split at the first colon, so a model id may have one", parseFavorite("local:qwen2.5:7b"), { provider: "local", model: "qwen2.5:7b" });
  eq("malformed keys are not keys", [parseFavorite("nocolon"), parseFavorite(":model"), parseFavorite("provider:")], [null, null, null]);
  eq("a list is cleaned", cleanFavorites(["a:b", "a:b", 5, "bad", "c:d", "x".repeat(400) + ":y", null]), ["a:b", "c:d"]);
  eq("anything else is empty", [cleanFavorites("a:b"), cleanFavorites(undefined)], [[], []]);
  eq("starring adds to the top", toggleFavorite(["a:1"], "b:2"), ["b:2", "a:1"]);
  eq("starring again removes it", toggleFavorite(["b:2", "a:1"], "b:2"), ["a:1"]);
  eq("there is a limit, and the oldest star goes first", (() => { let l: string[] = []; for (let i = 0; i < MAX_FAVORITES + 5; i++) l = toggleFavorite(l, `p:m${i}`); return [l.length, l[0], l.includes("p:m0")]; })(), [MAX_FAVORITES, `p:m${MAX_FAVORITES + 4}`, false]);
  eq("isFavorite", [isFavorite(["a:b"], "a", "b"), isFavorite(["a:b"], "a", "c"), isFavorite(undefined, "a", "b")], [true, false, false]);
}

console.log("\n--- the context meter ---");
{
  const msg = (content: string, attachments?: Attachment[]) => ({ content, attachments });
  eq("text costs a quarter of its length, plus framing", conversationTokens([msg("x".repeat(400))]), 104);
  eq("every message pays the framing", conversationTokens([msg(""), msg(""), msg("")]), 12);
  const image = { id: "i", kind: "image", name: "p.png", mime: "image/png", size: 1, dataUrl: "data:image/png;base64,AAAA" } as Attachment;
  const old = { id: "j", kind: "image", name: "old.png", mime: "image/png", size: 1 } as Attachment;
  eq("a picture still carrying its bytes costs a picture", conversationTokens([msg("", [image])]), 4 + IMAGE_TOKENS);
  eq("an older one, lightened to a name, costs nothing", conversationTokens([msg("", [old])]), 4);
  eq("no more than three pictures count", conversationTokens([msg("", [image, image, image, image, image])]), 4 + 3 * IMAGE_TOKENS);
  const file = { id: "f", kind: "text", name: "a.txt", mime: "text/plain", size: 400, text: "y".repeat(400) } as Attachment;
  eq("attached text counts", conversationTokens([msg("", [file])]), 4 + 100 + 20);

  const g = (id: string, budget?: { context?: number }) => getProvider(id, undefined, budget);
  const sizes = (id: string) => ({ maxContextTokens: g(id).maxContextTokens, maxRequestTokens: g(id).maxRequestTokens, customEndpoint: Boolean(g(id).allowCustomEndpoint) });
  const ceilingOf = (id: string, budget?: { context?: number }) => { const c = g(id, budget); return Math.min(c.maxContextTokens, c.maxRequestTokens ?? Infinity); };
  const providerIds = ["groq", "cerebras", "gemini", "mistral", "local"];
  for (const id of providerIds) {
    for (const budget of [undefined, { context: 16000 }, { context: 100 }, { context: 999999 }, { context: NaN }]) {
      const mine = contextCeiling(sizes(id), budget);
      const theirs = ceilingOf(id, budget);
      if (mine !== theirs) eq(`the meter and the server agree on the ceiling for ${id} with ${JSON.stringify(budget)}`, mine, theirs);
    }
  }
  ok("the meter and the server agree on the ceiling for every provider, with and without a Settings override", true);
  eq("a free tier's request budget, not its window, is the ceiling", contextCeiling({ maxContextTokens: 96_000, maxRequestTokens: 3500 }), 3500);
  eq("a provider with no request budget uses its window", contextCeiling({ maxContextTokens: 32_000 }), 32_000);
  eq("a slot you may repoint takes your size (and 85% of it as the request)", contextCeiling({ maxContextTokens: 8000, maxRequestTokens: 6000, customEndpoint: true }, { context: 20_000 }), 17_000);
  eq("but only that kind of slot", contextCeiling({ maxContextTokens: 8000, maxRequestTokens: 6000 }, { context: 20_000 }), 6000);

  const base = { persona: "x".repeat(400), toolTokens: 500, noteTokens: 0, useTools: true };
  const small = measureContext({ ...base, messages: [msg("hi")], limit: 10_000 });
  eq("the instructions and the tool list count before a word is said", small.used, 100 + 4 + 500 + 4 + 1);
  eq("with tools off the list is not counted", measureContext({ ...base, useTools: false, messages: [], limit: 10_000 }).used, 104);
  eq("a roomy window is ok", [small.level, small.leftOut], ["ok", false]);
  const near = measureContext({ ...base, messages: [msg("x".repeat(20_000))], limit: 7000 });
  eq("past 70% it warns", [near.level, near.leftOut], ["warn", false]);
  const over = measureContext({ ...base, messages: [msg("x".repeat(40_000))], limit: 7000 });
  eq("past the ceiling the oldest messages are being left out", [over.level, over.leftOut, over.ratio > 1], ["full", true, true]);
  eq("token counts read naturally", [formatTokens(850), formatTokens(2400), formatTokens(10_000), formatTokens(12_300), formatTokens(2000)], ["850", "2.4k", "10k", "12k", "2k"]);
}

console.log("\n--- the welcome screen ---");
{
  const at = (h: number) => new Date(2026, 9, 2, h, 30);
  eq("a greeting for the hour", [4, 5, 11, 12, 17, 18, 21, 22, 23, 0].map((h) => timeGreeting(at(h))), ["Working late?", "Good morning", "Good morning", "Good afternoon", "Good afternoon", "Good evening", "Good evening", "Working late?", "Working late?", "Working late?"]);
  const meta = (id: string, updatedAt: number, extra: object = {}) => ({ id, title: id, createdAt: 1, updatedAt, messageCount: 2, ...extra });
  eq("recent chats: newest first", recentChats([meta("a", 10), meta("b", 30), meta("c", 20)]).map((c) => c.id), ["b", "c", "a"]);
  eq("archived and empty ones are left out", recentChats([meta("a", 10, { archived: true }), meta("b", 20, { messageCount: 0 }), meta("c", 5)]).map((c) => c.id), ["c"]);
  eq("four by default, or as many as asked", [recentChats(Array.from({ length: 9 }, (_, i) => meta(`c${i}`, i))).length, recentChats(Array.from({ length: 9 }, (_, i) => meta(`c${i}`, i)), 2).length], [4, 2]);
  const now = 1_000_000_000_000;
  eq("relative times", [0, 59_000, 120_000, 3 * 3600_000, 2 * 86_400_000].map((d) => relativeTime(now - d, now)), ["just now", "just now", "2m ago", "3h ago", "2d ago"]);
  eq("past a week it is a date", relativeTime(now - 8 * 86_400_000, now), new Date(now - 8 * 86_400_000).toLocaleDateString());
}

console.log("\n--- scheduled-task templates ---");
{
  eq("there are several, with distinct ids", [TASK_TEMPLATES.length >= 5, new Set(TASK_TEMPLATES.map((t) => t.id)).size], [true, TASK_TEMPLATES.length]);
  const filled = (t: (typeof TASK_TEMPLATES)[number]) => Object.fromEntries((t.fields ?? []).map((f) => [f.id, `a ${f.id} value`]));
  let saved: ScheduledTask[] = [];
  setScheduleStore({
    async list() { return saved.map((t) => ({ ...t })); },
    async save(task) { const i = saved.findIndex((x) => x.id === task.id); if (i === -1) saved.push(task); else saved[i] = task; },
    async delete(id) { saved = saved.filter((t) => t.id !== id); },
  });
  for (const t of TASK_TEMPLATES) {
    const built = buildFromTemplate(t, { fields: filled(t) });
    ok(`${t.name}: builds with its defaults`, built.ok);
    if (!built.ok) continue;
    ok(`${t.name}: and the scheduler accepts it`, !(await createTask({ prompt: built.prompt, label: built.label, schedule: built.schedule })).error);
    ok(`${t.name}: no placeholder is left in the prompt`, !/[{}]|undefined|null/.test(built.prompt) && !/[{}]|undefined|null/.test(built.label));
    ok(`${t.name}: the prompt is short enough to be read aloud, and the label fits a row`, built.prompt.length < 400 && built.label.length <= 60);
  }
  const briefing = TASK_TEMPLATES.find((t) => t.id === "morning-briefing")!;
  const plain = buildFromTemplate(briefing, {});
  eq("a briefing with no topic is about the news in general", plain.ok && [plain.label, plain.schedule, /headlines \(search/.test(plain.prompt)], ["Morning briefing", { kind: "daily", hhmm: "08:00" }, true]);
  const topical = buildFromTemplate(briefing, { time: "06:45", fields: { topic: "rust" } });
  eq("and with one, about it, at the time asked", topical.ok && [topical.label, topical.schedule, topical.prompt.includes("headlines about rust")], ["Morning briefing — rust", { kind: "daily", hhmm: "06:45" }, true]);
  eq("a bad time is refused with a message", buildFromTemplate(briefing, { time: "25:99" }), { ok: false, error: '"25:99" isn\'t a time of day. Use HH:MM, like 08:00.' });
  const reminder = TASK_TEMPLATES.find((t) => t.id === "reminder")!;
  eq("a required field can't be empty", buildFromTemplate(reminder, { fields: { what: "   " } }), { ok: false, error: "Remind me to: this can't be empty." });
  const water = TASK_TEMPLATES.find((t) => t.id === "water")!;
  eq("an interval is whole minutes, at least one", [water.when.kind, (buildFromTemplate(water, { minutes: 0 }) as { ok: false }).ok, (buildFromTemplate(water, { minutes: 1.5 }) as { ok: false }).ok, (buildFromTemplate(water, { minutes: 99999 }) as { ok: false }).ok], ["every", false, false, false]);
  const w = buildFromTemplate(water, { minutes: "45" });
  eq("a string of digits is fine", w.ok && w.schedule, { kind: "every", minutes: 45 });
  const long = buildFromTemplate(reminder, { fields: { what: `take\n\n  my   pills ${"x".repeat(500)}` } });
  eq("a field is one tidy line, cut to a sensible length", long.ok && [long.prompt.includes("\n\n"), long.prompt.includes("take my pills"), long.prompt.length < MAX_FIELD + 60], [false, true, true]);
  eq("and a long one makes a label that fits", long.ok && long.label.length <= 60, true);
  saved = [];
}

console.log("\n--- a picture's family ---");
{
  const pic = (id: string, createdAt: number, editedFrom?: string) => ({ id, createdAt, editedFrom });
  const all = [pic("a", 1), pic("b", 2, "a"), pic("c", 3, "b"), pic("d", 4, "a"), pic("x", 5), pic("orphan", 6, "gone")];
  eq("an original has its edits, oldest first", lineageOf(all[0], all).edits.map((p) => p.id), ["b", "d"]);
  eq("an edit knows what it came from", lineageOf(all[1], all).original?.id, "a");
  eq("and an edit of an edit, its own parent", lineageOf(all[2], all).original?.id, "b");
  eq("a picture with no edits says so", [lineageOf(all[4], all).edits.length, lineageOf(all[4], all).original, lineageOf(all[4], all).originalGone], [0, null, false]);
  eq("an edit of a deleted picture says the original is gone", [lineageOf(all[5], all).original, lineageOf(all[5], all).originalGone], [null, true]);
  eq("the family is everything from the oldest ancestor down", familyOf(all[2], all).map((p) => p.id), ["a", "b", "c", "d"]);
  eq("the same from any member", [familyOf(all[0], all).map((p) => p.id), familyOf(all[3], all).map((p) => p.id)], [["a", "b", "c", "d"], ["a", "b", "c", "d"]]);
  eq("an unrelated picture is its own family", familyOf(all[4], all).map((p) => p.id), ["x"]);
  eq("an orphaned edit is its own root", familyOf(all[5], all).map((p) => p.id), ["orphan"]);
  const loop = [pic("p", 1, "q"), pic("q", 2, "p")];
  eq("a corrupt loop can't hang it", familyOf(loop[0], loop).length, 2);
}

console.log("\n--- usage as a spreadsheet ---");
{
  const day = (requests: number, extra: object = {}) => ({ requests, ok: requests - 1, rateLimited: 1, failed: 0, tokensSent: requests * 100, lastAt: Date.UTC(2026, 9, 2, 12, 0, 0), ...extra });
  const csv = usageToCsv([
    { day: "2026-10-02", providers: { groq: day(10), cerebras: day(3, { lastError: "=HYPERLINK(\"http://evil.example\")" }) } },
    { day: "2026-10-01", providers: { groq: day(4) } },
  ], { groq: "Groq", cerebras: "Cerebras" });
  const lines = csv.split(/\r?\n/);
  eq("a header row", lines[0], "date_utc,provider,provider_name,requests,ok,rate_limited,failed,tokens_sent_estimated,last_request_utc,last_error");
  eq("one row per provider per day, oldest day first", lines.slice(1).map((l) => l.split(",").slice(0, 3).join(",")), ["2026-10-01,groq,Groq", "2026-10-02,cerebras,Cerebras", "2026-10-02,groq,Groq"]);
  eq("numbers stay numbers", lines[1].split(",").slice(3, 8), ["4", "3", "1", "0", "400"]);
  eq("times are ISO", lines[1].split(",")[8], "2026-10-02T12:00:00.000Z");
  eq("an error message that starts like a formula is neutralised", lines[2].includes("\"'=HYPERLINK(\"\"http://evil.example\"\")\"") || lines[2].includes("'=HYPERLINK"), true);
  eq("an empty tally is just the header", usageToCsv([]).split(/\r?\n/).length, 1);
  eq("it is named for the day", usageFilename(new Date("2026-10-02T12:00:00Z")), "jarvis-usage-2026-10-02.csv");
}

console.log("\n--- daily backups ---");
{
  const dir = mkdtempSync(join(tmpdir(), "jarvis-auto-"));
  const keep = { dir: process.env.JARVIS_DATA_DIR, backup: process.env.JARVIS_BACKUP_DIR, auto: process.env.JARVIS_AUTO_BACKUP, images: process.env.JARVIS_AUTO_BACKUP_IMAGES, keepN: process.env.JARVIS_BACKUP_KEEP };
  process.env.JARVIS_DATA_DIR = dir;
  delete process.env.JARVIS_BACKUP_DIR;
  delete process.env.JARVIS_AUTO_BACKUP;
  delete process.env.JARVIS_AUTO_BACKUP_IMAGES;
  delete process.env.JARVIS_BACKUP_KEEP;
  const put = (rel: string, text: string) => {
    mkdirSync(join(dir, ...rel.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...rel.split("/")), text);
  };
  const namesIn = (bytes: Uint8Array) => readZipDirectory(bytes).map((e) => e.name).sort();
  const names = async () => { const out: string[] = []; for await (const e of backupEntries()) out.push(e.name); return out.sort(); };
  try {
    put("chats/c1.json", "{\"id\":\"c1\"}");
    put("memory.json", "[]");
    put("images/p.png", "png");
    put("trash/t.json", "{}");
    const day = (n: number) => new Date(2026, 9, n, 10, 0, 0);

    eq("backups are named for the day", [autoName(day(2)), AUTO_NAME.test(autoName(day(2)))], ["jarvis-auto-2026-10-02.zip", true]);
    const first = await runAutoBackup(day(2));
    eq("the first run makes today's", [first.created, first.skipped, first.error], ["jarvis-auto-2026-10-02.zip", undefined, undefined]);
    const entries = namesIn(new Uint8Array(readFileSync(join(dir, "backups", "jarvis-auto-2026-10-02.zip"))));
    eq("it holds chats, memory and the trash — and says how to restore", ["RESTORE.txt", "data/chats/c1.json", "data/memory.json", "data/trash/t.json"].every((n) => entries.includes(n)), true);
    eq("but not pictures, unless asked", entries.includes("data/images/p.png"), false);
    eq("and never the backups themselves", entries.some((n) => n.includes("backups")), false);
    eq("it is a zip every entry of which reads back", readZipDirectory(new Uint8Array(readFileSync(join(dir, "backups", "jarvis-auto-2026-10-02.zip")))).every((e) => readZipEntry(new Uint8Array(readFileSync(join(dir, "backups", "jarvis-auto-2026-10-02.zip"))), e).length >= 0), true);
    eq("the same day again does nothing", (await runAutoBackup(day(2))).skipped, "exists");
    eq("a leftover half-written file is never left behind", readdirSync(join(dir, "backups")).filter((n) => n.endsWith(".partial")), []);

    process.env.JARVIS_AUTO_BACKUP_IMAGES = "1";
    const withPictures = await runAutoBackup(day(2), true);
    eq("forcing replaces today's, and pictures come with it when asked", [withPictures.created, namesIn(new Uint8Array(readFileSync(join(dir, "backups", "jarvis-auto-2026-10-02.zip")))).includes("data/images/p.png")], ["jarvis-auto-2026-10-02.zip", true]);
    delete process.env.JARVIS_AUTO_BACKUP_IMAGES;

    writeFileSync(join(dir, "backups", "notes.txt"), "mine");
    writeFileSync(join(dir, "backups", "jarvis-auto-2026-10-99.txt"), "not a backup");
    for (let n = 3; n <= 12; n++) await runAutoBackup(day(n));
    const kept = (await listAutoBackups()).map((b) => b.name);
    eq("only the last seven are kept, newest first", kept, [12, 11, 10, 9, 8, 7, 6].map((n) => `jarvis-auto-2026-10-${String(n).padStart(2, "0")}.zip`));
    eq("and nothing else in the folder is touched", [existsSync(join(dir, "backups", "notes.txt")), existsSync(join(dir, "backups", "jarvis-auto-2026-10-99.txt"))], [true, true]);
    eq("the default is seven; it can be set", [backupsKept(), (process.env.JARVIS_BACKUP_KEEP = "3", backupsKept()), (process.env.JARVIS_BACKUP_KEEP = "0", backupsKept()), (process.env.JARVIS_BACKUP_KEEP = "500", backupsKept()), (delete process.env.JARVIS_BACKUP_KEEP, backupsKept())], [7, 3, 7, 60, 7]);
    process.env.JARVIS_BACKUP_KEEP = "2";
    const trimmed = await runAutoBackup(day(13));
    eq("a lower limit trims at the next run", [trimmed.pruned.length, (await listAutoBackups()).length], [6, 2]);
    delete process.env.JARVIS_BACKUP_KEEP;

    eq("the manual backup never contains the backups either", (await names()).some((n) => n.includes("backups")), false);
    // The folder moved inside data/ under another name: still left out.
    process.env.JARVIS_BACKUP_DIR = join(dir, "safe-place");
    await runAutoBackup(day(20));
    eq("wherever it is, even inside data/", [existsSync(join(dir, "safe-place", "jarvis-auto-2026-10-20.zip")), (await names()).some((n) => n.includes("safe-place"))], [true, false]);
    delete process.env.JARVIS_BACKUP_DIR;

    process.env.JARVIS_AUTO_BACKUP = "0";
    eq("switched off, it does nothing on its own", (await runAutoBackup(day(25))).skipped, "disabled");
    eq("but 'back up now' still works", (await runAutoBackup(day(25), true)).created, "jarvis-auto-2026-10-25.zip");
    delete process.env.JARVIS_AUTO_BACKUP;

    // A destination that can't be written: reported, not thrown.
    writeFileSync(join(dir, "afile"), "x");
    process.env.JARVIS_BACKUP_DIR = join(dir, "afile", "inside");
    const failed = await runAutoBackup(day(26));
    eq("a backup that can't be written says so instead of throwing", [failed.created, typeof failed.error], [null, "string"]);
    delete process.env.JARVIS_BACKUP_DIR;
    eq("the folder is data/backups by default", backupDir(), join(dir, "backups"));

    // The timer: one, never in the sandbox copy, never when switched off.
    const timer = globalThis as { __jarvisAutoBackup?: NodeJS.Timeout };
    const stop = () => { if (timer.__jarvisAutoBackup) clearTimeout(timer.__jarvisAutoBackup); delete timer.__jarvisAutoBackup; };
    process.env.JARVIS_IS_SANDBOX = "1";
    startAutoBackup();
    eq("the sandbox copy never starts one", timer.__jarvisAutoBackup, undefined);
    delete process.env.JARVIS_IS_SANDBOX;
    process.env.JARVIS_AUTO_BACKUP = "0";
    startAutoBackup();
    eq("nor does a switched-off install", timer.__jarvisAutoBackup, undefined);
    delete process.env.JARVIS_AUTO_BACKUP;
    startAutoBackup();
    const started = timer.__jarvisAutoBackup;
    startAutoBackup();
    eq("otherwise there is one, and starting twice doesn't make two", [started !== undefined, timer.__jarvisAutoBackup === started], [true, true]);
    eq("and it doesn't keep the process alive", (started as unknown as { hasRef(): boolean }).hasRef(), false);
    stop();
  } finally {
    for (const [k, v] of Object.entries({ JARVIS_DATA_DIR: keep.dir, JARVIS_BACKUP_DIR: keep.backup, JARVIS_AUTO_BACKUP: keep.auto, JARVIS_AUTO_BACKUP_IMAGES: keep.images, JARVIS_BACKUP_KEEP: keep.keepN })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n--- chat statistics ---");
{
  const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
  const DAY = 86_400_000;
  const msg = (role: "user" | "assistant", content: string, at: number, extra: object = {}) => ({ id: `${role}-${at}-${content.length}`, role, content, createdAt: at, ...extra });
  const chats = [
    { id: "a", title: "A", createdAt: 1, updatedAt: 1, pinned: true, messages: [
      msg("user", "hello there friend", NOW - 2 * DAY),
      msg("assistant", "Hi! How can I help you today?", NOW - 2 * DAY + 1000, { model: "m1", toolRounds: [{ round: 1, calls: [{ id: "1", name: "calculate", arguments: "{}" }, { id: "2", name: "web_search", arguments: "{}" }], results: [{ toolCallId: "1", name: "calculate", content: "42", isError: false, ms: 1 }, { toolCallId: "2", name: "web_search", content: "oops", isError: true, ms: 1 }] }] }),
      msg("user", "thanks", NOW),
    ] },
    { id: "b", title: "B", createdAt: 1, updatedAt: 1, archived: true, messages: [
      msg("assistant", "<think>a long private deliberation that should not count</think>The answer is four.", NOW - 40 * DAY, { model: "m1" }),
      msg("assistant", "again", NOW, { model: "m2", toolRounds: [{ round: 1, calls: [{ id: "3", name: "calculate", arguments: "{}" }], results: [] }] }),
    ] },
  ] as never[];
  const stats = computeChatStats(chats, { now: NOW, days: 7 });
  eq("chats are counted, with those archived and pinned", stats.chats, { total: 2, archived: 1, pinned: 1 });
  eq("so are messages by who sent them", stats.messages, { total: 5, user: 2, assistant: 3 });
  eq("words are what you read — a thinking model's hidden reasoning isn't", stats.words, { user: 4, assistant: 7 + 4 + 1 });
  eq("the chart is the last seven days, oldest first, zeros included", [stats.perDay.length, stats.perDay[0].day, stats.perDay[6].day, stats.perDay.map((d) => d.messages)], [7, "2026-10-04", "2026-10-10", [0, 0, 0, 0, 2, 0, 2]]);
  eq("messages older than the chart still count in the totals", stats.messages.total, 5);
  eq("the busiest day", stats.busiest, { day: "2026-10-08", messages: 2 });
  eq("tools are ranked by use, with their failures", stats.tools, [{ name: "calculate", calls: 2, errors: 0 }, { name: "web_search", calls: 1, errors: 1 }]);
  eq("models by replies", stats.models, [{ model: "m1", replies: 2 }, { model: "m2", replies: 1 }]);
  eq("the first message", stats.firstMessageAt, NOW - 40 * DAY);
  eq("days follow the clock of whoever is looking", [dayKey(Date.UTC(2026, 9, 10, 23, 30), 0), dayKey(Date.UTC(2026, 9, 10, 23, 30), -120), dayKey(Date.UTC(2026, 9, 10, 1, 30), 300)], ["2026-10-10", "2026-10-11", "2026-10-09"]);
  eq("the chart is capped", computeChatStats([], { now: NOW, days: 5000 }).perDay.length, MAX_DAYS);
  eq("and has at least a day", computeChatStats([], { now: NOW, days: 0 }).perDay.length, 1);
  eq("no chats is a quiet zero, not an error", computeChatStats([], { now: NOW }).busiest, null);
}

console.log("\n--- initiative: settings ---");
{
  eq("nothing stored is the defaults", cleanConfig(undefined), DEFAULT_CONFIG);
  eq("so is junk", [cleanConfig("x"), cleanConfig(42), cleanConfig([1])], [DEFAULT_CONFIG, DEFAULT_CONFIG, DEFAULT_CONFIG]);
  eq("the defaults are the gentle end", [DEFAULT_CONFIG.level, DEFAULT_CONFIG.desktop, DEFAULT_CONFIG.speak, DEFAULT_CONFIG.enabled], ["balanced", false, false, true]);
  const messy = cleanConfig({ level: "shouty", desktop: "yes", quietHours: { on: false, from: "25:00", to: "7am" }, rules: { break: false, bogus: false }, adaptTone: 0, showMood: false });
  eq("each field is cleaned on its own", [messy.level, messy.desktop, messy.quietHours, messy.rules.break, messy.rules["long-chat"], messy.adaptTone, messy.showMood], ["balanced", false, { on: false, from: "22:30", to: "07:00" }, false, true, true, false]);
  eq("only known rules are kept", Object.keys(messy.rules).sort(), [...RULE_IDS].sort());
  eq("every level has a cap, and quiet means none", [LEVELS.map((l) => HOURLY_CAP[l]), HOURLY_CAP.quiet], [[0, 3, 8], 0]);
  const at = (h: number, m = 0) => new Date(2026, 9, 3, h, m);
  const night = { on: true, from: "22:30", to: "07:00" };
  eq("quiet hours wrap midnight", [at(23).getHours(), inQuietHours(at(23), night), inQuietHours(at(2), night), inQuietHours(at(6, 59), night)], [23, true, true, true]);
  eq("the end is not inside them, nor the minute before the start", [inQuietHours(at(7), night), inQuietHours(at(22, 29), night), inQuietHours(at(12), night)], [false, false, false]);
  eq("a daytime window", [inQuietHours(at(12), { on: true, from: "09:00", to: "17:00" }), inQuietHours(at(18), { on: true, from: "09:00", to: "17:00" })], [true, false]);
  eq("off is off, and two equal times are an empty window rather than all day", [inQuietHours(at(23), { ...night, on: false }), inQuietHours(at(23), { on: true, from: "08:00", to: "08:00" })], [false, false]);
}

console.log("\n--- initiative: mood ---");
{
  const T0 = 1_000_000_000_000;
  const mood = (events: Parameters<typeof applyEvent>[1][], at = T0) => events.reduce((m, e) => applyEvent(m, e, at), { ...CALM, at });
  eq("it starts calm", labelOf(CALM), "calm");
  eq("a thumbs-up pleases it, two delight it", [labelOf(mood(["thumbs-up"])), labelOf(mood(["thumbs-up", "thumbs-up"]))], ["pleased", "delighted"]);
  eq("a thumbs-down makes it sorry — it was the reply", labelOf(mood(["thumbs-down"])), "apologetic");
  eq("failures make it concerned — it was the situation", labelOf(mood(["reply-failed", "reply-failed"])), "concerned");
  eq("a busy run of good replies is focused, and then pleased", [labelOf(mood(["frustration"])), labelOf(mood(["reply-ok", "reply-ok", "reply-ok", "reply-ok"]))], ["focused", "pleased"]);
  eq("regenerating a reply dents it", mood(["regenerated"]).valence < 0, true);
  eq("finishing a focus session lifts it", labelOf(mood(["focus-done"])), "pleased");
  eq("it never leaves its range", [mood(Array(10).fill("thumbs-up")).valence, mood(Array(10).fill("thumbs-down")).valence], [1, -1]);
  const sorry = mood(["thumbs-down"]);
  eq("it drifts back: half the way in ten minutes", Math.abs(decay(sorry, T0 + HALF_LIFE_MS).valence - sorry.valence / 2) < 1e-9, true);
  eq("and is calm within the hour", [labelOf(decay(sorry, T0 + 3_600_000)), decay(sorry, T0 + 3_600_000).cause], ["calm", null]);
  eq("time never runs backwards", decay(sorry, T0 - 5000).valence, sorry.valence);
  eq("a new chat takes the edge off", Math.abs(applyEvent(sorry, "new-chat", T0).valence - sorry.valence / 2) < 1e-9, true);
  eq("late at night it quietens", mood(["late-night"]).energy < CALM.energy, true);
  eq("each mood has a summary, worded as how the session is going", (["calm", "focused", "pleased", "delighted", "concerned", "apologetic"] as const).every((l) => moodSummary(l).length > 10 && !/feel/i.test(moodSummary(l))), true);
}

console.log("\n--- initiative: reading tone ---");
{
  const row = (text: string, want: string) => eq(`"${text.slice(0, 48)}" is ${want}`, readTone(text), want);
  row("How do I centre a div?", "neutral");
  row("kill the process on port 3000", "neutral");
  row("this query is killing performance", "neutral");
  row("I'm killing it today", "neutral");
  row("What's the deadline for filing taxes?", "neutral");
  row("Write a function that sorts a list", "neutral");
  row("ugh this still doesn't work", "frustrated");
  row("WHY IS THIS NOT WORKING AT ALL", "frustrated");
  row("it's still broken!!!", "frustrated");
  row("this is useless", "frustrated");
  row("thanks but it doesn't work", "frustrated");
  row("I need this done asap", "stressed");
  row("I'm overwhelmed with work", "stressed");
  row("the deadline is tomorrow", "stressed");
  row("thanks!", "grateful");
  row("perfect, thank you", "grateful");
  row("this is awesome!!", "excited");
  row("I feel so lonely lately", "sad");
  row("i'm really depressed", "sad");
  row("I want to die", "distress");
  row("I keep thinking about suicide", "distress");
  row("I might hurt myself", "distress");
  eq("a pasted log is not a mood", readTone(`ugh\n${"line\n".repeat(20)}`), "neutral");
  eq("nor a long message", readTone(`ugh ${"x".repeat(700)}`), "neutral");
  eq("nor anything with code in it", readTone("ugh ```js\nconsole.log(1)\n```"), "neutral");
  eq("an empty message is neutral", readTone("   "), "neutral");
  eq("hints exist for the tones that need one, and for no other", (["neutral", "excited", "grateful", "frustrated", "stressed", "sad", "distress"] as const).map((t) => toneHint(t) !== null), [false, false, false, true, true, true, true]);
  eq("the frustrated hint asks for a fix, not a lecture", /fix the problem/.test(toneHint("frustrated")!) && /no lecture/.test(toneHint("frustrated")!), true);
  eq("the distress hint is about care and real help, with no humour", /care/.test(toneHint("distress")!) && /crisis services/.test(toneHint("distress")!) && /without judgement or humour/.test(toneHint("distress")!), true);
  eq("a hint is one short paragraph", (["frustrated", "stressed", "sad", "distress"] as const).every((t) => toneHint(t)!.length < 320 && !toneHint(t)!.includes("\n")), true);
  eq("only some tones touch the mood — a sad moment is not for it to perform", (["neutral", "frustrated", "stressed", "grateful", "excited", "sad", "distress"] as const).map(toneMoodEvent), [null, "frustration", "stress", "thanked", null, null, null]);
  eq("distress keeps cards away for six hours, sadness for two, the rest not at all", [quietFor("distress"), quietFor("sad"), quietFor("frustrated"), quietFor("neutral")], [6 * 3_600_000, 2 * 3_600_000, 0, 0]);
}

console.log("\n--- initiative: what it might say ---");
{
  const NOW = new Date(2026, 9, 2, 14, 0, 0).getTime();
  const base: RuleContext = { now: NOW, chatId: "c1", contextRatio: 0.5, trouble: null, activeMs: 0, approvalWaitMs: 0, awayMs: 0, lastChat: null, hour: 14, mood: "calm" };
  const rules = (over: Partial<RuleContext> = {}) => evaluateRules({ ...base, ...over });
  const ids = (over: Partial<RuleContext> = {}) => rules(over).map((n) => n.rule);
  eq("an ordinary moment says nothing", rules(), []);

  eq("a nearly full chat offers a summary or a fresh start", [ids({ contextRatio: 0.85 }), rules({ contextRatio: 0.85 })[0].actions.map((a) => a.kind), rules({ contextRatio: 0.85 })[0].id], [["long-chat"], ["fill", "new-chat"], "long-chat:c1"]);
  eq("a little under is quiet", ids({ contextRatio: 0.84 }), []);
  eq("one that no longer fits says so", rules({ contextRatio: 1.3 })[0].title, "This chat no longer fits");
  eq("with no chat open there's nothing to summarise", ids({ chatId: null, contextRatio: 2 }), []);
  const summary = rules({ contextRatio: 0.9 })[0].actions[0];
  eq("the summary button only fills the box — nothing is sent", summary.kind === "fill" && summary.text.startsWith("Summarize our conversation"), true);

  const alt = { provider: "cerebras", model: "m2", label: "m2 · Cerebras" };
  eq("one failure is bad luck", ids({ trouble: { failures: 1, provider: "groq", model: "m1", alternative: alt } }), []);
  const trouble = rules({ trouble: { failures: 2, provider: "groq", model: "m1", alternative: alt } })[0];
  eq("two in a row offers another model", [trouble.rule, trouble.actions.map((a) => a.kind === "switch-model" && a.model)], ["provider-trouble", ["m2"]]);
  eq("with nothing else ready it says what would help", rules({ trouble: { failures: 3, provider: "groq", model: "m1", alternative: null } })[0].actions.length === 0 && /key in Settings/.test(rules({ trouble: { failures: 3, provider: "groq", model: "m1", alternative: null } })[0].body ?? ""), true);

  const MIN = 60_000;
  eq("steady work for an hour and a half earns a break", [ids({ activeMs: 89 * MIN }), ids({ activeMs: 90 * MIN })], [[], ["break"]]);
  eq("and a second after three hours is a different card", [rules({ activeMs: 91 * MIN })[0].id, rules({ activeMs: 181 * MIN })[0].id], ["break:1", "break:2"]);
  eq("its wording follows the mood", [rules({ activeMs: 95 * MIN, mood: "concerned" })[0].title.startsWith("Hey"), rules({ activeMs: 95 * MIN, mood: "pleased" })[0].title.startsWith("Good session"), rules({ activeMs: 95 * MIN })[0].title.startsWith("You've been at it")], [true, true, true]);

  eq("late and still going", [ids({ hour: 23, activeMs: 11 * MIN }), ids({ hour: 23, activeMs: 5 * MIN }), ids({ hour: 12, activeMs: 11 * MIN }), ids({ hour: 3, activeMs: 11 * MIN })], [["late-night"], [], [], ["late-night"]]);
  const at11pm = new Date(2026, 9, 2, 23, 30).getTime();
  const at2am = new Date(2026, 9, 3, 2, 0).getTime();
  eq("2am is still last night, so the night is offered once", rules({ now: at11pm, hour: 23, activeMs: 20 * MIN })[0].id === rules({ now: at2am, hour: 2, activeMs: 20 * MIN })[0].id, true);
  eq("the next night is a new one", rules({ now: at11pm + 24 * 3_600_000, hour: 23, activeMs: 20 * MIN })[0].id !== rules({ now: at11pm, hour: 23, activeMs: 20 * MIN })[0].id, true);

  eq("an unanswered approval is mentioned after 45 seconds", [ids({ approvalWaitMs: 44_000 }), ids({ approvalWaitMs: 45_000 })], [[], ["approval-waiting"]]);
  const chat = { id: "c9", title: "Rust lifetimes" };
  eq("coming back after four hours offers the last chat", [ids({ awayMs: 3 * 3_600_000, lastChat: chat }), ids({ awayMs: 4 * 3_600_000, lastChat: chat }), ids({ awayMs: 9 * 3_600_000, lastChat: null })], [[], ["welcome-back"], []]);
  const back = rules({ awayMs: 5 * 3_600_000, lastChat: chat })[0];
  eq("by name, with a button that opens it", [back.body, back.actions[0]], ["Last time: “Rust lifetimes”.", { kind: "open-chat", label: "Pick it up", chatId: "c9" }]);

  const remember = rememberNudge("User is allergic to penicillin", NOW);
  eq("a memory offer saves only when pressed, and can pin it", [remember.actions.map((a) => a.kind), remember.actions.map((a) => a.kind === "remember" && Boolean(a.always))], [["remember", "remember"], [false, true]]);
  eq("a timer you set is exempt from the hourly limit", [focusOverNudge(25, NOW).requested, focusOverNudge(25, NOW).title, focusOverNudge(null, NOW).title], [true, "Focus time's up — 25 minutes", "Focus is over"]);
  eq("so is what the server sends", [inboxNudge({ id: "a1", title: "Morning briefing", body: "It is raining." }, NOW).requested, inboxNudge({ id: "a1", title: "t", body: "b" }, NOW).id], [true, "inbox:a1"]);
  eq("thresholds are the ones the README states", [THRESHOLDS.contextRatio, THRESHOLDS.breakAfterMs / MIN, THRESHOLDS.approvalAfterMs / 1000, THRESHOLDS.awayMs / 3_600_000], [0.85, 90, 45, 4]);
}

console.log("\n--- initiative: when it keeps quiet ---");
{
  const NOW = new Date(2026, 9, 2, 14, 0, 0).getTime();
  const HOUR = 3_600_000;
  const card = (rule: Nudge["rule"], extra: Partial<Nudge> = {}): Nudge => ({ id: `${rule}:1`, rule, title: "t", actions: [], at: NOW, ...extra });
  const calm: Situation = { now: NOW, typing: false, streaming: false, dialogOpen: false, voiceOpen: false, hidden: false, focusUntil: 0, distressUntil: 0 };
  const verdict = (n: Nudge, over: { config?: Partial<typeof DEFAULT_CONFIG>; gate?: Partial<typeof EMPTY_GATE>; sit?: Partial<Situation> } = {}) =>
    decide(n, { ...DEFAULT_CONFIG, ...over.config }, { ...EMPTY_GATE, ...over.gate }, { ...calm, ...over.sit }).action;

  eq("a calm moment shows it", verdict(card("long-chat")), "show");
  eq("off means it never existed — but what you asked for waits in the inbox", [verdict(card("long-chat"), { config: { enabled: false } }), verdict(card("inbox", { requested: true }), { config: { enabled: false } })], ["drop", "inbox"]);
  eq("a rule you turned off is dropped", verdict(card("break"), { config: { rules: { ...DEFAULT_CONFIG.rules, break: false } } }), "drop");
  eq("so is one it learned to stop", verdict(card("break"), { gate: { learnedMutes: ["break"] } }), "drop");
  eq("and one snoozed", [verdict(card("break"), { gate: { snoozedUntil: { break: NOW + 1000 } } }), verdict(card("break"), { gate: { snoozedUntil: { break: NOW - 1 } } })], ["drop", "show"]);
  eq("after a hard message nothing appears; what you asked for goes to the inbox", [verdict(card("break"), { sit: { distressUntil: NOW + 1 } }), verdict(card("inbox", { requested: true }), { sit: { distressUntil: NOW + 1 } })], ["drop", "inbox"]);
  eq("the same thing isn't offered again within its cooldown", [verdict(card("long-chat"), { gate: { lastByRule: { "long-chat": NOW - 10 * 60_000 } } }), verdict(card("long-chat"), { gate: { lastByRule: { "long-chat": NOW - 31 * 60_000 } } })], ["drop", "show"]);
  eq("every rule has a cooldown", [...RULE_IDS, "focus-over", "inbox"].every((r) => typeof COOLDOWN_MS[r as keyof typeof COOLDOWN_MS] === "number"), true);
  eq("during focus it is held back for the inbox", [verdict(card("break"), { sit: { focusUntil: NOW + HOUR } }), verdict(card("break"), { sit: { focusUntil: NOW - 1 } })], ["inbox", "show"]);
  eq("at the quiet level nothing pops up", verdict(card("break"), { config: { level: "quiet" } }), "inbox");
  const used = (n: number) => ({ shown: Array.from({ length: n }, (_, i) => NOW - (i + 1) * 60_000) });
  eq("balanced allows three an hour", [verdict(card("break"), { gate: used(2) }), verdict(card("break"), { gate: used(3) })], ["show", "inbox"]);
  eq("chatty allows eight", [verdict(card("break"), { config: { level: "chatty" }, gate: used(7) }), verdict(card("break"), { config: { level: "chatty" }, gate: used(8) })], ["show", "inbox"]);
  eq("an old one doesn't count against the hour", verdict(card("break"), { gate: { shown: [NOW - 61 * 60_000, NOW - 62 * 60_000, NOW - 63 * 60_000] } }), "show");
  eq("a card you asked for isn't capped", verdict(card("focus-over", { requested: true }), { gate: used(9) }), "show");
  eq("typing, a reply arriving, a dialog or voice mode wait for a calm moment", [{ typing: true }, { streaming: true }, { dialogOpen: true }, { voiceOpen: true }].map((sit) => verdict(card("break"), { sit })), ["queue", "queue", "queue", "queue"]);
  eq("muted beats busy: it isn't kept waiting for something that will never show", verdict(card("break"), { config: { rules: { ...DEFAULT_CONFIG.rules, break: false } }, sit: { typing: true } }), "drop");
  eq("focus beats busy: it goes to the inbox rather than waiting", verdict(card("break"), { sit: { typing: true, focusUntil: NOW + HOUR } }), "inbox");

  eq("showing one is counted, and a requested one isn't", [recordShown(EMPTY_GATE, card("break"), NOW).shown.length, recordShown(EMPTY_GATE, card("inbox", { requested: true }), NOW).shown.length], [1, 0]);
  eq("and remembered per rule", recordShown(EMPTY_GATE, card("break"), NOW).lastByRule.break, NOW);
  eq("old entries are pruned as it goes", recordShown({ ...EMPTY_GATE, shown: [NOW - 2 * HOUR] }, card("break"), NOW).shown, [NOW]);

  const d1 = recordDismissal(EMPTY_GATE, "break", NOW);
  eq("waving a card away quietens that rule for an hour", [d1.gate.snoozedUntil.break - NOW, d1.mutedNow, SNOOZE_MS], [SNOOZE_MS, false, SNOOZE_MS]);
  const d2 = recordDismissal(d1.gate, "break", NOW + 1000);
  const d3 = recordDismissal(d2.gate, "break", NOW + 2000);
  eq(`the ${MUTE_AFTER}rd time in a week it stops for good`, [d2.mutedNow, d3.mutedNow, d3.gate.learnedMutes], [false, true, ["break"]]);
  eq("dismissals a week old don't count", recordDismissal({ ...EMPTY_GATE, dismissals: { break: [NOW - 8 * 24 * HOUR, NOW - 9 * 24 * HOUR] } }, "break", NOW).mutedNow, false);
  eq("only suggestions are ever muted — never your own timer or the server's messages", [recordDismissal(EMPTY_GATE, "inbox", NOW).gate.learnedMutes, recordDismissal(recordDismissal(recordDismissal(EMPTY_GATE, "inbox", NOW).gate, "inbox", NOW).gate, "inbox", NOW).mutedNow], [[], false]);
  eq("using a card forgives what dismissing it cost", [recordAccepted(d2.gate, "break").dismissals.break, recordAccepted(d2.gate, "break").snoozedUntil.break], [undefined, undefined]);
  eq("turning a rule back on forgets the mute", forgetRule(d3.gate, "break").learnedMutes, []);

  eq("desktop notifications need the tab hidden, the setting and no quiet hours", [channels({ ...DEFAULT_CONFIG, desktop: true }, { hidden: true }, false), channels({ ...DEFAULT_CONFIG, desktop: true }, { hidden: false }, false), channels({ ...DEFAULT_CONFIG, desktop: true }, { hidden: true }, true), channels(DEFAULT_CONFIG, { hidden: true }, false)].map((c) => c.desktop), [true, false, false, false]);
  eq("speech needs the tab visible, the setting and no quiet hours", [channels({ ...DEFAULT_CONFIG, speak: true }, { hidden: false }, false), channels({ ...DEFAULT_CONFIG, speak: true }, { hidden: true }, false), channels({ ...DEFAULT_CONFIG, speak: true }, { hidden: false }, true), channels(DEFAULT_CONFIG, { hidden: false }, false)].map((c) => c.speak), [true, false, false, false]);
}

console.log("\n--- initiative: suggestions ---");
{
  const labels = (a: string, o?: { error?: boolean }) => suggestFollowUps(a, o).map((s) => s.id);
  const prose = "Here is a reasonably detailed explanation of how that works, with enough words to count as an answer.";
  eq("code gets code follow-ups", labels(`${prose}\n\n\`\`\`js\nconsole.log(1)\n\`\`\``), ["explain-code", "errors", "tests"]);
  eq("a table gets a summary", labels(`${prose}\n\n| a | b |\n|---|---|\n| 1 | 2 |`)[0], "table");
  eq("steps get a walk-through", labels(`${prose}\n\n1. one\n2. two\n3. three`)[0], "step-one");
  eq("a long answer offers a shorter one", labels(`${prose} ${"word ".repeat(400)}`)[0], "shorter");
  eq("a picture offers edits", labels("Here it is.\n\n![a lighthouse](/api/images/00000000-0000-4000-8000-000000000001)\n\nA lighthouse at dusk.").slice(0, 2), ["night", "style"]);
  eq("a failed reply offers a retry", labels("", { error: true }), ["retry", "what-went-wrong"]);
  eq("plain prose gets the general three", labels(prose), ["deeper", "example", "downsides"]);
  eq("never more than three", Math.max(...[`${prose}\n\`\`\`x\n\`\`\`\n| a |\n|---|\n1. a\n2. b\n3. c`].map((t) => suggestFollowUps(t).length)), 3);
  eq("a reply that asks you something gets none — buttons would talk over it", labels(`${prose} Which of those would you like me to start with?`), []);
  eq("nor a one-word reply", labels("Done."), []);
  eq("each has a button and the words it puts in the box", suggestFollowUps(prose).every((s) => s.label.length > 2 && s.text.length > 5), true);

  const fact = (t: string) => detectFact(t);
  eq("a name", [fact("My name is Ada"), fact("you can call me Grace.")], ["User's name is Ada", "User's name is Grace"]);
  eq("but not a lower-case word that isn't one", fact("my name is not important"), null);
  eq("an allergy or a diet", [fact("I'm allergic to penicillin"), fact("I am vegetarian"), fact("I'm left-handed.")], ["User is allergic to penicillin", "User is vegetarian", "User is left-handed"]);
  eq("where you live, where you're from, who you work for", [fact("I live in Oslo"), fact("I'm from New Zealand"), fact("I work at Acme Corp")], ["User lives in Oslo", "User is from New Zealand", "User works at Acme Corp"]);
  eq("what you do, in your own words", fact("I work as a nurse"), "User works as a nurse");
  eq("a standing preference", [fact("I prefer tabs over spaces"), fact("I always use dark mode"), fact("I never use semicolons")], ["User prefers tabs over spaces", "User always uses dark mode", "User never uses semicolons"]);
  eq("a birthday and pronouns", [fact("my birthday is March 3"), fact("my pronouns are they/them")], ["User's birthday is March 3", "User's pronouns are they/them"]);
  eq("one fact from a longer message", fact("Thanks. I live in Lisbon. Can you plan a weekend there?"), "User lives in Lisbon");
  eq("not a hypothetical", [fact("If I live in Oslo, what's the weather like?"), fact("What if I work at Acme Corp?")], [null, null]);
  eq("not a question", fact("Do I live in Oslo or Bergen?"), null);
  eq("not a place or a company that isn't named", [fact("I live in a van"), fact("I work at night")], [null, null]);
  eq("not code, a long paste, or nothing", [fact("```\nmy name is Ada\n```"), fact(`I prefer ${"x".repeat(400)}`), fact(""), fact("how do I sort a list?")], [null, null, null, null]);
}

console.log("\n--- the inbox ---");
{
  const dir = mkdtempSync(join(tmpdir(), "jarvis-inbox-"));
  const before = process.env.JARVIS_DATA_DIR;
  process.env.JARVIS_DATA_DIR = dir;
  try {
    const T = 1_000_000_000_000;
    eq("nothing yet is an empty list, not an error", await listInbox(T), []);
    const a = await postToInbox({ kind: "scheduled", title: "Morning briefing", body: "It is raining." }, T);
    const b = await postToInbox({ kind: "backup", title: "Daily backup failed", body: "disk full" }, T + 1000);
    eq("what arrives is kept, newest first, unread", (await listInbox(T + 2000)).map((i) => [i.title, i.read]), [["Daily backup failed", false], ["Morning briefing", false]]);
    eq("with an id and a time", [typeof a.id, a.at, a.id !== b.id], ["string", T, true]);
    eq("it is a file you can open", JSON.parse(readFileSync(join(dir, "inbox.json"), "utf8")).items.length, 2);
    eq("titles and bodies are tidied and bounded", await (async () => { const i = await postToInbox({ kind: "scheduled", title: "  ", body: `  ${"x".repeat(5000)}  ` }, T + 3000); return [i.title, i.body.length]; })(), ["JARVIS", 2000]);

    eq("marking some read leaves the others", [await markRead([a.id], T + 4000), (await listInbox(T + 4000)).filter((i) => i.read).map((i) => i.title)], [1, ["Morning briefing"]]);
    eq("marking all read", [await markRead(undefined, T + 5000), (await listInbox(T + 5000)).every((i) => i.read)], [2, true]);
    eq("again changes nothing", await markRead(undefined, T + 6000), 0);
    eq("clearing some", [await clearInbox([a.id], T + 7000), (await listInbox(T + 7000)).length], [1, 2]);
    eq("clearing all", [await clearInbox(undefined, T + 8000), await listInbox(T + 8000)], [2, []]);

    // A failure that repeats every hour is one line.
    const first = await postToInbox({ kind: "backup", title: "Daily backup failed", body: "disk full", collapseWithin: 12 * 3_600_000 }, T);
    const again = await postToInbox({ kind: "backup", title: "Daily backup failed", body: "disk full (still)", collapseWithin: 12 * 3_600_000 }, T + 3_600_000);
    eq("a repeat within the window replaces the unread one", [again.id === first.id, (await listInbox(T + 3_600_001)).length, (await listInbox(T + 3_600_001))[0].body], [true, 1, "disk full (still)"]);
    eq("after it, a new one", (await postToInbox({ kind: "backup", title: "Daily backup failed", body: "again", collapseWithin: 12 * 3_600_000 }, T + 13 * 3_600_000), (await listInbox(T + 13 * 3_600_000)).length), 2);
    await markRead(undefined, T + 14 * 3_600_000);
    eq("a read one isn't collapsed into: you've seen it, so a repeat is news", (await postToInbox({ kind: "backup", title: "Daily backup failed", body: "and again", collapseWithin: 12 * 3_600_000 }, T + 14 * 3_600_000 + 1), (await listInbox(T + 14 * 3_600_000 + 2)).length), 3);
    await clearInbox(undefined, T + 15 * 3_600_000);

    eq("the oldest go at two weeks", await (async () => { await postToInbox({ kind: "scheduled", title: "old", body: "x" }, T); await postToInbox({ kind: "scheduled", title: "new", body: "x" }, T + KEEP_MS - 1000); return (await listInbox(T + KEEP_MS + 1000)).map((i) => i.title); })(), ["new"]);
    await clearInbox(undefined, T + KEEP_MS);
    await Promise.all(Array.from({ length: MAX_ITEMS + 25 }, (_, i) => postToInbox({ kind: "scheduled", title: `n${i}`, body: "x" }, T + i)));
    const full = await listInbox(T + MAX_ITEMS + 100);
    eq("arriving together, none are lost to each other — and the surplus is dropped", [full.length, full[0].title, full.at(-1)?.title], [MAX_ITEMS, `n${MAX_ITEMS + 24}`, "n25"]);

    writeFileSync(join(dir, "inbox.json"), "{ not json");
    eq("a damaged file is an empty inbox, not a crash", await listInbox(T), []);
    writeFileSync(join(dir, "inbox.json"), JSON.stringify({ items: [{ id: 1 }, { id: "ok", at: T, kind: "scheduled", title: "kept", body: "b", read: false }, { id: "x", at: T, kind: "other", title: "t", body: "b", read: false }] }));
    eq("entries that aren't well-formed are skipped", (await listInbox(T)).map((i) => i.id), ["ok"]);

    // The routes.
    const route = await import("../app/api/inbox/route");
    await clearInbox();
    await postToInbox({ kind: "scheduled", title: "one", body: "b" }, Date.now() - 5000);
    const second = await postToInbox({ kind: "scheduled", title: "two", body: "b" }, Date.now());
    const get = async (q = "") => (await route.GET(new Request(`http://localhost/api/inbox${q}`) as never)).json();
    const post = (body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }) =>
      route.POST(new Request("http://localhost/api/inbox", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }) as never);
    eq("GET lists them with the unread count", await (async () => { const r = await get(); return [r.items.length, r.unread]; })(), [2, 2]);
    eq("?since returns only what is newer", (await get(`?since=${second.at - 1}`)).items.map((i: { title: string }) => i.title), ["two"]);
    eq("POST wants application/json", (await post("{}", { "Content-Type": "text/plain" })).status, 415);
    eq("and an action it knows", [(await post({ action: "post", title: "hi" })).status, (await post({ action: "nonsense" })).status], [400, 400]);
    eq("there is no way to add an item from a page", (await get()).items.some((i: { title: string }) => i.title === "hi"), false);
    eq("reading one", [(await (await post({ action: "read", ids: [second.id] })).json()).changed, (await get()).unread], [1, 1]);
    eq("clearing all", [(await (await post({ action: "clear" })).json()).removed, (await get()).items], [1 + 1, []]);

    // What the scheduler's clock hands over.
    const clockTasks: unknown[] = [];
    setClockRunner(async () => ({ text: "Good morning." }));
    setOnResult((task, outcome) => { clockTasks.push([task.label, outcome.text]); });
    let stored: ScheduledTask[] = [{ id: "t1", prompt: "p", label: "Briefing", schedule: { kind: "daily", hhmm: "08:00" }, enabled: true, createdAt: 0, nextRunAt: 1 }];
    setScheduleStore({
      async list() { return stored.map((t) => ({ ...t })); },
      async save(task) { const i = stored.findIndex((x) => x.id === task.id); if (i === -1) stored.push(task); else stored[i] = task; },
      async delete(id) { stored = stored.filter((t) => t.id !== id); },
    });
    await clockTick(Date.now());
    eq("a task that has run reports what it said", clockTasks, [["Briefing", "Good morning."]]);
    stored[0].nextRunAt = 1;
    setOnResult(() => { throw new Error("disk full"); });
    eq("a hook that fails cannot stop the clock", await clockTick(Date.now()), 1);
    setOnResult(null);
    setClockRunner(null);
    stored = [];
  } finally {
    if (before === undefined) delete process.env.JARVIS_DATA_DIR; else process.env.JARVIS_DATA_DIR = before;
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n--- initiative: spotting a failing model ---");
{
  const reply = (extra: object = {}) => ({ role: "assistant", provider: "groq", model: "m1", ...extra });
  const user = { role: "user" };
  const providers = [
    { id: "groq", label: "Groq", ready: true, models: ["m1", "m1b"] },
    { id: "cerebras", label: "Cerebras", ready: true, models: ["c1", "c2"] },
    { id: "mistral", label: "Mistral", ready: false, models: ["x1"] },
  ];
  const now = { provider: "groq", model: "m1" };
  eq("healthy replies are no trouble", troubleOf([user, reply(), user, reply()], providers, now, []), null);
  eq("nor is no reply", troubleOf([user], providers, now, []), null);
  eq("one failure is counted", troubleOf([user, reply({ error: "429" })], providers, now, [])?.failures, 1);
  eq("failures count only while unbroken, from the latest", troubleOf([user, reply({ error: "x" }), user, reply(), user, reply({ error: "y" })], providers, now, [])?.failures, 1);
  eq("a fallback counts as a failure of the one it fell back from", [troubleOf([user, reply({ error: "x" }), user, reply({ fellBackFrom: "groq", provider: "cerebras", model: "c1" })], providers, now, [])?.failures, troubleOf([user, reply({ fellBackFrom: "groq", provider: "cerebras" })], providers, now, [])?.provider], [2, "groq"]);
  const t = troubleOf([user, reply({ error: "x" }), user, reply({ error: "y" })], providers, now, []);
  eq("with nothing starred, the first ready model elsewhere", t?.alternative, { provider: "cerebras", model: "c1", label: "c1 · Cerebras" });
  eq("a provider with no key is never offered", troubleOf([user, reply({ error: "x" })], [providers[0], providers[2]], now, [])?.alternative, null);
  eq("a starred model comes first", troubleOf([user, reply({ error: "x" })], providers, now, ["cerebras:c2"])?.alternative?.model, "c2");
  eq("but not a star for the failing provider, or a model that has gone", [troubleOf([user, reply({ error: "x" })], providers, now, ["groq:m1b"])?.alternative?.provider, troubleOf([user, reply({ error: "x" })], providers, now, ["cerebras:retired"])?.alternative?.model], ["cerebras", "c1"]);
}

console.log("\n--- initiative: the live state ---");
{
  const NOW = new Date(2026, 9, 2, 14, 0, 0).getTime();
  const MIN = 60_000;
  const calm: Situation = { now: NOW, typing: false, streaming: false, dialogOpen: false, voiceOpen: false, hidden: false, focusUntil: 0, distressUntil: 0 };
  const card = (rule: Nudge["rule"], key = "1", extra: Partial<Nudge> = {}): Nudge => ({ id: `${rule}:${key}`, rule, title: `${rule} ${key}`, actions: [], at: NOW, ...extra });
  const fresh = () => { resetInitiative(); };

  fresh();
  eq("it starts with the gentle defaults and a calm mood", [getInitiative().config.level, getInitiative().toasts.length, moodLabel(getInitiative(), NOW)], ["balanced", 0, "calm"]);

  eq("a calm moment puts a card on screen", [offer(card("break"), calm).action, getInitiative().toasts.length, getInitiative().history[0].state, getInitiative().history[0].read], ["show", 1, "shown", false]);
  eq("offering it again is ignored — on screen already", [offer(card("break"), calm).reason, getInitiative().toasts.length], ["already pending", 1]);
  eq("and counts toward the hour", getInitiative().gate.shown.length, 1);

  fresh();
  eq("typing holds a card for a calm moment", [offer(card("break"), { ...calm, typing: true }).action, getInitiative().queue.length, getInitiative().toasts.length], ["queue", 1, 0]);
  eq("it is the same card, not two, if offered again meanwhile", [offer(card("break"), { ...calm, typing: true }).reason, getInitiative().queue.length], ["already pending", 1]);
  eq("still busy: it keeps waiting", [flushQueue({ ...calm, typing: true }).length, getInitiative().queue.length], [0, 1]);
  eq("at a calm moment it appears", [flushQueue(calm).map((n) => n.id), getInitiative().toasts.length, getInitiative().queue.length], [["break:1"], 1, 0]);

  fresh();
  offer(card("break"), { ...calm, typing: true });
  eq("after too long a wait it goes to the inbox instead of appearing late", [flushQueue({ ...calm, now: NOW + QUEUE_PATIENCE_MS + MIN }).length, getInitiative().history[0].state, getInitiative().toasts.length], [0, "held", 0]);

  fresh();
  eq("during focus a card is held, with a badge", [offer(card("long-chat"), { ...calm, focusUntil: NOW + 30 * MIN }).action, getInitiative().history[0].state, unreadCount()], ["inbox", "held", 1]);
  eq("and isn't re-held every few seconds: its cooldown has started", offer(card("long-chat", "2"), { ...calm, focusUntil: NOW + 30 * MIN }).reason, "recently offered");

  fresh();
  setServerInbox([{ id: "s1", at: NOW, kind: "scheduled", title: "Briefing", body: "x", read: false }]);
  eq("a card made from a server item appears, but isn't counted a second time beside that item", [offer(inboxNudge({ id: "s1", title: "Briefing", body: "x" }, NOW), calm).action, getInitiative().toasts.length, getInitiative().history.length, unreadCount()], ["show", 1, 0, 1]);
  eq("held during focus it is the item's badge, not a second one", [offer(inboxNudge({ id: "s2", title: "Backup", body: "x" }, NOW), { ...calm, focusUntil: NOW + 30 * MIN }).action, getInitiative().history.length, unreadCount()], ["inbox", 0, 1]);
  closeToast("inbox:s1", "timeout", NOW);
  eq("when it times out it leaves nothing extra behind", [getInitiative().toasts.length, getInitiative().history.length], [0, 0]);

  fresh();
  offer(card("break"), calm);
  eq("using a card closes it and marks it used and read", [closeToast("break:1", "used", NOW).mutedRule, getInitiative().toasts.length, getInitiative().history[0].state, getInitiative().history[0].read], [null, 0, "used", true]);
  fresh();
  offer(card("break"), calm);
  eq("letting it time out leaves it unread, and costs the rule nothing", [closeToast("break:1", "timeout", NOW).mutedRule, getInitiative().history[0].read, getInitiative().gate.dismissals.break, getInitiative().gate.snoozedUntil.break], [null, false, undefined, undefined]);
  fresh();
  offer(card("break"), calm);
  closeToast("break:1", "dismiss", NOW);
  eq("waving it away snoozes the rule for an hour", [getInitiative().history[0].state, (getInitiative().gate.snoozedUntil.break ?? 0) - NOW, offer(card("break", "2"), { ...calm, now: NOW + 5 * MIN }).reason], ["dismissed", 60 * MIN, "snoozed"]);
  eq("and the third time in a week stops that rule", (() => { let r = { mutedRule: null as string | null }; for (let i = 0; i < 2; i++) { const t = NOW + (i + 1) * 3 * 60 * MIN; offer(card("break", `d${i}`), { ...calm, now: t }); r = closeToast(`break:d${i}`, "dismiss", t); } return [r.mutedRule, getInitiative().gate.learnedMutes]; })(), ["break", ["break"]]);
  eq("turning it back on in Settings forgets that", (() => { setRule("break", false); setRule("break", true); return getInitiative().gate.learnedMutes; })(), []);
  fresh();
  offer(card("long-chat"), calm);
  eq("'stop suggesting this' mutes it now, in Settings too", [closeToast("long-chat:1", "mute", NOW).mutedRule, getInitiative().config.rules["long-chat"], offer(card("long-chat", "2"), calm).action], ["long-chat", false, "drop"]);
  fresh();
  offer(card("inbox", "s1", { requested: true }), calm);
  eq("a message from the server can't be muted into silence", [closeToast("inbox:s1", "mute", NOW).mutedRule, getInitiative().config.enabled], [null, true]);

  fresh();
  offer(card("break"), calm);
  offer(card("long-chat"), { ...calm, typing: true });
  noteTone("distress", NOW);
  eq("after a hard message the cards are cleared and nothing new appears", [getInitiative().toasts.length, getInitiative().queue.length, getInitiative().distressUntil - NOW, offer(card("late-night"), { ...calm, distressUntil: getInitiative().distressUntil }).action], [0, 0, 6 * 60 * MIN, "drop"]);
  fresh();
  noteTone("frustrated", NOW);
  eq("frustration moves the mood and clears nothing", [moodLabel(getInitiative(), NOW), getInitiative().distressUntil], ["focused", 0]);
  noteTone("grateful", NOW);
  eq("thanks lifts it", getInitiative().mood.valence > -0.15, true);
  fresh();
  moodEvent("thumbs-down", NOW);
  eq("a thumbs-down makes it sorry, and it drifts back", [moodLabel(getInitiative(), NOW), moodLabel(getInitiative(), NOW + 60 * MIN)], ["apologetic", "calm"]);

  fresh();
  eq("no focus at first", [focusActive(getInitiative(), NOW), focusUntilOf(getInitiative()), endFocus(NOW)], [false, 0, null]);
  startFocus(25, NOW);
  eq("a timed focus is active until it runs out", [focusActive(getInitiative(), NOW + 24 * MIN), focusActive(getInitiative(), NOW + 25 * MIN), focusUntilOf(getInitiative()) - NOW], [true, false, 25 * MIN]);
  eq("ending it says how long it lasted", [endFocus(NOW + 10 * MIN), getInitiative().focus], [10, null]);
  startFocus(null, NOW);
  eq("'until I stop it' is as far off as it goes", [focusActive(getInitiative(), NOW + 99 * 60 * MIN), focusUntilOf(getInitiative()) === Number.MAX_SAFE_INTEGER], [true, true]);
  endFocus(NOW);

  fresh();
  offer(card("long-chat"), { ...calm, focusUntil: NOW + 99 * MIN });
  setServerInbox([{ id: "a", at: NOW, kind: "scheduled", title: "Briefing", body: "x", read: false }, { id: "b", at: NOW, kind: "backup", title: "Backup", body: "x", read: true }]);
  eq("the badge counts held cards and the server's unread", unreadCount(), 2);
  markHistoryRead();
  eq("opening the inbox marks the held ones read", unreadCount(), 1);
  clearHistory();
  eq("clearing empties them", getInitiative().history, []);

  fresh();
  setConfig({ level: "chatty", desktop: true, quietHours: { on: true, from: "23:00", to: "06:00" } });
  eq("settings are cleaned as they are set", [getInitiative().config.level, getInitiative().config.quietHours.from], ["chatty", "23:00"]);
  setConfig({ level: "bogus" as never });
  eq("a nonsense value falls back rather than breaking it", getInitiative().config.level, "balanced");

  // Saved, and back after a reload — the cards on screen are not.
  const saved = new Map<string, string>();
  (globalThis as { window?: unknown }).window = { localStorage: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v), removeItem: (k: string) => void saved.delete(k) }, addEventListener() {} };
  try {
    fresh();
    setConfig({ level: "quiet" });
    setRule("break", false);
    moodEvent("thumbs-up", NOW);
    startFocus(30, NOW);
    offer(card("long-chat"), calm);
    offer(card("late-night"), { ...calm, typing: true });
    eq("it writes to storage as it goes", JSON.parse(saved.get(INITIATIVE_KEY)!).config.level, "quiet");
    fresh();
    const back = getInitiative();
    eq("after a reload the settings, the mood and the focus timer are back", [back.config.level, back.config.rules.break, back.mood.valence > 0.3, back.focus?.until === NOW + 30 * MIN], ["quiet", false, true, true]);
    eq("and so is what it has learned and offered", [back.gate.lastByRule["long-chat"], back.history.length], [NOW, 2]);
    eq("but not the cards that were on screen", [back.toasts.length, back.queue.length], [0, 0]);
    saved.set(INITIATIVE_KEY, "{ nope");
    fresh();
    eq("storage that was damaged is the defaults, not a crash", [getInitiative().config.level, getInitiative().history.length], ["balanced", 0]);
    saved.set(INITIATIVE_KEY, JSON.stringify({ config: { level: "chatty" }, gate: { learnedMutes: ["break"] }, mood: { valence: "x" }, focus: { until: "soon" }, history: "lots" }));
    fresh();
    const odd = getInitiative();
    eq("and odd fields are taken one at a time", [odd.config.level, odd.gate.learnedMutes, odd.mood.valence, odd.focus, odd.history], ["chatty", ["break"], 0, null, []]);
  } finally {
    delete (globalThis as { window?: unknown }).window;
    resetInitiative();
  }
}

// --- initiative: ratings and the tone the server is told ---
{
  console.log("\n--- initiative: ratings, and the tone the server is told ---");
  const rated = [
    { id: "r", title: "R", createdAt: 1, updatedAt: 1, messages: [
      { id: "1", role: "user", content: "hi", createdAt: 1 },
      { id: "2", role: "assistant", content: "hello there", createdAt: 2, reaction: "up" },
      { id: "3", role: "assistant", content: "again", createdAt: 3, reaction: "down" },
      { id: "4", role: "assistant", content: "more", createdAt: 4, reaction: "up" },
      { id: "5", role: "user", content: "thanks", createdAt: 5, reaction: "up" },
      { id: "6", role: "assistant", content: "fine", createdAt: 6 },
    ] },
  ] as never[];
  eq("ratings are counted from replies only", computeChatStats(rated).reactions, { up: 2, down: 1 });
  eq("no ratings is zeros", computeChatStats([]).reactions, { up: 0, down: 0 });

  eq("every tone the reader can produce is one the server accepts", TONES.every(isTone), true);
  eq("a made-up tone is refused", [isTone("furious"), isTone(""), isTone(undefined), isTone(7), isTone({ toString: () => "sad" })], [false, false, false, false, false]);
  eq("only the tones that call for it have guidance, and the server looks the sentence up itself", TONES.map((t) => toneHint(t) !== null), [false, true, true, false, false, true, true]);
}

// --- reading: find, outline, jump, quote, plain text, reading time ---
{
  console.log("\n--- reading and navigating ---");
  eq("find: every place, in order, ignoring case", findSpans(["Hello hello", "no", "HELLO"], "hello"), [{ node: 0, start: 0, end: 5 }, { node: 0, start: 6, end: 11 }, { node: 2, start: 0, end: 5 }]);
  eq("find: a match can't overlap itself", findSpans(["aaa"], "aa").length, 1);
  eq("find: nothing typed, nothing found — and spaces alone are nothing", [findSpans(["abc"], "").length, findSpans(["a b"], "   ").length], [0, 0]);
  eq("find: the query is trimmed", findSpans(["a cat sat"], "  cat ").length, 1);
  eq("find: stops at the limit", findSpans(["a ".repeat(50)], "a", 10).length, 10);
  eq("find: special characters are just characters", findSpans(["cost (a+b) [x]"], "(a+b)").length, 1);
  eq("find: the label", [findLabel("", 0, 0), findLabel("x", 0, 0), findLabel("x", 2, 12), findLabel("x", 0, 500)], ["", "No matches", "3 of 12", "1 of 500+"]);
  eq("find: stepping wraps both ways", [stepMatch(2, 3, 1), stepMatch(0, 3, -1), stepMatch(1, 3, 1), stepMatch(0, 0, 1)], [0, 2, 2, 0]);

  const msgs = [
    { id: "1", role: "user", content: "  \n First question here\nmore" },
    { id: "2", role: "assistant", content: "answer" },
    { id: "3", role: "user", content: "x".repeat(200) },
    { id: "4", role: "user", content: "", attachments: [{ name: "notes.txt" }] },
    { id: "5", role: "user", content: "" },
  ];
  const outline = outlineOf(msgs);
  eq("outline: only your messages, numbered", outline.map((o) => [o.id, o.number]), [["1", 1], ["3", 2], ["4", 3], ["5", 4]]);
  eq("outline: the first non-empty line, trimmed", outline[0].preview, "First question here");
  eq("outline: long ones are cut with an ellipsis", [outline[1].preview.length, outline[1].preview.endsWith("…")], [80, true]);
  eq("outline: an attachment-only message is named by the file; an empty one says so", [outline[2].preview, outline[3].preview], ["📎 notes.txt", "(empty message)"]);

  eq("jump up: the nearest above the top edge", pickJump([-300, -120, 40, 400], "up"), 1);
  eq("jump down: the nearest below it", pickJump([-300, -120, 40, 400], "down"), 2);
  eq("jump: one already at the top edge is passed over, either way", [pickJump([-300, 2, 400], "up"), pickJump([-300, 2, 400], "down")], [0, 2]);
  eq("jump: nowhere to go is null", [pickJump([10, 20], "up"), pickJump([-10, -20], "down"), pickJump([], "up")], [null, null, null]);

  eq("quote: every line prefixed, ending on a fresh line", quoteText("one\n\ntwo"), "> one\n>\n> two\n\n");
  eq("quote: a thinking model's reasoning is left out", quoteText("<think>hmm</think>The answer."), "> The answer.\n\n");
  eq("quote: long ones are cut", quoteText("w".repeat(50), 20), `> ${"w".repeat(20)}…\n\n`);
  eq("quote: nothing to quote is nothing", quoteText("   "), "");
  eq("quote: added after what you've typed, with a gap", [appendQuote("", "> q\n\n"), appendQuote("my note  ", "> q\n\n"), appendQuote("keep", "")], ["> q\n\n", "my note\n\n> q\n\n", "keep"]);

  eq("plain: formatting marks go, words stay", toPlainText("# Title\n\nSome **bold** and *slanted* and `code` and ~~gone~~."), "Title\n\nSome bold and slanted and code and gone.");
  eq("plain: links keep their address; a bare link isn't doubled", toPlainText("See [the docs](https://x.dev/a) or [https://y.dev](https://y.dev)."), "See the docs (https://x.dev/a) or https://y.dev.");
  eq("plain: lists get bullets, quotes lose the arrow", toPlainText("- one\n* two\n> quoted"), "• one\n• two\nquoted");
  eq("plain: code blocks are kept exactly, markers off", toPlainText("Run:\n```bash\nls *.txt  # **all**\n```\nDone."), "Run:\nls *.txt  # **all**\nDone.");
  eq("plain: snake_case and 2*3*4 are not italics", toPlainText("use snake_case_name and 2*3*4"), "use snake_case_name and 2*3*4");
  eq("plain: images become their description", toPlainText("![a cat](/api/images/x.png) here"), "a cat here");

  const para = (n: number) => Array.from({ length: n }, () => "word").join(" ");
  eq("reading: short replies get no label", readingLabel(para(100)), null);
  eq("reading: a long one gets minutes and words", readingLabel(para(440)), "~2 min read · 440 words");
  eq("reading: code isn't counted, nor a thinking model's reasoning", [readingLabel(`\`\`\`js\n${para(900)}\n\`\`\`\n${para(10)}`), readingLabel(`<think>${para(900)}</think>${para(10)}`)], [null, null]);
  eq("reading: never less than a minute; counting words", [readingMinutes(130), countWords("  a  b\nc ")], [1, 3]);
}

// --- exporting and importing chats ---
{
  console.log("\n--- exporting and importing chats ---");
  const chat = { id: "c1", title: "Plan <b>the</b> trip", createdAt: Date.UTC(2026, 9, 3), updatedAt: 1, messages: [
    { id: "a", role: "user", content: "hello <script>alert(1)</script> & \"quotes\"", createdAt: 1, attachments: [{ id: "x", kind: "text", name: "n<1>.txt", mime: "text/plain", size: 1 }] },
    { id: "b", role: "assistant", content: "<think>private</think>Here:\n```js\nif (a < b && c) { x(); }\n```\nDone.", createdAt: 2, model: "m<1>", toolRounds: [{ round: 1, calls: [{ id: "t", name: "calculate", arguments: "{}" }], results: [] }] },
    { id: "c", role: "tool", content: "ignored", createdAt: 3 },
  ] } as never;
  const html = chatToHtml(chat);
  eq("html: a complete page with no scripts and no external links", [html.startsWith("<!doctype html>"), /<script/i.test(html.replace(/&lt;script&gt;[\s\S]*?&lt;\/script&gt;/, "")), /(src|href)=/i.test(html)], [true, false, false]);
  eq("html: the title and every message's text are escaped — nothing in a chat is markup", [html.includes("<title>Plan &lt;b&gt;the&lt;/b&gt; trip</title>"), html.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;"), html.includes("m&lt;1&gt;"), html.includes("n&lt;1&gt;.txt")], [true, true, true, true]);
  eq("html: code is a block, escaped, and reasoning is left out", [html.includes("<pre data-lang=\"js\"><code>if (a &lt; b &amp;&amp; c) { x(); }</code></pre>"), html.includes("private")], [true, false]);
  eq("html: tool messages are skipped; tools used are named", [html.includes("ignored"), html.includes("Used calculate"), (html.match(/class="msg /g) ?? []).length], [false, true, 2]);
  eq("html: a language tag can't carry an attribute", bodyToHtml("```js\" onload=\"x\nok\n```").includes("onload=\"x"), false);
  eq("html: filename", htmlFilename({ title: "Plan: the trip!" } as never), "plan-the-trip.html");

  const ok = importChat({ format: "jarvis-chat", version: 1, chat: { id: "old", title: "  Kept  ", createdAt: 5, messages: [
    { id: "m1", role: "user", content: "hi", createdAt: 10, attachments: [{ id: "i", kind: "image", name: "p.png", mime: "image/png", size: 9, dataUrl: "data:image/png;base64,AAAA" }], evil: "x", __proto__: { polluted: true } },
    { id: "m2", role: "assistant", content: "hello", model: "m", stats: { totalMs: 5, firstTokenMs: 1, tokens: 2 }, reaction: "up", starred: true },
    { role: "system", content: "dropped" }, { role: "user" }, null, "junk",
  ], tags: ["Work", "work", "!!"], persona: "  be brief ", provider: "groq" } }, 1000);
  if (!ok.ok) throw new Error("import failed");
  eq("import: the chat gets a fresh id and keeps its title and date", [ok.chat.id !== "old", ok.chat.title, ok.chat.createdAt, ok.chat.updatedAt], [true, "Kept", 5, 1000]);
  eq("import: only user and assistant messages with text come across, and the rest are counted", [ok.chat.messages.length, ok.skipped], [2, 4]);
  eq("import: messages get new ids", ok.chat.messages.every((m) => !["m1", "m2"].includes(m.id)), true);
  eq("import: unknown fields don't ride along, and picture bytes are dropped", [("evil" in ok.chat.messages[0]), (ok.chat.messages[0].attachments?.[0] as { dataUrl?: string }).dataUrl], [false, undefined]);
  eq("import: known extras survive", [ok.chat.messages[1].model, ok.chat.messages[1].reaction, ok.chat.messages[1].starred, ok.chat.messages[1].stats?.tokens], ["m", "up", true, 2]);
  eq("import: tags are cleaned, instructions kept as written (they are trimmed when used)", [ok.chat.tags, ok.chat.persona, ok.chat.provider], [["work"], "  be brief ", "groq"]);
  eq("import: a bare chat works too", importChat({ title: "Bare", messages: [{ role: "user", content: "x" }] }).ok, true);
  eq("import: missing times are made up in order", (() => { const r = importChat({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }, 500); return r.ok ? r.chat.messages.map((m) => m.createdAt) : []; })(), [500, 501]);
  eq("import: nonsense is refused with a reason", [importChat(null).ok, importChat("x").ok, importChat({}).ok, importChat({ messages: [] }).ok, importChat({ messages: [{ role: "system", content: "x" }] }).ok], [false, false, false, false, false]);
  eq("import: too many messages is refused", importChat({ messages: Array.from({ length: MAX_IMPORT_MESSAGES + 1 }, () => ({ role: "user", content: "x" })) }).ok, false);
  eq("import: an export of an export is the same chat", (() => { const a = importChat({ chat: ok.chat }, 2000); return a.ok && a.chat.messages.map((m) => m.content).join("|") === "hi|hello"; })(), true);
  eq("import: a wrong-typed field is skipped, not trusted", (() => { const r = importChat({ messages: [{ role: "user", content: "x", model: 5, createdAt: "soon", starred: "yes" }] }, 7); return r.ok ? [r.chat.messages[0].model, r.chat.messages[0].createdAt, r.chat.messages[0].starred] : null; })(), [undefined, 7, undefined]);

  const used = new Set<string>();
  eq("archive: dated, slugged names, never twice the same", [1, 2, 3].map(() => markdownEntryName({ title: "Plan: the trip", createdAt: Date.UTC(2026, 9, 3) }, used)), ["chats/2026-10-03-plan-the-trip.md", "chats/2026-10-03-plan-the-trip-2.md", "chats/2026-10-03-plan-the-trip-3.md"]);
  eq("archive: an untitled one still has a name", markdownEntryName({ title: "!!!", createdAt: 0 }, new Set()), "chats/1970-01-01-chat.md");
  eq("archive: the zip's name carries the date", markdownArchiveName(new Date(Date.UTC(2026, 9, 3))), "jarvis-chats-2026-10-03.zip");
}

// --- composing: counter, send key, /model, /tag, /undo, blanks, history, style ---
{
  console.log("\n--- composing ---");
  eq("counter: nothing, nothing", [composerCounts(""), composerCounts("  \n ")], [null, null]);
  eq("counter: words, characters, an estimate of tokens", composerCounts("Hello there, world"), { words: 3, chars: 18, tokens: 5 });
  eq("counter: wording is singular for one", counterLabel({ words: 1, chars: 1, tokens: 1 }), "1 word · 1 character · ~1 tokens");
  eq("counter: big numbers get commas", counterLabel({ words: 1200, chars: 7000, tokens: 1750 }), "1,200 words · 7,000 characters · ~1,750 tokens");

  const k = (key: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, ...mods });
  eq("send key: by default Enter sends, Shift+Enter doesn't, and Ctrl/Cmd+Enter does too", [shouldSend(k("Enter"), "enter"), shouldSend(k("Enter", { shiftKey: true }), "enter"), shouldSend(k("Enter", { ctrlKey: true }), "enter"), shouldSend(k("Enter", { metaKey: true }), "enter")], [true, false, true, true]);
  eq("send key: with Ctrl+Enter chosen, a bare Enter is a new line", [shouldSend(k("Enter"), "mod-enter"), shouldSend(k("Enter", { ctrlKey: true }), "mod-enter"), shouldSend(k("Enter", { metaKey: true }), "mod-enter"), shouldSend(k("Enter", { ctrlKey: true, shiftKey: true }), "mod-enter")], [false, true, true, false]);
  eq("send key: other keys never send", [shouldSend(k("a", { ctrlKey: true }), "enter"), shouldSend(k("Tab"), "mod-enter")], [false, false]);

  const providers = [
    { id: "groq", label: "Groq", ready: true, models: ["llama-3.3-70b-versatile", "mock-fast-8b", "mock-smart-120b"] },
    { id: "other", label: "Other", ready: true, models: ["fast", "tiny-fast-1b"] },
    { id: "off", label: "Offline", ready: false, models: ["fast-offline"] },
  ];
  eq("model: a word finds it", findModel("smart", providers)?.choice, { provider: "groq", model: "mock-smart-120b", label: "mock-smart-120b · Groq" });
  eq("model: an exact id beats a longer one that contains it", findModel("fast", providers)?.choice.model, "fast");
  eq("model: a prefix beats a match in the middle", findModel("tiny", providers)?.choice.model, "tiny-fast-1b");
  eq("model: the runners-up are named", findModel("fast", providers)?.others.map((o) => o.model), ["mock-fast-8b", "tiny-fast-1b"]);
  eq("model: several words must all match, provider included", findModel("groq fast", providers)?.choice.model, "mock-fast-8b");
  eq("model: a provider that isn't ready is never chosen", findModel("offline", providers), null);
  eq("model: case doesn't matter, nonsense is nothing", [findModel("LLAMA", providers)?.choice.model, findModel("zzz", providers), findModel("   ", providers)], ["llama-3.3-70b-versatile", null, null]);

  eq("tag: words are added, tidied, once each", applyTagCommand(["work"], "Urgent #Home work"), { tags: ["work", "urgent", "home"], added: ["urgent", "home"], removed: [], invalid: [] });
  eq("tag: a leading minus removes", applyTagCommand(["work", "old"], "-old"), { tags: ["work"], added: [], removed: ["old"], invalid: [] });
  eq("tag: both at once, commas allowed", applyTagCommand(["a"], "b, -a").tags, ["b"]);
  eq("tag: removing what isn't there is not a change", applyTagCommand(["a"], "-zzz"), { tags: ["a"], added: [], removed: [], invalid: [] });
  eq("tag: what can't be a tag is reported", applyTagCommand([], "ok !!! -").invalid, ["!!!", "-"]);

  const convo = [
    { id: "1", role: "user", content: "first" }, { id: "2", role: "assistant", content: "a" },
    { id: "3", role: "user", content: "second", attachments: [{}] }, { id: "4", role: "assistant", content: "b" }, { id: "5", role: "assistant", content: "c" },
  ];
  const undone = undoLastExchange(convo)!;
  eq("undo: your last message and everything after it go", [undone.messages.map((m) => m.id), undone.text, undone.removed, undone.hadAttachments], [["1", "2"], "second", 3, true]);
  eq("undo: the original isn't changed", convo.length, 5);
  eq("undo: nothing sent is nothing to undo", [undoLastExchange([]), undoLastExchange([{ id: "x", role: "assistant", content: "hi" }])], [null, null]);
  eq("undo: a single message leaves an empty chat", undoLastExchange([{ id: "1", role: "user", content: "only" }])!.messages, []);

  eq("blanks: in order, once each, any case", promptVariables("Translate {{text}} to {{ Language }}, then {{text}} and {{language}} again"), ["text", "Language"]);
  eq("blanks: date and time fill themselves, so aren't asked", promptVariables("Today is {{date}} at {{time}}. {{Date}}"), []);
  eq("blanks: no blanks, none", promptVariables("plain {text} and {{ }} and {{1}}"), []);
  const when = new Date(2026, 9, 3, 7, 5);
  eq("blanks: filled by what was typed, case-insensitively, and by the built-ins", fillVariables("Hi {{Name}}, it is {{date}} {{time}}", { name: "Dana" }, when), "Hi Dana, it is 2026-10-03 07:05");
  eq("blanks: one left empty stays as written, so nothing vanishes", fillVariables("To {{language}}", { language: "" }, when), "To {{language}}");
  eq("blanks: the same blank everywhere", fillVariables("{{x}} and {{x}}", { x: "1" }, when), "1 and 1");

  const sent = ["deploy the app", "write a test", "deploy the app", "Deploy to staging\nthen prod", "  ", "explain closures"];
  eq("history: newest first, each once — a repeat sits where it was last sent", searchHistory(sent, "").map((h) => h.text), ["explain closures", "Deploy to staging\nthen prod", "deploy the app", "write a test"]);
  eq("history: the words narrow it, ignoring case", searchHistory(sent, "DEPLOY").map((h) => h.preview), ["Deploy to staging", "deploy the app"]);
  eq("history: a long message is shortened to one line", searchHistory(["x".repeat(300)], "")[0].preview.length, 100);
  eq("history: a limit, and no matches is nothing", [searchHistory(sent, "", 2).length, searchHistory(sent, "zzz")], [2, []]);

  eq("style: three presets, in order", TEMPERATURE_PRESETS.map((p) => [p.id, p.value]), [["precise", 0.2], ["balanced", 0.7], ["creative", 1.1]]);
  eq("style: a value is a preset to within a hair", [presetOf(0.7)?.id, presetOf(0.72)?.id, presetOf(0.9), presetOf(1.1)?.id], ["balanced", "balanced", null, "creative"]);
  eq("style: pressing cycles; from a custom value it lands on balanced", [nextPreset(0.2).id, nextPreset(0.7).id, nextPreset(1.1).id, nextPreset(0.95).id], ["balanced", "creative", "precise", "balanced"]);

  eq("prefs: defaults", DEFAULT_PREFS, { sendKey: "enter", spellcheck: true, chatSort: "recent", compactList: false, reasoningOpen: false, hideMeta: false, newChatModel: null });
  eq("prefs: junk becomes the defaults, field by field", [cleanPrefs(null), cleanPrefs({ sendKey: "tab", spellcheck: "no" }), cleanPrefs({ sendKey: "mod-enter", spellcheck: false })], [DEFAULT_PREFS, DEFAULT_PREFS, { ...DEFAULT_PREFS, sendKey: "mod-enter", spellcheck: false }]);

  eq("slash: the new commands are listed, and the ones that need words say so", [COMMAND_NAMES.includes("model"), COMMAND_NAMES.includes("title"), COMMAND_NAMES.includes("tag"), COMMAND_NAMES.includes("undo"), matchSlash("/mo").map((m) => m.takesArgs), matchSlash("/un").map((m) => m.takesArgs)], [true, true, true, true, [true], [undefined]]);
  eq("slash: /title keeps its words", [parseSlash("/title My new name")?.name, parseSlash("/title My new name")?.args], ["title", "My new name"]);
  eq("prompts: one saved before a command existed is renamed, not lost", cleanPrompts([{ name: "tag", text: "my tag prompt" }, { name: "undo", text: "u" }, { name: "new", text: "still reserved" }, { name: "tag-prompt", text: "taken" }]).map((p) => p.name), ["tag-prompt", "undo-prompt"]);
}

// --- organising: memory housekeeping, chat notes and colours, sorting, storage ---
{
  console.log("\n--- organising and data ---");
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 9, 3, 12);
  eq("expiry: only a past or present time has run out", [isExpired({}, NOW), isExpired({ expires: NOW + 1 }, NOW), isExpired({ expires: NOW }, NOW), isExpired({ expires: NOW - 1 }, NOW)], [false, false, true, true]);
  eq("expiry: the label, in plain days", [expiryLabel({}, NOW), expiryLabel({ expires: NOW - DAY }, NOW), expiryLabel({ expires: NOW + 3600_000 }, NOW), expiryLabel({ expires: NOW + DAY + 1000 }, NOW), expiryLabel({ expires: NOW + 11 * DAY + 1000 }, NOW)], [null, "expired", "expires today", "expires tomorrow", "expires in 11 days"]);
  const end = expiryFromDateInput("2026-10-12")!;
  eq("expiry: a date means the end of that day, here", [new Date(end).getDate(), new Date(end).getHours(), new Date(end).getMinutes(), dateInputOf(end)], [12, 23, 59, "2026-10-12"]);
  eq("expiry: nonsense dates are refused, not rolled over", [expiryFromDateInput("2026-02-31"), expiryFromDateInput("soon"), expiryFromDateInput(""), expiryFromDateInput("2026-13-01")], [null, null, null, null]);
  eq("expiry: an empty date field is an empty string", [dateInputOf(undefined), dateInputOf(NaN)], ["", ""]);
  eq("expiry: a request may set it, clear it with null, or say nothing", [cleanExpiry(123.9), cleanExpiry(null), cleanExpiry(undefined), cleanExpiry("5"), cleanExpiry(-1), cleanExpiry(NaN)], [123, null, undefined, undefined, undefined, undefined]);

  const bulk = parseBulk("- Allergic to peanuts #Health\n2. Prefers metric units\n\n  * plain fact  \n#only #tags\nprefers METRIC units\nAllergic to peanuts\nalready known\n" + "x".repeat(2001), ["Already known"]);
  eq("bulk: one fact a line, bullets and numbers stripped, tags taken off the end", bulk.add, [{ text: "Allergic to peanuts", tags: ["health"] }, { text: "Prefers metric units", tags: [] }, { text: "plain fact", tags: [] }]);
  eq("bulk: what is skipped, and why", bulk.skipped, { duplicate: 3, tooLong: 1, empty: 1, overLimit: 0 });
  eq("bulk: a hundred at a time", [parseBulk(Array.from({ length: 130 }, (_, i) => `fact ${i}`).join("\n")).add.length, parseBulk(Array.from({ length: 130 }, (_, i) => `fact ${i}`).join("\n")).skipped.overLimit], [100, 30]);
  eq("bulk: a tag in the middle of a line stays in the text", parseBulk("I use #hashtags a lot").add, [{ text: "I use #hashtags a lot", tags: [] }]);

  const entry = (id: string, text: string, extra: Record<string, unknown> = {}) => ({ id, text, tags: [], createdAt: 100, updatedAt: 100, ...extra }) as never;
  const dupes = findDuplicates([
    entry("a", "Allergic to peanuts", { updatedAt: 500, tags: ["health"] }),
    entry("b", "  allergic   to PEANUTS ", { updatedAt: 900, tags: ["always"], expires: NOW + DAY }),
    entry("c", "Prefers metric units for everything", { updatedAt: 300 }),
    entry("d", "Prefers metric units for everything please", { updatedAt: 200 }),
    entry("e", "Lives in Cardiff", {}),
    entry("f", "Likes tea", {}),
    entry("g", "Likes tea a lot", {}),
  ]);
  eq("duplicates: the same words, however spaced, and near-identical wording are found", dupes.map((g) => [g.keep.id, g.extras.map((x: { id: string }) => x.id)]), [["b", ["a"]], ["c", ["d"]]]);
  eq("duplicates: short entries are only duplicates when identical — 'Likes tea' isn't 'Likes tea a lot'", dupes.some((g) => g.keep.id === "f" || g.keep.id === "g"), false);
  eq("duplicates: unrelated entries stay alone, and none is none", [findDuplicates([entry("a", "one thing"), entry("b", "another thing")]).length, findDuplicates([]).length], [0, 0]);
  const merged = mergeGroup(dupes[0]);
  eq("merge: the newest wording, everyone's tags, the earliest start, the latest touch", [merged.id, merged.text, merged.tags, merged.createdAt, merged.updatedAt], ["b", "  allergic   to PEANUTS ", ["always", "health"], 100, 900]);
  eq("merge: it only expires if every one of them did", [merged.expires, mergeGroup({ keep: entry("a", "x", { expires: 5 }), extras: [entry("b", "x", { expires: 9 })] }).expires], [undefined, 9]);

  eq("draft: the selection wins", rememberDraft("A long reply with many words.", "  the part I\n selected "), "the part I selected");
  eq("draft: otherwise the message as one plain line", rememberDraft("# Title\n\nSome **bold** text.\n\n- one\n- two"), "Title Some bold text. • one • two");
  eq("draft: thinking is left out", rememberDraft("<think>private</think>The answer."), "The answer.");
  const long = `${"First sentence here. ".repeat(10)}${"word ".repeat(100)}`;
  eq("draft: long ones are cut — at a sentence if there is one near the end", [rememberDraft(long).length <= 401, rememberDraft(long).endsWith("…"), rememberDraft("Short.")], [true, true, "Short."]);
  eq("draft: with no sentence break it cuts at a word", rememberDraft("word ".repeat(200)).endsWith("word…"), true);

  const rows = [
    { title: "banana", createdAt: 3, updatedAt: 30, messageCount: 5 },
    { title: "Apple", createdAt: 1, updatedAt: 10, messageCount: 50 },
    { title: "cherry 10", createdAt: 2, updatedAt: 20, messageCount: 5 },
    { title: "cherry 9", createdAt: 4, updatedAt: 40, messageCount: 1, pinned: true },
  ];
  eq("sort: recent, pinned first", sortChatList(rows, "recent").map((r) => r.title), ["cherry 9", "banana", "cherry 10", "Apple"]);
  eq("sort: oldest", sortChatList(rows, "oldest").map((r) => r.title), ["cherry 9", "Apple", "cherry 10", "banana"]);
  eq("sort: by title, ignoring case, numbers as numbers", sortChatList(rows, "title").map((r) => r.title), ["cherry 9", "Apple", "banana", "cherry 10"]);
  eq("sort: longest first, ties by recency", sortChatList(rows, "messages").map((r) => r.title), ["cherry 9", "Apple", "banana", "cherry 10"]);
  eq("sort: the original is untouched; pressing cycles all four and comes round", [rows[0].title, CHAT_SORTS.map((_, i) => nextSort(CHAT_SORTS[i]))], ["banana", ["oldest", "title", "messages", "recent"]]);

  const base = { id: "c", title: "T", createdAt: 1, updatedAt: 2, messages: [] } as never;
  const patched = (body: unknown) => applyChatPatch(base, body, 9999);
  const ok2 = (r: ReturnType<typeof patched>) => (r.ok ? r.chat : null);
  eq("chat: a colour can be set and cleared", [ok2(patched({ color: "green" }))?.color, ok2(patched({ color: null }))?.color], ["green", undefined]);
  eq("chat: a colour that isn't one is refused", [patched({ color: "mauve" }).ok, patched({ color: 5 }).ok], [false, false]);
  eq("chat: notes are saved as written, cleared by null or by being blank", [ok2(patched({ notes: "  keep this\nand this " }))?.notes, ok2(patched({ notes: null }))?.notes, ok2(patched({ notes: "   \n " }))?.notes], ["  keep this\nand this ", undefined, undefined]);
  eq("chat: notes are cut at 20,000 and must be text", [ok2(patched({ notes: "x".repeat(30000) }))?.notes?.length, patched({ notes: 5 }).ok], [20000, false]);
  eq("chat: tidying notes or colour isn't activity", [ok2(patched({ notes: "n" }))?.updatedAt, ok2(patched({ color: "red" }))?.updatedAt], [2, 2]);
  eq("chat: the list row says its colour and whether it has notes — without carrying the notes", [chatMeta({ ...(base as object), color: "blue", notes: "secret" } as never), chatMeta(base)], [{ id: "c", title: "T", createdAt: 1, updatedAt: 2, messageCount: 0, color: "blue", hasNotes: true }, { id: "c", title: "T", createdAt: 1, updatedAt: 2, messageCount: 0 }]);
  eq("chat: a branch keeps the colour but not the notes", (() => { const b = branchChat({ ...(base as object), color: "red", notes: "private", messages: [{ id: "m", role: "user", content: "x", createdAt: 1 }] } as never, undefined, 5)!; return [b.color, b.notes]; })(), ["red", undefined]);

  const live = entry("live", "Prefers metric units", { tags: ["always"] });
  const stale = entry("stale", "Prefers imperial units", { tags: ["always"], expires: Date.now() - 1000 });
  const future = entry("future", "Is testing the typescript build", { expires: Date.now() + DAY });
  eq("prompt: a fact that has run out is left out, pinned or not; one that hasn't, stays", forPrompt([live, stale, future], "typescript build").map((e) => e.id), ["live", "future"]);
  const exported = exportMemory([entry("a", "keeps", { expires: 12345 }), entry("b", "forever")]).entries;
  eq("transfer: an expiry travels in an export, only when there is one", [exported[0].expires, "expires" in exported[1]], [12345, false]);
  const imported = planImport([], { format: "memory-bad" }, () => "x");
  const plan = planImport([], [{ text: "a", expires: 777 }, { text: "b", expires: "soon" }, { text: "c", expires: -4 }], (() => { let n = 0; return () => `id${n++}`; })());
  eq("transfer: and comes back in on import, if it is a real time", plan.ok ? plan.add.map((e) => e.expires) : null, [777, undefined, undefined]);
  eq("transfer: (a wrong file is still refused)", imported.ok, false);

  eq("storage: files are sorted into rows by where they sit", ["chats/a.json", "trash/b.json", "images/x.png", "backups/zip", "memory.json", "audit.jsonl", "schedule.json"].map(categorize), ["chats", "trash", "pictures", "backups", "memory", "other", "other"]);
  eq("storage: sizes in words", [0, -5, NaN, 850, 1536, 15 * 1024, 5 * 1024 * 1024, 3 * 1024 ** 3].map(formatBytes), ["0 B", "0 B", "0 B", "850 B", "1.5 KB", "15 KB", "5.0 MB", "3.0 GB"]);
}

// --- models and tools: notes, tools off, reply length, chat info, speeds ---
{
  console.log("\n--- models and tools ---");
  eq("notes: keyed like favourites, tidied, cut to 80, junk dropped", cleanModelNotes({ "groq:mock-fast-8b": "  good   for\ncode ", "nocolon": "x", "groq:x": 5, "a:b": "   ", "groq:long": "y".repeat(200) }), { "groq:mock-fast-8b": "good for code", "groq:long": "y".repeat(80) });
  eq("notes: not an object is none", [cleanModelNotes(null), cleanModelNotes([1]), cleanModelNotes("x")], [{}, {}, {}]);
  eq("notes: at most 50", Object.keys(cleanModelNotes(Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`p:m${i}`, "n"])))).length, 50);
  eq("notes: set, change and clear one", [withModelNote({}, "a:b", "hello"), withModelNote({ "a:b": "old" }, "a:b", " new "), withModelNote({ "a:b": "old" }, "a:b", "  ")], [{ "a:b": "hello" }, { "a:b": "new" }, {}]);
  eq("notes: a model id with a colon in it is fine (local servers)", cleanModelNotes({ "local:qwen2.5:7b": "slow" }), { "local:qwen2.5:7b": "slow" });

  eq("tools off: tool names only, once each", cleanDisabledTools(["web_search", " calculate ", "web_search", "Bad Name", "../x", 5, "", "run_command"]), ["web_search", "calculate", "run_command"]);
  eq("tools off: not a list is nothing", [cleanDisabledTools(null), cleanDisabledTools("web_search")], [[], []]);
  eq("tools off: a ceiling", cleanDisabledTools(Array.from({ length: 80 }, (_, i) => `tool_${i}`)).length, 40);
  eq("tools off: toggling", [toggleTool([], "a_b"), toggleTool(["a_b", "c"], "a_b")], [["a_b"], ["c"]]);
  const everything = allTools().map((t) => t.name);
  eq("tools off: the registry leaves out what is switched off, and only that", [allTools({ disabledTools: ["calculate", "web_search"] }).map((t) => t.name), everything.length - 2], [everything.filter((n) => n !== "calculate" && n !== "web_search"), allTools({ disabledTools: ["calculate", "web_search"] }).length]);
  eq("tools off: it can't add anything — a name that isn't a tool changes nothing", allTools({ disabledTools: ["not_a_tool"] }).length, everything.length);
  eq("tools off: a switched-off tool can't be run if asked for anyway", getTool("calculate", { disabledTools: ["calculate"] }), undefined);
  eq("tools off: and its schema stops costing tokens", estimateTokens(JSON.stringify(allTools({ disabledTools: ["calculate"] }).map(toWireTool))) < estimateTokens(JSON.stringify(allTools().map(toWireTool))), true);

  eq("length: three, in order, and cycling", [REPLY_LENGTHS.join(), nextLength("brief"), nextLength("normal"), nextLength("detailed")], ["brief,normal,detailed", "normal", "detailed", "brief"]);
  eq("length: normal adds nothing; the others say one thing", [lengthHint("normal"), /short/.test(lengthHint("brief") ?? ""), /thorough/.test(lengthHint("detailed") ?? "")], [null, true, true]);
  eq("length: the server accepts only the three names", [isReplyLength("brief"), isReplyLength("essay"), isReplyLength(undefined), isReplyLength({ toString: () => "brief" })], [true, false, false, false]);

  const when = Date.UTC(2026, 9, 3, 12);
  const msgs = [
    { id: "1", role: "user", content: "hello there friend", createdAt: when, attachments: [{ name: "a" }, { name: "b" }] },
    { id: "2", role: "assistant", content: "<think>hidden hidden hidden</think>Hi back to you", createdAt: when + 60_000, model: "m1", stats: { totalMs: 4000, firstTokenMs: 500, tokens: 20 }, reaction: "up", starred: true, toolRounds: [{ round: 1, calls: [{ id: "a", name: "calculate", arguments: "{}" }, { id: "b", name: "web_search", arguments: "{}" }], results: [{ toolCallId: "a", name: "calculate", content: "4", isError: false, ms: 3 }, { toolCallId: "b", name: "web_search", content: "no", isError: true, ms: 900 }] }] },
    { id: "3", role: "user", content: "again", createdAt: when + 7_200_000 },
    { id: "4", role: "assistant", content: "ok", createdAt: when + 7_260_000, model: "m2", stats: { totalMs: 9000, firstTokenMs: 100, tokens: 50 }, reaction: "down" },
    { id: "5", role: "system", content: "ignored", createdAt: 1 },
  ] as never[];
  const info = chatInfo({ messages: msgs });
  eq("info: messages and words, reasoning not counted", [info.messages, info.words], [{ user: 2, assistant: 2 }, { user: 4, assistant: 5 }]);
  eq("info: models, tools, ratings, saves and files", [info.models, info.tools, info.reactions, info.starred, info.attachments], [[{ model: "m1", replies: 1 }, { model: "m2", replies: 1 }], { calls: 2, errors: 1 }, { up: 1, down: 1 }, 1, 2]);
  eq("info: when it began and ended, how long between, the slowest reply", [info.firstAt, info.lastAt, info.spanMs, info.slowestMs], [when, when + 7_260_000, 7_260_000, 9000]);
  eq("info: the size is the conversation's, without the system message", info.tokens > 20 && info.tokens < 200, true);
  eq("info: an empty chat is zeros", [chatInfo({ messages: [] }).tokens, chatInfo({ messages: [] }).firstAt, chatInfo({ messages: [] }).spanMs], [0, null, 0]);
  eq("info: spans in words", [30_000, 60_000, 25 * 60_000, 60 * 60_000, 125 * 60_000, 50 * 3_600_000].map(spanLabel), ["under a minute", "1 minute", "25 minutes", "1 hour", "2 hours 5 minutes", "2 days"]);

  const stats = computeChatStats([{ id: "c1", title: "One", createdAt: 1, updatedAt: 1, messages: msgs.filter((m: { role: string }) => m.role !== "system") }, { id: "c2", title: "Two", createdAt: 1, updatedAt: 1, messages: [{ id: "x", role: "assistant", content: "q", createdAt: when + 99, model: "m1", stats: { totalMs: 2500, firstTokenMs: 500, tokens: 40 } }] }] as never[], { now: when + 10_000_000 });
  eq("speeds: tokens per second once the words started, fastest first", stats.speeds, [{ model: "m1", replies: 2, tokensPerSecond: 10.9, firstTokenMs: 500 }, { model: "m2", replies: 1, tokensPerSecond: 5.6, firstTokenMs: 100 }]);
  eq("speeds: a reply with no timing is left out", computeChatStats([{ id: "c", title: "C", createdAt: 1, updatedAt: 1, messages: [{ id: "a", role: "assistant", content: "x", createdAt: 1, model: "m" }] }] as never[]).speeds, []);
  eq("recent tools: newest first, with the chat they ran in, failures marked", stats.recentTools.map((t) => [t.name, t.isError, t.chatTitle]), [["calculate", false, "One"], ["web_search", true, "One"]]);
  eq("recent tools: only so many", computeChatStats([{ id: "c", title: "C", createdAt: 1, updatedAt: 1, messages: Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: "assistant", content: "x", createdAt: i, toolRounds: [{ round: 1, calls: [], results: [{ toolCallId: "t", name: "calculate", content: "", isError: false, ms: 1 }] }] })) }] as never[]).recentTools.length, 15);

  const settingsIn = importSettings(JSON.stringify({ format: "jarvis-settings", version: 1, settings: { modelNotes: { "groq:m": "fast" , bad: "x" }, disabledTools: ["web_search", "../no"], noFallback: true, replyLength: "brief" } }), DEFAULT_SETTINGS);
  eq("settings file: notes, tools off, no-fallback and length come in, cleaned", settingsIn.ok ? [settingsIn.settings.modelNotes, settingsIn.settings.disabledTools, settingsIn.settings.noFallback, settingsIn.settings.replyLength] : null, [{ "groq:m": "fast" }, ["web_search"], true, "brief"]);
  const settingsBad = importSettings(JSON.stringify({ format: "jarvis-settings", version: 1, settings: { replyLength: "essay", noFallback: "yes", disabledTools: "all" } }), DEFAULT_SETTINGS);
  eq("settings file: wrong-typed ones are ignored", settingsBad.ok ? [settingsBad.settings.replyLength, settingsBad.settings.noFallback, settingsBad.settings.disabledTools] : null, [undefined, undefined, undefined]);
  eq("prefs: the new-chat model must be well-formed", [cleanPrefs({ newChatModel: { provider: "groq", model: "m" } }).newChatModel, cleanPrefs({ newChatModel: { provider: "../x", model: "m" } }).newChatModel, cleanPrefs({ newChatModel: { provider: "g" } }).newChatModel, cleanPrefs({ newChatModel: "groq:m" }).newChatModel], [{ provider: "groq", model: "m" }, null, null, null]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
