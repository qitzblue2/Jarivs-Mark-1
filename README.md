# JARVIS Mark 1

A self-hosted AI workspace that runs on **free, fast inference**. Chat list on
the left, conversation in the middle, live code canvas on the right.

- **Free to run.** No credit card, no trial clock, no hosting bill.
- **Fast.** Groq and Cerebras are the two quickest inference providers going.
- **Provider-agnostic.** Groq, Cerebras and GitHub Models ship in the box;
  adding another is one entry in a config object.
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

## 4. Where your data lives

Chats are JSON files in `./data/chats/`, one per conversation. `data/` is
gitignored. Back them up by copying the folder; delete one to delete the chat.

## 5. Deploying

It runs on Vercel's free tier as-is, with one caveat: **serverless filesystems
are read-only**, so the file store can't persist there. The app detects this
and falls back to in-memory storage, meaning chats vanish when the instance
recycles. For a real deployment, add a cloud driver — `lib/storage/types.ts`
is a four-method interface and `fs-store.ts` is the reference implementation.

Set your keys as environment variables in the host's dashboard, not in a file.

## 6. Layout

```
app/
  api/chat/         streaming proxy — SSE, provider fallback, persona injection
  api/models/       live model lists per provider
  api/chats/        chat CRUD
lib/
  providers/        registry + one OpenAI-compatible adapter for all of them
  storage/          ChatStore interface, filesystem and memory drivers
  codeblocks.ts     fenced blocks -> canvas artifacts -> preview documents
  tokens.ts         context-window trimming
components/         Workspace (state) + Sidebar / ChatPane / CodeCanvas
```

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
