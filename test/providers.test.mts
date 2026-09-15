/**
 * The provider layer, with a keyless local server in the mix.
 *
 * The bug this suite exists to prevent is a quiet one: everything used to
 * gate on "is there an API key?", so a local Ollama — which authenticates
 * nobody — was dropped from the fallback order, listed no models, and was
 * never tried, all while being perfectly reachable. Nothing errored. It
 * simply never appeared.
 *
 * Run: npx tsx test/providers.test.mts
 */
import http from "node:http";
import { spawn } from "node:child_process";
import {
  anyProviderConfigured,
  defaultProviderId,
  fallbackOrder,
  getProvider,
  preferredModel,
  providerReady,
  requiresKey,
  resolveEndpoint,
  PROVIDER_IDS,
  resolveKey,
  sanitizeEndpoint,
} from "../lib/providers/registry";
import { listModels, streamChat } from "../lib/providers/openai-compat";
import { ProviderError } from "../lib/providers/types";
import { readSSE, extractChunk } from "../lib/stream";

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

/** Env is the registry's only input, so each case sets exactly what it means. */
function withEnv(vars: Record<string, string | undefined>, run: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Every keyed slot, so a test can then remove exactly one and see it drop. */
const ALL_CLOUD_KEYS = {
  GROQ_API_KEY: "k",
  GEMINI_API_KEY: "k",
  CEREBRAS_API_KEY: "k",
  MISTRAL_API_KEY: "k",
  OPENROUTER_API_KEY: "k",
};
const NO_CLOUD_KEYS = Object.fromEntries(
  Object.keys(ALL_CLOUD_KEYS).map((k) => [k, undefined]),
) as Record<string, undefined>;

/** Two keys only, the common case: something set, something not. */
const CLOUD_KEYS = { ...NO_CLOUD_KEYS, GROQ_API_KEY: "k", CEREBRAS_API_KEY: "k" };

console.log("\n--- who is usable ---");
{
  withEnv(NO_CLOUD_KEYS, () => {
    eq("a keyed provider with no key is not ready", providerReady("groq"), false);
    eq("a keyless provider is always ready", providerReady("local"), true);
    eq("a client-supplied key makes it ready", providerReady("groq", "byo-key"), true);
    eq("an unknown provider is never ready", providerReady("nope"), false);
  });

  eq("local declares it needs no key", requiresKey("local"), false);
  eq("groq still needs one", requiresKey("groq"), true);
}

console.log("\n--- fallback order ---");
{
  withEnv(CLOUD_KEYS, () => {
    // The whole point: local is present, and it is last.
    eq("local is the backstop, never the first try", fallbackOrder("groq"), ["groq", "cerebras", "local"]);
    eq("a rate-limited groq rolls over to cerebras before local", fallbackOrder("groq")[1], "cerebras");
    eq("an explicit choice of local is honoured first", fallbackOrder("local"), ["local", "groq", "cerebras"]);
    // A provider with no key is simply absent, rather than tried and failed.
    eq("a keyless-by-omission provider is dropped", fallbackOrder("groq").includes("mistral"), false);
  });

  withEnv(ALL_CLOUD_KEYS, () => {
    eq(
      "every configured provider is in the chain, local last",
      fallbackOrder("groq"),
      ["groq", "gemini", "cerebras", "mistral", "openrouter", "local"],
    );
    // Gemini has 40x Groq's per-minute budget and a window Cerebras can't
    // match, so it is the first place a rate-limited turn should land.
    eq("gemini is the first fallback", fallbackOrder("groq")[1], "gemini");
  });

  withEnv(NO_CLOUD_KEYS, () => {
    // Before this change, no keys meant no providers at all and a 401.
    eq("with no keys at all, local alone still answers", fallbackOrder("groq"), ["local"]);
  });
}

console.log("\n--- is this install set up at all ---");
{
  withEnv(NO_CLOUD_KEYS, () => {
    /**
     * The regression this guards. Adding an always-ready keyless slot meant
     * the fallback order was never empty, so the "no key configured" guidance
     * became unreachable and a fresh clone answered its first message with
     * "No usable model found on Self-hosted" — naming a server the user had
     * never configured or heard of.
     */
    eq("a fresh clone is not configured", anyProviderConfigured(), false);
    eq("even though a slot is always ready", providerReady("local"), true);
    eq("and the order is never empty", fallbackOrder("groq").length > 0, true);

    eq("a key pasted in Settings counts", anyProviderConfigured({ groq: "byo" }), true);
  });

  withEnv({ ...NO_CLOUD_KEYS, GEMINI_API_KEY: "k" }, () => {
    eq("one env key anywhere counts", anyProviderConfigured(), true);
  });
}

console.log("\n--- defaults ---");
{
  withEnv({ ...CLOUD_KEYS, JARVIS_DEFAULT_PROVIDER: undefined }, () => {
    eq("a keyed provider is preferred over the slow local one", defaultProviderId(), "groq");
  });
  withEnv({ ...NO_CLOUD_KEYS, JARVIS_DEFAULT_PROVIDER: undefined }, () => {
    eq("but with nothing else configured, local is the default", defaultProviderId(), "local");
  });
  withEnv({ ...CLOUD_KEYS, JARVIS_DEFAULT_PROVIDER: "local" }, () => {
    eq("an explicit default always wins", defaultProviderId(), "local");
  });
}

console.log("\n--- per-provider overrides ---");
{
  withEnv({ JARVIS_LOCAL_BASE_URL: "http://192.168.1.50:11434/v1/", JARVIS_LOCAL_MODEL: "qwen3:4b", JARVIS_LOCAL_CONTEXT: "16000" }, () => {
    eq("base url override, trailing slash trimmed", getProvider("local").baseUrl, "http://192.168.1.50:11434/v1");
    eq("context override", getProvider("local").maxContextTokens, 16000);
    eq("model pinning", preferredModel("local"), "qwen3:4b");
  });
  eq("no override means the shipped default", getProvider("local").baseUrl, "http://127.0.0.1:11434/v1");
  eq("a junk context override is ignored", getProvider("local").maxContextTokens, 3500);
  eq("no pin means no pin", preferredModel("local"), null);
}

console.log("\n--- what one request is allowed to cost ---");
{
  /**
   * The bug this pins down: Groq's context window is 96,000 tokens and its
   * free tier allows 6,000 per MINUTE. Trimming history to the window sent
   * sixteen minutes of quota in a single question, and the agent loop makes
   * up to five requests per turn. Nothing errored locally — the rate limit
   * simply arrived, over and over, and looked like Groq being stingy.
   */
  const groq = getProvider("groq");
  eq("groq caps a request far below its context window", groq.maxRequestTokens! < groq.maxContextTokens, true);

  // Input and output both count toward a per-minute limit, so what matters is
  // the two together fitting inside it with room for a second tool round.
  const worstCase = groq.maxRequestTokens! + groq.maxOutputTokens;
  console.log(`     groq: ${groq.maxRequestTokens} in + ${groq.maxOutputTokens} out = ${worstCase} per request`);
  eq("a full request and reply fit inside 6,000 tokens/min", worstCase <= 6000, true);

  // Cerebras is limited by its 8K window, not by a per-minute squeeze.
  const cerebras = getProvider("cerebras");
  eq("cerebras stays inside its 8K free-tier window", cerebras.maxRequestTokens! + cerebras.maxOutputTokens <= 8192, true);

  eq("the local server gets a budget too", getProvider("local").maxRequestTokens! > 0, true);

  // The point of adding Gemini: 250,000 tokens/min against Groq's 6,000.
  const gemini = getProvider("gemini");
  eq("gemini's request budget dwarfs groq's", gemini.maxRequestTokens! > groq.maxRequestTokens! * 5, true);
  eq("and still sits inside 250K/min at 10 req/min", gemini.maxRequestTokens! + gemini.maxOutputTokens <= 25_000, true);

  // Every slot must declare one, or it silently inherits a context window as
  // its per-request budget, which is the bug this whole field exists for.
  for (const id of PROVIDER_IDS) {
    const p = getProvider(id);
    eq(`${id} caps its requests`, (p.maxRequestTokens ?? 0) > 0 && p.maxRequestTokens! <= p.maxContextTokens, true);
  }

  eq("the retired GitHub Models slot is gone", PROVIDER_IDS.includes("github"), false);

  withEnv({ JARVIS_GROQ_REQUEST_TOKENS: "1200" }, () => {
    eq("and the budget is tunable per provider", getProvider("groq").maxRequestTokens, 1200);
  });
}

console.log("\n--- a URL typed into Settings ---");
{
  eq("a plain host and port", sanitizeEndpoint("http://192.168.1.50:11434/v1"), "http://192.168.1.50:11434/v1");
  eq("trailing slashes trimmed", sanitizeEndpoint("https://api.example.com/v1///"), "https://api.example.com/v1");
  eq("whitespace trimmed", sanitizeEndpoint("  https://api.example.com/v1  "), "https://api.example.com/v1");
  eq("empty is nothing", sanitizeEndpoint(""), null);
  eq("undefined is nothing", sanitizeEndpoint(undefined), null);
  eq("not a URL at all", sanitizeEndpoint("not a url"), null);
  eq("a bare hostname is not a URL", sanitizeEndpoint("192.168.1.50:11434"), null);

  // Anything but http(s) reaching a server-side fetch is probing, not config.
  eq("file:// is refused", sanitizeEndpoint("file:///etc/passwd"), null);
  eq("data: is refused", sanitizeEndpoint("data:text/plain,hi"), null);

  // Browsers hide these; fetch still sends them.
  eq("a credential smuggled into the URL is refused", sanitizeEndpoint("http://user:pass@example.com/v1"), null);
  eq("a username alone is refused", sanitizeEndpoint("http://admin@example.com/v1"), null);
}

console.log("\n--- who is allowed to move an endpoint ---");
{
  withEnv({ JARVIS_LOCAL_BASE_URL: undefined }, () => {
    const moved = resolveEndpoint("local", "http://10.0.0.9:8000/v1");
    eq("the self-hosted slot follows Settings", moved.baseUrl, "http://10.0.0.9:8000/v1");
    eq("and knows the browser chose it", moved.fromClient, true);

    /**
     * The one that matters. If a browser could repoint the Groq slot, anyone
     * with a session could aim it at a server they control and read the
     * operator's API key straight out of the Authorization header.
     */
    const groq = resolveEndpoint("groq", "http://evil.example.com/v1");
    eq("a keyed cloud slot cannot be repointed from the browser", groq.baseUrl, "https://api.groq.com/openai/v1");
    eq("and does not report a client origin", groq.fromClient, false);
  });

  withEnv({ JARVIS_LOCAL_BASE_URL: "http://pinned.local:11434/v1" }, () => {
    const pinned = resolveEndpoint("local", "http://10.0.0.9:8000/v1");
    eq("an operator-pinned URL outranks Settings", pinned.baseUrl, "http://pinned.local:11434/v1");
    eq("and is reported as locked", pinned.locked, true);
  });
}

console.log("\n--- keys never follow a browser-chosen URL ---");
{
  withEnv({ JARVIS_LOCAL_API_KEY: "server-secret" }, () => {
    // Same slot, same server-side key, two different origins for the URL.
    eq("an operator URL uses the operator's key", resolveKey("local", undefined, false), "server-secret");
    eq("a browser URL never sees it", resolveKey("local", undefined, true), null);
    eq("only the key typed alongside it is sent", resolveKey("local", "typed-in-settings", true), "typed-in-settings");
  });
}

console.log("\n--- resizing a slot you pointed somewhere ---");
{
  withEnv({ JARVIS_LOCAL_CONTEXT: undefined, JARVIS_LOCAL_MAX_TOKENS: undefined }, () => {
    eq("defaults suit a local CPU", getProvider("local").maxContextTokens, 3500);

    // The reason this exists: paste a hosted endpoint into that URL box and
    // 3,500 tokens is an arbitrary handicap it never asked for.
    const bigger = getProvider("local", null, { context: 32_000, maxOutput: 4096 });
    eq("a bigger context can be asked for", bigger.maxContextTokens, 32_000);
    eq("and a longer reply", bigger.maxOutputTokens, 4096);

    // Raising the context alone would do nothing: the smaller of the two
    // always binds, so the request budget has to move with it.
    eq("the request budget follows the context", bigger.maxRequestTokens! > 3000, true);
    eq("but still sits under it", bigger.maxRequestTokens! <= bigger.maxContextTokens, true);

    // It is a text box.
    eq("nonsense is ignored", getProvider("local", null, { context: NaN }).maxContextTokens, 3500);
    eq("a negative is ignored", getProvider("local", null, { context: -5 }).maxContextTokens, 3500);
    eq("a silly number is clamped", getProvider("local", null, { context: 99_999_999 }).maxContextTokens, 200_000);

    /**
     * The same rule as the URL: only a slot the browser may repoint may be
     * resized by it. Otherwise anyone with a session could quietly raise
     * Groq's request budget past its rate limit and bring back the 429s this
     * whole budget system was added to stop.
     */
    eq("a cloud slot ignores a browser budget", getProvider("groq", null, { context: 96_000 }).maxContextTokens, 96_000);
    eq("and keeps its own request cap", getProvider("groq", null, { context: 96_000 }).maxRequestTokens, 3500);
  });

  withEnv({ JARVIS_LOCAL_CONTEXT: "8000" }, () => {
    eq("the environment still outranks the browser", getProvider("local", null, { context: 32_000 }).maxContextTokens, 8000);
  });
}

/** A mock OpenAI server that authenticates nobody, like Ollama. */
const KEYLESS_PORT = 8901;
const keyless = spawn(process.execPath, ["test/mock-provider.mjs"], {
  env: { ...process.env, MOCK_PORT: String(KEYLESS_PORT), MOCK_NO_AUTH: "1" },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 400));

console.log("\n--- talking to a keyless server ---");
try {
  process.env.JARVIS_LOCAL_BASE_URL = `http://127.0.0.1:${KEYLESS_PORT}/v1`;

  // The mock 400s if an Authorization header shows up at all, so these two
  // assertions are what prove the header is genuinely omitted rather than
  // sent empty and ignored.
  const models = await listModels("local", "");
  eq("lists models with no key", models.length > 0, true);
  eq("and still filters out non-chat models", models.some((m) => /whisper/.test(m.id)), false);

  const stream = await streamChat("local", "", {
    model: "mock-fast-8b",
    messages: [{ role: "user", content: "hello" }],
  });

  let text = "";
  for await (const payload of readSSE(stream)) {
    if (payload === "[DONE]") break;
    text += extractChunk(payload).content;
  }
  eq("streams a completion with no key", text.length > 0, true);
} finally {
  keyless.kill();
  delete process.env.JARVIS_LOCAL_BASE_URL;
}

console.log("\n--- a provider that says 400 when it means 'bad key' ---");
{
  /**
   * Gemini does not answer 401. Both of these are recorded verbatim from the
   * live endpoint: no credential gives 404, a malformed one gives 400.
   *
   * Unrecognised, they land in the generic non-retryable branch — so a single
   * mistyped Gemini key would stop the fallback chain dead and no other
   * provider would get a turn.
   */
  const cases = [
    { status: 404, body: { error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } } },
    { status: 400, body: { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } } },
  ];

  for (const { status, body } of cases) {
    const server = http.createServer((_req, res) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((r) => server.listen(8904, "127.0.0.1", r));

    try {
      process.env.JARVIS_LOCAL_BASE_URL = "http://127.0.0.1:8904/v1";
      let err: unknown;
      await listModels("local", "bad-key").catch((e) => {
        err = e;
      });

      eq(`a ${status} about a key reads as a key problem`, /rejected the API key/.test((err as Error).message), true);
      eq(`and a ${status} keeps the fallback chain moving`, (err as ProviderError).retryable, true);
    } finally {
      server.close();
      delete process.env.JARVIS_LOCAL_BASE_URL;
    }
  }

  // The distinction has to survive: a real bad request is not a key problem.
  const server = http.createServer((_req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Unsupported value for 'temperature'." } }));
  });
  await new Promise<void>((r) => server.listen(8905, "127.0.0.1", r));
  try {
    process.env.JARVIS_LOCAL_BASE_URL = "http://127.0.0.1:8905/v1";
    let err: unknown;
    await listModels("local", "fine").catch((e) => {
      err = e;
    });
    eq("a genuine bad request is not mistaken for a bad key", /rejected the API key/.test((err as Error).message), false);
    eq("and still does not retry forever", (err as ProviderError).retryable, false);
  } finally {
    server.close();
    delete process.env.JARVIS_LOCAL_BASE_URL;
  }
}

console.log("\n--- the budget reaches the wire ---");
{
  /**
   * Asserting the resolved config is not the same as asserting the request.
   * This captures what actually left the process, because a budget that is
   * computed correctly and then not sent is exactly as useless as no budget.
   */
  let seen: { max_tokens?: number; messages?: { content: string }[] } | null = null;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url?.endsWith("/chat/completions")) seen = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(8906, "127.0.0.1", r));

  try {
    process.env.JARVIS_LOCAL_BASE_URL = "http://127.0.0.1:8906/v1";
    // Long enough that a 3,500-token budget would have to cut it.
    const long = "word ".repeat(12_000);

    await streamChat("local", "", {
      model: "m",
      messages: [{ role: "user", content: long }],
    });
    const atDefault = seen!;

    await streamChat("local", "", {
      model: "m",
      messages: [{ role: "user", content: long }],
      budget: { context: 40_000, maxOutput: 4096 },
    });
    const resized = seen!;

    eq("the default reply cap is sent", atDefault.max_tokens, 1024);
    eq("a raised reply cap is sent", resized.max_tokens, 4096);

    const sentAtDefault = atDefault.messages![0].content.length;
    const sentResized = resized.messages![0].content.length;
    console.log(`     prompt sent: ${sentAtDefault} chars default, ${sentResized} resized`);
    eq("the default budget truncates a long prompt", sentAtDefault < long.length, true);
    eq("and a raised context lets more of it through", sentResized > sentAtDefault, true);
  } finally {
    server.close();
    delete process.env.JARVIS_LOCAL_BASE_URL;
  }
}

console.log("\n--- when the server isn't there ---");
{
  // Nothing listening: the connection is refused immediately.
  process.env.JARVIS_LOCAL_BASE_URL = "http://127.0.0.1:8902/v1";
  let refused: unknown;
  await listModels("local", "").catch((err) => {
    refused = err;
  });
  eq("a refused connection is a ProviderError", ProviderError.is(refused), true);
  eq("which names the address", /8902/.test((refused as Error).message), true);
  eq("and rolls over rather than failing the turn", (refused as ProviderError).retryable, true);

  /**
   * A host that accepts the connection and then says nothing.
   *
   * This is the case that matters for a PC on your LAN behind a firewall that
   * DROPs: without a deadline the TCP connect hangs for over two minutes, and
   * JARVIS would appear frozen rather than falling back.
   */
  const blackhole = http.createServer(() => {
    /* deliberately never responds */
  });
  await new Promise<void>((r) => blackhole.listen(8903, "127.0.0.1", r));

  try {
    process.env.JARVIS_LOCAL_BASE_URL = "http://127.0.0.1:8903/v1";
    const started = Date.now();
    let timedOut: unknown;
    await listModels("local", "").catch((err) => {
      timedOut = err;
    });
    const elapsed = Date.now() - started;

    eq("a silent host times out", ProviderError.is(timedOut), true);
    eq("inside the probe deadline", elapsed < 6000, true);
    eq("and says it didn't respond", /did not respond/.test((timedOut as Error).message), true);
    console.log(`     gave up after ${elapsed}ms`);
  } finally {
    blackhole.close();
    delete process.env.JARVIS_LOCAL_BASE_URL;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
