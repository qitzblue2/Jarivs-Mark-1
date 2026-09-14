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
  defaultProviderId,
  fallbackOrder,
  getProvider,
  preferredModel,
  providerReady,
  requiresKey,
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

const CLOUD_KEYS = { GROQ_API_KEY: "k", CEREBRAS_API_KEY: "k", GITHUB_MODELS_TOKEN: undefined };

console.log("\n--- who is usable ---");
{
  withEnv({ GROQ_API_KEY: undefined, CEREBRAS_API_KEY: undefined, GITHUB_MODELS_TOKEN: undefined }, () => {
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
    eq("github is dropped with no token", fallbackOrder("groq").includes("github"), false);
  });

  withEnv({ GROQ_API_KEY: undefined, CEREBRAS_API_KEY: undefined, GITHUB_MODELS_TOKEN: undefined }, () => {
    // Before this change, no keys meant no providers at all and a 401.
    eq("with no keys at all, local alone still answers", fallbackOrder("groq"), ["local"]);
  });
}

console.log("\n--- defaults ---");
{
  withEnv({ ...CLOUD_KEYS, JARVIS_DEFAULT_PROVIDER: undefined }, () => {
    eq("a keyed provider is preferred over the slow local one", defaultProviderId(), "groq");
  });
  withEnv({ GROQ_API_KEY: undefined, CEREBRAS_API_KEY: undefined, GITHUB_MODELS_TOKEN: undefined, JARVIS_DEFAULT_PROVIDER: undefined }, () => {
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

  withEnv({ JARVIS_GROQ_REQUEST_TOKENS: "1200" }, () => {
    eq("and the budget is tunable per provider", getProvider("groq").maxRequestTokens, 1200);
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
