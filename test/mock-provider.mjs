/**
 * A minimal OpenAI-compatible server for testing.
 *
 * Lets the whole request path — streaming, tool rounds, fallback, errors — be
 * exercised without spending a free-tier quota. Start it with:
 *   node test/mock-provider.mjs
 * then point a provider at it:
 *   JARVIS_GROQ_BASE_URL=http://localhost:8899/v1 GROQ_API_KEY=test npm run dev
 */
import http from "node:http";
import { deflateSync } from "node:zlib";

const PORT = Number(process.env.MOCK_PORT ?? 8899);

/** A real, decodable PNG of one colour — enough for a browser to render. */
function solidPng(width, height, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill([r, g, b]).flat())]);
  const pixels = Buffer.concat(Array(height).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CODE_REPLY = `Here's a bouncing ball.

\`\`\`html
<!-- bounce.html -->
<!doctype html>
<html><head><meta charset="utf-8"><style>
  body{margin:0;background:#0b0e14;overflow:hidden}
  .ball{position:absolute;width:54px;height:54px;border-radius:50%;
        background:radial-gradient(circle at 32% 32%,#7dd3fc,#0284c7);}
</style></head>
<body><div class="ball" id="b"></div><script>
  const b=document.getElementById('b');let x=40,y=40,dx=3.6,dy=2.9;
  (function tick(){
    x+=dx;y+=dy;
    if(x<0||x>innerWidth-54)dx=-dx;
    if(y<0||y>innerHeight-54)dy=-dy;
    b.style.transform='translate('+x+'px,'+y+'px)';
    requestAnimationFrame(tick);
  })();
<\/script></body></html>
\`\`\`

That runs standalone in any browser.`;

/** A long answer, for testing that nothing is dropped and speech streams. */
const LONG_REPLY = Array.from({ length: 40 }, (_, i) =>
  `This is sentence number ${i + 1}, long enough to look like a real paragraph of explanation.`,
).join(" ");

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

/** Stream text in small chunks, deliberately splitting mid-word. */
function streamText(res, text, done) {
  const chunks = text.match(/[\s\S]{1,17}/g) ?? [];
  let i = 0;
  const timer = setInterval(() => {
    if (i >= chunks.length) {
      clearInterval(timer);
      done();
      return;
    }
    sse(res, { choices: [{ delta: { content: chunks[i++] } }] });
  }, 8);
  // 'close' on the RESPONSE — on the request it fires as soon as the body is
  // read, which would kill the stream before it starts.
  res.on("close", () => clearInterval(timer));
}

/**
 * Emit a tool call the way real providers do: id and name on the first
 * fragment, then `arguments` dribbled out in pieces that are not valid JSON
 * until concatenated. This is what ToolCallAccumulator has to survive.
 */
function streamToolCall(res, { id, name, args }, done) {
  const json = JSON.stringify(args);
  const pieces = json.match(/[\s\S]{1,5}/g) ?? [];

  sse(res, {
    choices: [{ delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "" } }] } }],
  });

  let i = 0;
  const timer = setInterval(() => {
    if (i >= pieces.length) {
      clearInterval(timer);
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
      done();
      return;
    }
    sse(res, {
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: pieces[i++] } }] } }],
    });
  }, 8);
  res.on("close", () => clearInterval(timer));
}

/**
 * Stand in for a local Ollama, which authenticates nobody.
 *
 * Without this the mock demands a Bearer token, so a keyless provider could
 * only ever be tested by giving it a key — which is precisely the bug.
 */
const NO_AUTH = process.env.MOCK_NO_AUTH === "1";

const server = http.createServer((req, res) => {
  const auth = req.headers.authorization || "";

  if (NO_AUTH && auth) {
    // A local server should never be sent a credential at all.
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: { message: `Unexpected Authorization: ${auth}` } }));
  }

  if (NO_AUTH || req.url.startsWith("/search") || req.url.startsWith("/prompt/") || req.url.startsWith("/v1beta/") || req.url.startsWith("/files/") || req.url.startsWith("/api/generate-video") || req.url.startsWith("/api/video/status")) {
    // fall through to the handler below; neither needs auth
  } else if (!auth.startsWith("Bearer ")) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "Missing API key" } }));
  }
  // Simulates a rate limit, so provider fallback can be tested.
  if (auth === "Bearer RATELIMITED") {
    res.writeHead(429, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "Rate limit reached" } }));
  }

  // Stands in for a SearXNG instance: point SEARXNG_URL at http://localhost:8899
  if (req.url.startsWith("/search")) {
    process.stdout.write(`[mock] search ${req.url}\n`);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      results: [
        { title: "Groq LPU architecture", url: "https://groq.com/lpu", content: "The LPU is a deterministic processor built for inference." },
        { title: "Cerebras wafer-scale", url: "https://cerebras.ai/wse", content: "A single wafer holds the whole model." },
      ],
    }));
  }

  // Stands in for NanoGPT's image endpoint: point JARVIS_NANOGPT_IMAGES_URL
  // at http://localhost:8899/v1/images/generations
  if (req.url.endsWith("/images/generations")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      process.stdout.write(`[mock] image model=${parsed.model} edit=${Boolean(parsed.imageDataUrl)}\n`);
      // Blue for an edit, amber for a fresh picture, so a screenshot shows which ran.
      const png = solidPng(256, 256, parsed.imageDataUrl ? [56, 189, 248] : [251, 191, 36]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
    });
    return;
  }

  // Stands in for NanoGPT's video API (JARVIS_NANOGPT_VIDEO_URL=http://localhost:8899): submit returns a
  // run id, the second status poll is COMPLETED (nested under `data`, as NanoGPT's examples show).
  if (req.url === "/api/generate-video" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      process.stdout.write(`[mock] nano video key=${req.headers["x-api-key"] ? "yes" : "no"} body=${JSON.stringify({ ...parsed, prompt: undefined })} prompt=${String(parsed.prompt).slice(0, 300)}\n`);
      globalThis.__nano = globalThis.__nano ?? {};
      const runId = `vid_${Date.now()}`;
      globalThis.__nano[runId] = { polls: 0, blocked: String(parsed.prompt).includes("BLOCKME") };
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ runId, id: runId, status: "pending", model: parsed.model, cost: 0.35 }));
    });
    return;
  }
  if (req.url.startsWith("/api/video/status")) {
    const id = new URL(req.url, "http://x").searchParams.get("requestId");
    const op = globalThis.__nano?.[id];
    if (!req.headers["x-api-key"]) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: 401, message: "no key" })); }
    if (!op) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: 404, message: "unknown job" })); }
    op.polls += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    if (op.polls < 2) return res.end(JSON.stringify({ requestId: id, data: { status: "IN_PROGRESS", requestId: id } }));
    if (op.blocked) return res.end(JSON.stringify({ requestId: id, data: { status: "FAILED", error: "content policy", userFriendlyError: "That scene was declined by the content filter.", isNSFWError: true } }));
    return res.end(JSON.stringify({ requestId: id, data: { status: "COMPLETED", output: { video: { url: "http://localhost:8899/files/clip.mp4" } }, cost: 0.35 } }));
  }

  // Stands in for Gemini's Veo video endpoints (JARVIS_GEMINI_VIDEO_URL=http://localhost:8899):
  // start returns an operation, the second poll of it is done, and the file is a bare MP4 header.
  if (req.url.includes(":predictLongRunning") && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      const prompt = parsed.instances?.[0]?.prompt ?? "";
      process.stdout.write(`[mock] video key=${req.headers["x-goog-api-key"] ? "yes" : "no"} params=${JSON.stringify(parsed.parameters)} prompt=${prompt.slice(0, 200)}\n`);
      globalThis.__ops = globalThis.__ops ?? {};
      const name = `models/veo/operations/op${Date.now()}`;
      globalThis.__ops[name] = { polls: 0, blocked: prompt.includes("BLOCKME") };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name }));
    });
    return;
  }
  if (req.url.startsWith("/v1beta/models/veo/operations/")) {
    const name = req.url.slice("/v1beta/".length);
    const op = globalThis.__ops?.[name];
    res.writeHead(op ? 200 : 404, { "Content-Type": "application/json" });
    if (!op) return res.end(JSON.stringify({ error: { message: "no such operation" } }));
    op.polls += 1;
    if (op.polls < 2) return res.end(JSON.stringify({ name, done: false }));
    if (op.blocked) return res.end(JSON.stringify({ name, done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ["Blocked by the safety filter."] } } }));
    return res.end(JSON.stringify({ name, done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "http://localhost:8899/files/clip.mp4" } }] } } }));
  }
  if (req.url === "/files/clip.mp4") {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2"), Buffer.alloc(2000, 7)]);
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": mp4.length });
    return res.end(mp4);
  }

  // Stands in for the free keyless image service: point JARVIS_POLLINATIONS_URL
  // at http://localhost:8899 and GET /prompt/<text>?seed=...
  if (req.url.startsWith("/prompt/")) {
    const u = new URL(req.url, "http://localhost");
    process.stdout.write(`[mock] free image seed=${u.searchParams.get("seed")} size=${u.searchParams.get("width")}x${u.searchParams.get("height")} prompt=${decodeURIComponent(u.pathname.slice(8))}\n`);
    const png = solidPng(64, 64, [52, 211, 153]);
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length });
    res.end(png);
    return;
  }

  // Stands in for Groq's Whisper endpoint.
  if (req.url.endsWith("/audio/transcriptions")) {
    let size = 0;
    req.on("data", (c) => (size += c.length));
    req.on("end", () => {
      process.stdout.write(`[mock] transcribe ${size} bytes\n`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: "give me a long answer" }));
    });
    return;
  }

  if (req.url.endsWith("/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      data: [
        { id: "mock-fast-8b" },
        { id: "mock-smart-120b" },
        { id: "mock-no-tools" },
        { id: "whisper-large-v3" }, // the adapter must filter this out
      ],
    }));
  }

  if (req.url.endsWith("/chat/completions")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      const messages = parsed.messages ?? [];
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const prompt = String(lastUser?.content ?? "");
      const alreadyRanTool = messages.some((m) => m.role === "tool");

      // Report the content shape so multimodal wiring can be verified.
      const latest = [...messages].reverse().find((m) => m.role === "user");
      const shape = Array.isArray(latest?.content)
        ? `parts[${latest.content.map((p) => (p.type === "image_url" ? "image" : "text")).join(",")}]`
        : `string(${String(latest?.content ?? "").length})`;

      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const memoryLines = /What you remember about this user:\n([\s\S]*?)\n\n/.exec(system);
      process.stdout.write(
        `[mock] model=${parsed.model} msgs=${messages.length} tools=${parsed.tools?.length ?? 0} toolResults=${alreadyRanTool}` +
          ` content=${shape}` +
          (memoryLines ? ` memory=[${memoryLines[1].replace(/\n/g, " | ").trim()}]` : " memory=none") +
          `\n`,
      );

      // A model that rejects the tools parameter, for the degradation path.
      if (parsed.model === "mock-no-tools" && parsed.tools) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
          error: { message: "This model does not support tool calling." },
        }));
      }

      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.flushHeaders();

      const finish = () => {
        res.write("data: [DONE]\n\n");
        res.end();
      };

      /**
       * A model that never stops asking, so a round budget can be measured.
       *
       * Every other case here answers after one tool result, which is what a
       * well-behaved model does — and which means none of them can show
       * whether the loop stops at 5 rounds or 25. This one keeps calling
       * until the harness withholds tools on the final round, at which point
       * it has to conclude. The round number comes from counting tool results
       * already in the conversation.
       */
      if (/keep going|many steps/i.test(prompt)) {
        if (!parsed.tools?.length) {
          return streamText(
            res,
            `Stopped after ${messages.filter((m) => m.role === "tool").length} steps.`,
            finish,
          );
        }
        const step = messages.filter((m) => m.role === "tool").length + 1;
        return streamToolCall(
          res,
          { id: `call_step${step}`, name: "get_time", args: { timezone: "UTC" } },
          finish,
        );
      }

      // A table, including cells a hostile page could have planted: a comma, and a spreadsheet formula.
      if (/show me a table/i.test(prompt) && !alreadyRanTool) {
        return streamText(
          res,
          [
            "Here you go.",
            "",
            "| Name | Score |",
            "|---|---|",
            "| Ada, Countess | 10 |",
            '| =HYPERLINK("http://evil.example","click") | -5 |',
          ].join("\n"),
          finish,
        );
      }

      // Proves per-chat instructions reach the model: the system prompt is what
      // changes, so the reply is keyed off it.
      const personaMessage = messages.find((m) => m.role === "system");
      if (/pirate speak/i.test(String(personaMessage?.content ?? "")) && !alreadyRanTool && /^hello/i.test(prompt)) {
        return streamText(res, "Arr, matey. Ye be talking to a pirate.", finish);
      }

      // Persona presets: the preset's intro is what changes, so the reply keys off it.
      if (/patient teacher/i.test(String(personaMessage?.content ?? "")) && !alreadyRanTool && /^teach/i.test(prompt)) {
        return streamText(res, "Let's start from what you already know.", finish);
      }

      // Says which model it was asked as, so a test can see "regenerate with…" go where it was sent.
      if (/^which model/i.test(prompt)) {
        return streamText(res, `I am ${parsed.model}.`, finish);
      }

      // The guidance the app adds when a message sounds frustrated, rushed or low is echoed
      // back in each reply, so a test can see that the server really received it.
      if (/The user sounds frustrated/.test(system)) return streamText(res, "Understood. Straight to the fix: restart the service, then retry. (direct)", finish);
      if (/may be in distress/.test(system)) return streamText(res, "I am here. How are you doing right now? (gentle)", finish);
      if (/may be feeling low/.test(system)) return streamText(res, "That sounds heavy. Take your time. (gentle)", finish);
      if (/under time pressure/.test(system)) return streamText(res, "Fastest route: run it as it is. (short)", finish);
      // The one-sentence reply-length guidance, echoed so a test can see it arrived.
      if (/Keep the reply short/.test(system)) return streamText(res, "Short answer, no preamble. (brief)", finish);
      if (/Give a thorough reply/.test(system)) return streamText(res, "A thorough answer with reasoning and an example. (detailed)", finish);
      // A reply that ends in a question of its own, which gets no follow-up buttons under it.
      if (/ask me a question/i.test(prompt)) return streamText(res, "Happy to help with that. What would you like to build first?", finish);

      // Unit conversion goes through the calculate tool, like arithmetic does.
      const conversion = /^convert (.+)$/i.exec(prompt.trim());
      if (conversion && parsed.tools?.some((t) => t.function?.name === "calculate") && !alreadyRanTool) {
        return streamToolCall(res, { id: "call_conv1", name: "calculate", args: { expression: conversion[1] } }, finish);
      }

      // Self-editing: the model changing its own welcome screen, in the sandbox.
      if (parsed.tools?.some((t) => t.function?.name === "code_edit") && /change your (welcome )?title/i.test(prompt) && !alreadyRanTool) {
        return streamToolCall(
          res,
          {
            id: "call_self1",
            name: "code_edit",
            args: {
              path: "components/ChatPane.tsx",
              find: '<h2 className="mb-1 text-lg font-semibold">JARVIS Mark 6</h2>',
              replace: '<h2 className="mb-1 text-lg font-semibold">JARVIS Mark 6 · edited by itself</h2>',
            },
          },
          finish,
        );
      }

      // Pictures first: an image id is full of digit-hyphen-digit, which the
      // calculator rule below would otherwise claim.
      const offersImages = parsed.tools?.some((t) => t.function?.name === "generate_image");
      const picturePath = /\/api\/images\/[0-9a-f-]{36}/.exec(prompt)?.[0];
      if (offersImages && picturePath && !alreadyRanTool) {
        return streamToolCall(
          res,
          { id: "call_img2", name: "generate_image", args: { prompt: "the same, at night", edit: picturePath } },
          finish,
        );
      }
      if (offersImages && /draw|picture of/i.test(prompt) && !alreadyRanTool) {
        return streamToolCall(
          res,
          { id: "call_img1", name: "generate_image", args: { prompt: "a lighthouse in a storm" } },
          finish,
        );
      }

      // Ask for a tool the first time round, then answer using its result.
      if (parsed.tools?.length && /write.*file|create.*file/i.test(prompt) && !alreadyRanTool) {
        return streamToolCall(
          res,
          { id: "call_write1", name: "write_file", args: { path: "notes/hello.txt", content: "written by jarvis" } },
          finish,
        );
      }

      if (parsed.tools?.length && /run (a )?command|execute/i.test(prompt) && !alreadyRanTool) {
        return streamToolCall(
          res,
          { id: "call_cmd1", name: "run_command", args: { command: "echo hello && env | grep -c API_KEY", reason: "demonstrate" } },
          finish,
        );
      }

      if (parsed.tools?.length && /search|look ?up|latest|news/i.test(prompt) && !alreadyRanTool) {
        return streamToolCall(
          res,
          { id: "call_search1", name: "web_search", args: { query: "groq lpu", count: 2 } },
          finish,
        );
      }

      // A date question is what /api/probe asks, because it is the cleanest
      // prompt that a tool-using model must answer with a tool call rather
      // than from memory.
      if (parsed.tools?.length && /date|time|today/i.test(prompt) && !alreadyRanTool) {
        return streamToolCall(
          res,
          { id: "call_time1", name: "get_time", args: { timezone: "UTC" } },
          finish,
        );
      }

      if (parsed.tools?.length && /calculat|multiply|\d\s*[*+/-]\s*\d/i.test(prompt) && !alreadyRanTool) {
        return streamToolCall(
          res,
          { id: "call_abc123", name: "calculate", args: { expression: "(2+3)*sqrt(16)" } },
          finish,
        );
      }

      if (/long answer|explain at length/i.test(prompt)) {
        return streamText(res, LONG_REPLY, finish);
      }

      if (alreadyRanTool) {
        const toolMessage = [...messages].reverse().find((m) => m.role === "tool");
        const picture = /!\[[^\]]*\]\([^)]*\)/.exec(String(toolMessage?.content ?? ""));
        if (picture) return streamText(res, `Here it is.\n\n${picture[0]}`, finish);
        if (/sandbox|did not approve/.test(String(toolMessage?.content ?? ""))) {
          return streamText(res, `Done. ${toolMessage.content}`, finish);
        }
        return streamText(res, `The calculator says: ${toolMessage?.content ?? "?"}`, finish);
      }

      return streamText(res, CODE_REPLY, finish);
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORT, () => console.log(`[mock] listening on :${PORT}`));
