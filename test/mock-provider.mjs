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

  if (NO_AUTH || req.url.startsWith("/search")) {
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
        return streamText(res, `The calculator says: ${toolMessage?.content ?? "?"}`, finish);
      }

      return streamText(res, CODE_REPLY, finish);
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORT, () => console.log(`[mock] listening on :${PORT}`));
