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

const PORT = Number(process.env.MOCK_PORT ?? 8899);

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

const server = http.createServer((req, res) => {
  const auth = req.headers.authorization || "";

  if (req.url.startsWith("/search")) {
    // fall through to the handler below; SearXNG needs no auth
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
        return streamText(res, `The calculator says: ${toolMessage?.content ?? "?"}`, finish);
      }

      return streamText(res, CODE_REPLY, finish);
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORT, () => console.log(`[mock] listening on :${PORT}`));
