# JARVIS Mark 2

A self-hosted AI workspace that runs on **free, fast inference**. Chat list on
the left, conversation in the middle, live code canvas on the right — and it
can now use tools mid-answer instead of only talking.

- **Free to run.** No credit card, no trial clock, no hosting bill.
- **Fast.** Groq and Cerebras are the two quickest inference providers going.
- **Provider-agnostic.** Groq, Cerebras and GitHub Models ship in the box;
  adding another is one entry in a config object.
- **Tool-using.** Calls tools mid-answer and shows you exactly what it ran.
- **Yours.** Chats are plain JSON files on your disk. Nothing to sign into.

---

## 1. Get a free API key (about 60 seconds)

You need at least one. Getting two means the app can roll over to the second
when the first hits a free-tier rate limit — it does that automatically.

### Groq — recommended default
1. Go to **https://console.groq.com/keys**
2. Sign in with an email or Google account. **No credit card.**
3. **Create API Key**, copy it.

Free tier: ~30 requests/min, 14,400/day, large context. Very fast.

### Cerebras — the speed record holder
1. Go to **https://cloud.cerebras.ai**
2. Sign up with an email. **No credit card.**
3. **API Keys → Create**, copy it.

Free tier: 1,000,000 tokens/day, resets 00:00 UTC. Fastest tokens/sec of any
provider, but free-tier context is capped at 8K — the app trims long chats
automatically so you never hit an error for it.

### GitHub Models — the no-18+ option
Every provider above requires you to be 18 in their terms of service, as do
OpenRouter and Google AI Studio. GitHub accounts are open to ages 13+, so
GitHub Models is the one mainstream free option that isn't 18+.

1. Go to **https://github.com/settings/personal-access-tokens**
2. **Generate new token** → fine-grained → enable the **Models** permission.
3. Copy the token.

Free tier: ~10 requests/min, 8K in / 4K out. Slower, but genuinely free and
tied to an account you probably already have.

> **On privacy:** free tiers are generally funded by your prompts being used
> for training. Don't put anything sensitive through them.

## 2. Run it

```bash
npm install
cp .env.example .env.local     # then paste your key(s) into .env.local
npm run dev
```

Open **http://localhost:3000**.

No `.env.local`? You can also paste a key into **Settings → API keys** and it
will be kept in your browser instead. Handy for a deployed copy, but a key in
a browser is visible to anything running in that browser — prefer `.env.local`
on your own machine.

## 3. Using it

| Action | How |
|---|---|
| New chat | `Ctrl/Cmd + K`, or the **New chat** button |
| Send | `Enter` (`Shift+Enter` for a newline) |
| Stop generating | The stop button in the composer |
| Rename a chat | Double-click it in the sidebar |
| Open code in the canvas | Automatic, or the **Canvas** button on any code block |
| Close the canvas | `Esc` |
| Resize the canvas | Drag its left edge |
| Switch model | The model pill in the header |

The **code canvas** takes any code JARVIS writes, gives it a tab, and lets you
edit it. HTML, CSS, JS and SVG run live in a sandboxed iframe next to the
editor; everything else gets syntax highlighting, copy and download.

Model lists are fetched live from each provider, so a deprecated model never
leaves you stuck (Groq retired its Llama 3.x IDs in June 2026 — a hardcoded
list would have broken silently).

## 4. Tools

JARVIS can call tools while answering, rather than guessing. Every call is
shown in an expandable trace under the reply — the tool name, the exact
arguments, the raw result and how long it took. Nothing runs invisibly.

Shipped so far:

| Tool | What it does |
|---|---|
| `web_search` | Searches the web for current information |
| `fetch_url` | Reads a page in full, as text |
| `calculate` | Arithmetic, via a real parser |
| `get_time` | The current date, which a model cannot know on its own |

### Search backends

Tried best-first, so search works with **no configuration at all** and gets
better if you add a key:

| Backend | Setup | Notes |
|---|---|---|
| **Tavily** | `TAVILY_API_KEY` — 1,000/mo free, no card | Best quality: returns extracted content, not raw links |
| **SearXNG** | `SEARXNG_URL` — no key | Private, self-hostable. See the caveat below. |
| **DuckDuckGo** | Nothing | Works immediately. Unofficial scrape, so it can break. |

> **SearXNG caveat:** most *public* instances disable the JSON API, so you will
> usually get a 403 unless you run your own:
> `docker run -d -p 8080:8080 searxng/searxng`, then enable `json` under
> `search.formats` in its `settings.yml`.

How the loop works: the model may request tools, they run **server-side**,
their results go back into the conversation, and the model answers with them.
That repeats up to **5 rounds**, then tools are withheld so it has to conclude.

Two things worth knowing:
- **Each round is another API request.** A 3-round answer costs 3 requests
  against your free-tier limit. The cap exists so a loop cannot drain a quota.
- **Not every free model supports tools.** If one rejects them, the answer is
  automatically retried without tools and the UI tells you.

Turn the whole thing off in **Settings → Tool use**.

Adding a tool is one file in `lib/tools/` plus a line in its registry — the
same pattern as adding a model provider.

### Why the network tools are locked down

`fetch_url` lets a *language model* choose a URL that *your server* then
requests — with your API keys sitting in the same environment. Unguarded, that
is a confused-deputy hole: `http://169.254.169.254/` would hand over cloud
credentials, and `http://localhost:3000/api/chats` would read your own private
conversations back to the model.

So `lib/tools/net-guard.ts` resolves DNS and rejects loopback, private ranges,
link-local (which is where cloud metadata lives), CGNAT and multicast; allows
only http and https; follows redirects **manually, re-checking every hop**
(a public host answering `302 Location: http://169.254.169.254/` is the
standard bypass); and caps body size, timeout and redirect count.

`calculate` gets the same treatment for the same reason: it uses a hand-written
shunting-yard parser, never `eval`, because the expression comes from a model.

## 5. Where your data lives

Chats are JSON files in `./data/chats/`, one per conversation. `data/` is
gitignored. Back them up by copying the folder; delete one to delete the chat.

## 6. Deploying

It runs on Vercel's free tier as-is, with one caveat: **serverless filesystems
are read-only**, so the file store can't persist there. The app detects this
and falls back to in-memory storage, meaning chats vanish when the instance
recycles. For a real deployment, add a cloud driver — `lib/storage/types.ts`
is a four-method interface and `fs-store.ts` is the reference implementation.

Set your keys as environment variables in the host's dashboard, not in a file.

## 7. Layout

```
app/
  api/chat/         streaming proxy — SSE, provider fallback, persona injection
  api/models/       live model lists per provider
  api/chats/        chat CRUD
lib/
  agent.ts          the tool loop — call, run tools, feed back, repeat
  providers/        registry + one OpenAI-compatible adapter for all of them
  tools/            tool definitions, registry and runner
  storage/          ChatStore interface, filesystem and memory drivers
  codeblocks.ts     fenced blocks -> canvas artifacts -> preview documents
  tokens.ts         context-window trimming
components/         Workspace (state) + Sidebar / ChatPane / CodeCanvas
test/               mock provider, unit tests, browser e2e
```

## Testing

```bash
npm test            # unit tests — parsing, trimming, tool calls, calculator
./test/start-mock.sh                       # fake provider on :8899
GROQ_API_KEY=test JARVIS_GROQ_BASE_URL=http://localhost:8899/v1 npm run dev
npm run test:e2e    # drives a real browser against the mock
```

The mock streams tool calls the way real providers do — `arguments` split
mid-JSON across chunks — so the reassembly logic is genuinely exercised
without spending any free-tier quota.

### Adding a provider

Add an entry to `PROVIDERS` in `lib/providers/registry.ts` with its base URL,
env var name and free-tier context limit. If it speaks the OpenAI wire format
(most do), that's the whole job.

You can also repoint an existing slot at a local model — handy for Ollama or
LM Studio, which need no key at all:

```bash
JARVIS_GROQ_BASE_URL=http://localhost:11434/v1
```

## Security notes

- Server-side keys never reach the browser; the client only learns *whether* a
  key exists.
- The preview iframe runs with `allow-scripts` but deliberately **without**
  `allow-same-origin`, so model-written code gets an opaque origin and cannot
  touch this app's DOM, storage, or API routes. Don't add that flag.
- Chat ids are validated against a strict pattern before touching the filesystem.

## License

GPL-3.0
