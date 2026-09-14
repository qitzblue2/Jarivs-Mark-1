# JARVIS Mark 5

A self-hosted AI workspace that runs on **free, fast inference**. Chat list on
the left, conversation in the middle, live code canvas on the right — and it
can now use tools mid-answer instead of only talking.

- **Free to run.** No credit card, no trial clock, no hosting bill.
- **Fast.** Groq and Cerebras are the two quickest inference providers going.
- **Provider-agnostic.** Groq, Cerebras and GitHub Models ship in the box;
  adding another is one entry in a config object.
- **Tool-using.** Calls tools mid-answer and shows you exactly what it ran.
- **Voice.** Say "Hey JARVIS" and talk to it. Wake word runs on your machine.
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
| `remember` / `recall` / `forget` | Durable memory across conversations |
| `list_files` / `read_file` / `write_file` | Files in the workspace — writes need your approval |
| `run_command` | Shell commands in the workspace — needs your approval |

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

## 5. Memory

JARVIS keeps facts between conversations — your name, your preferences, what
you're working on. It decides what's worth storing, and you can see and edit
all of it in **Settings → Memory**.

Everything lives in `data/memory.json`, one readable file. Memory you can't
inspect is memory you can't trust, so hand-editing and deleting are
first-class rather than hidden.

Relevant entries are injected into the system prompt each turn, scored by
keyword overlap and recency inside a token budget. Tag an entry `always` and
it's present in every conversation regardless of topic — that's how something
like your name stays available. No embeddings: for a few hundred personal
facts, keyword matching is accurate enough, costs nothing, and you can see
exactly why something was recalled.

## 6. Attachments

Drag a file onto the composer, paste a screenshot, or use the clip button.

| Type | What happens |
|---|---|
| **Images** | Sent to a vision model. Groq's is `qwen/qwen3.6-27b`. |
| **PDFs** | Text extracted server-side via `unpdf`. Scans need OCR and will say so. |
| **Text & code** | Read inline, truncated to fit the context window. |

Two limits worth knowing, both from Groq's free tier: **max 3 images per
message**, and **1,000 vision requests/day** — the tightest quota in the app.
Attaching an image while on a non-vision model doesn't fail; the image is
described in text instead, and you're offered a one-click switch.

Images are dropped from a conversation after the turn they arrive in. Keeping
base64 payloads in every subsequent request would exhaust both the context
window and that daily quota.

## 7. Voice

Press the waveform button (or **Ctrl/Cmd+J**), say **"Hey JARVIS"**, and it
answers *"Hey sir, how can I help you today?"* — then listens for your question,
answers it out loud, and shows the full reply on screen.

The mic button next to it skips the wake word and just records, for when you
don't feel like talking to your computer in front of people.

### The voice

**Kokoro** is the default — an 82M-parameter Apache-2.0 model that runs
entirely in your browser, on WebGPU where available. It sounds close to a
cloud service and costs nothing, forever: open weights, no account, no key,
nothing that phones home, and it keeps working offline.

The trade is a one-time model download, cached by the browser afterwards. Pick
the size in **Settings → Voice**:

| Quality | Download | Notes |
|---|---|---|
| Compact | ~50MB | Fastest to get going, slightly rougher |
| **Balanced** (default) | ~86MB | Recommended |
| Best | ~326MB | Only worth it if the smaller builds disappoint |

Bigger is not automatically faster. If your GPU offloads part of the model to
the CPU — ONNX Runtime says so in the console when it happens — the smaller
build can be quicker in practice.

Eleven voices, American and British, plus a speaking-rate slider (Kokoro's own
default pace is unhurried; 1.1× sounds more like conversation). There's a Test
button for both.

If the model fails to load, speech falls back to the browser voice and tells
you why — losing the nicer voice is annoying, losing voice entirely is broken.

### It speaks while it thinks

Replies are spoken sentence by sentence as they are generated, so JARVIS
starts talking about a second in rather than after the whole answer is
written. Each sentence is generated **while the previous one is still
playing**, so there's no synthesis pause between them — without that overlap
every sentence carries its own generation delay, and a long reply crawls.

Voice mode shows time-to-first-audio and per-sentence synthesis time, so if it
ever does feel slow you can see where the time is going.

That also fixed a real bug: **long replies used to go unspoken entirely.**
Three things caused it — the text was clipped at 1,200 characters, a watchdog
gave up after 60 seconds, and Chrome silently drops oversized utterances. All
three are gone now that speech is chunked per sentence, and there's a
regression test asserting a 40-sentence reply is spoken in full.

### It knows when you've stopped talking

Turn-taking uses **Silero VAD**, a neural speech detector (MIT, ~2MB, local),
rather than a loudness threshold. A threshold can't tell a voice from a fan,
so a noisy room kept it listening and a pause mid-sentence read as "done".

It also means **barge-in only triggers on actual speech** — talk over JARVIS
and it stops immediately, but a door slam no longer interrupts it.

### The pipeline

```
mic → local ONNX wake word → greeting → Silero VAD hears you finish
    → Groq Whisper → the normal chat path → reply streams
    → spoken sentence by sentence as it arrives, locally by Kokoro
```

Spoken questions go through the *same* path as typed ones, so they save into
the same chats and can use tools — ask it to search the web out loud and it
will.

### Why the wake word runs locally

An always-on wake word means an always-on microphone. Chrome implements the
Web Speech API by **streaming your microphone to Google's servers**, so an
assistant built on it would upload your room continuously.

Instead the detection runs in your browser with openWakeWord's pretrained
`hey_jarvis` model (~200k training clips) on the ONNX runtime. Your audio
never leaves your machine until the wake word fires — only the question after
it is sent, and only to Groq for transcription.

It also dodges a compatibility trap: Web Speech *recognition* is disabled in
Firefox, but `speechSynthesis` is not. Doing detection with ONNX and
transcription with Whisper means voice works in Firefox too.

### What it costs

| Piece | Where it runs | Cost |
|---|---|---|
| Wake word | Your browser | Free, forever, offline |
| Speech to text | Groq Whisper | Free — 2,000/day |
| **Speech out (default)** | **Kokoro, your browser** | **Free forever, offline** |
| Speech out (instant) | Your browser | Free, no download, robotic |
| Speech out (optional) | Groq | Free tier |

### Controls

| | |
|---|---|
| Enter voice mode | `Ctrl/Cmd+J`, or the waveform button |
| End the conversation | Say "stop" or "goodbye", or press `Esc` |
| Interrupt it talking | Start talking, or press `Space` |
| Continuous vs single | Toggle at the top-left of voice mode |

Continuous keeps listening after each answer; single-question goes back to
waiting for the wake word. **Settings → Voice** changes the greeting, the
speech engine and voice, and the wake-word sensitivity — raise it if JARVIS
wakes up on its own, lower it if it does not hear you.

### When it can't hear you

Open voice mode and look at the two bars under the orb — they separate the two
possible faults in one glance:

| What you see | What it means |
|---|---|
| **Input bar flat while you talk** | Audio isn't reaching the page. Wrong input device, muted mic, or permission denied. |
| **Input bar moves, score stays 0.00** | The mic is fine; the wake word isn't matching your voice. Hit **Calibrate**. |
| **Neither bar, an error message** | It will name the cause — permission, no device, or an insecure page. |

**Calibrate** listens for six seconds while you say "Hey JARVIS", reports the
best score it saw, and sets the sensitivity just under it. That is almost
always the fix when the model can hear you but never triggers — the 0.5
default is strict for some voices and microphones.

Say it as **two clear words**, close to the mic. And if you just want to skip
the wake word entirely, the microphone button records immediately.

The readout also shows `N frames · N scored`. If `scored` lags far behind
`frames`, this machine can't run inference fast enough to keep up — audio is
still buffered continuously so detection keeps working, just less often.

### Using it from another device

`localhost` counts as a secure context, so the microphone works there with no
certificate. Any other address does not — browsers silently withhold mic
access over plain `http://`, which is why voice appears to do nothing when you
open the app by its IP.

```bash
npm run dev:https      # self-signed cert, good for this machine
```

For a phone or another computer, a self-signed certificate won't be trusted.
A free tunnel gives you a real HTTPS URL:

```bash
cloudflared tunnel --url http://localhost:3000
```

### First-run setup

Voice needs ~20MB of runtime assets (the ONNX runtime wasm, the wake-word
models and the speech detector). `npm install` fetches them automatically via
`scripts/setup-voice.mjs`. Kokoro's ~86MB of weights download separately on
first use and are cached by the browser.
If that was offline, run `npm run setup:voice`. They are deliberately not in
git. Everything except voice works without them.

## 8. Letting JARVIS use your computer

Off by default. Turn it on with `JARVIS_ALLOW_COMPUTER=1` — an environment
variable, not a setting, so nothing with a browser session can enable it.

When on, JARVIS can list, read and write files in `./workspace` and run
commands there. Three layers stand between the model and your machine:

**Containment.** Every path is resolved with `realpath` and re-checked for
containment *afterwards*. That catches `../` traversal and the subtler case a
string-prefix check misses: a symlink inside the workspace pointing out of it.
Tested against both, plus absolute paths, null bytes, and a sibling directory
sharing the root's name prefix.

**Approval.** Writes and commands don't execute. You get a card showing the
exact command or the full file content, and nothing happens until you approve.
No answer within five minutes counts as a denial — failing open would mean a
forgotten tab quietly approving things.

**A scrubbed environment.** Commands run with every API key removed. Without
that, `env` hands out your Groq, Cerebras and Tavily keys, which is worse than
anything it could do to a file. Verified: `env | grep -c API_KEY` returns 0.

Reads are unattended. A handful of catastrophic commands (`rm -rf /`, `mkfs`,
fork bombs) are refused outright even with approval.

## 9. Reaching it from your phone

`npm run dev` listens on **localhost only**. That is deliberate, and it is the
actual security boundary — `Host` and `X-Forwarded-For` are both set by the
client and pass straight through, so any "is this request local?" check built
on headers can be spoofed by anything on your network. Binding to loopback
can't be.

To reach JARVIS from elsewhere, tunnel it:

```bash
npm run dev                                    # terminal 1
cloudflared tunnel --url http://localhost:3000 # terminal 2
```

You get a real HTTPS URL, which also makes voice work — the microphone needs
a secure context, and `localhost` only counts as one on the machine itself.

A tunnel rewrites the Host header, so JARVIS then **requires
`JARVIS_PASSWORD`**. With none set it refuses to serve rather than defaulting
to open. If you deliberately widen the bind with `npm run dev:lan`, a password
is mandatory for every request, loopback-looking or not.

**Why not just deploy it?** Vercel's free tier kills a function after 10
seconds, and a five-round tool conversation blows straight past that. The
filesystem tools also only make sense on the machine that has your files. One
local instance behind a tunnel has no timeout, needs no cloud database, and
keeps your chats in the JSON files they already live in.

## 10. Where your data lives

Chats are JSON files in `./data/chats/`, one per conversation. `data/` is
gitignored. Back them up by copying the folder; delete one to delete the chat.

## 11. Deploying

It runs on Vercel's free tier as-is, with one caveat: **serverless filesystems
are read-only**, so the file store can't persist there. The app detects this
and falls back to in-memory storage, meaning chats vanish when the instance
recycles. For a real deployment, add a cloud driver — `lib/storage/types.ts`
is a four-method interface and `fs-store.ts` is the reference implementation.

Set your keys as environment variables in the host's dashboard, not in a file.

## 12. Layout

```
app/
  api/chat/         streaming proxy — SSE, provider fallback, persona injection
  api/models/       live model lists per provider
  api/chats/        chat CRUD
lib/
  agent.ts          the tool loop — call, run tools, feed back, repeat
  auth/             password session, signed cookie
  memory/           durable facts, relevance scoring, prompt injection
  tools/fs/         workspace containment, approval gate, file and shell tools
  voice/            wake word (local ONNX), speech to text, speech out
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
npm test                # unit + containment/auth suites
npm run test:providers  # keyless providers, fallback order, request budgets
npm run test:device     # on-device voice, against the real ONNX models

./test/start-mock.sh                       # fake provider on :8899
GROQ_API_KEY=test JARVIS_GROQ_BASE_URL=http://localhost:8899/v1 npm run dev
npm run test:e2e    # drives a real browser against the mock
npm run test:voice  # voice mode, with a WAV standing in for a microphone
```

`MOCK_NO_AUTH=1` makes the mock reject any request carrying an `Authorization`
header, standing in for a local Ollama — which is how the keyless path is
tested without a key existing anywhere.

The mock streams tool calls the way real providers do — `arguments` split
mid-JSON across chunks — so the reassembly logic is genuinely exercised
without spending any free-tier quota.

### Adding a provider

Add an entry to `PROVIDERS` in `lib/providers/registry.ts` with its base URL,
env var name and free-tier limits. If it speaks the OpenAI wire format (most
do), that's the whole job. Set `requiresKey: false` for a server that
authenticates nobody.

### Running your own model

Free tiers are fast but metered; your own hardware is slow but never runs out.
That makes a local model the right **backstop** rather than the right default,
which is how JARVIS treats it: the cloud answers first, and a rate limit rolls
over to `local` automatically instead of failing.

On the machine doing the work:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3:4b
OLLAMA_HOST=0.0.0.0 OLLAMA_KEEP_ALIVE=-1 ollama serve
```

`OLLAMA_HOST=0.0.0.0` lets another machine — a Pi running JARVIS — reach it.
`OLLAMA_KEEP_ALIVE=-1` stops the model being unloaded after five idle minutes,
which otherwise costs 10-20 seconds on the first question after a gap.

Then, in `.env.local`:

```bash
JARVIS_LOCAL_BASE_URL=http://192.168.1.50:11434/v1
JARVIS_LOCAL_MODEL=qwen3:4b
```

There is no API key, because there is nobody to authenticate.

**Sizing it.** Generation speed is bound by memory bandwidth, not cores: every
token reads the whole weight file out of RAM. So the useful number is
`bandwidth / model size`, and roughly 60% of theoretical is achievable.

A desktop with dual-channel DDR4 (~42 GB/s) runs a 3B at ~12 tok/s, a 4B at
~10, an 8B at ~5, and a 14B at ~3. Speech is about 4 tok/s, so **a 4B keeps
ahead of your own voice and an 8B roughly keeps pace** — that is the ceiling
for a voice assistant. A Raspberry Pi has around a quarter of that bandwidth
and is 20x slower again; the Pi should run the voice loop and let a real
machine run the model.

A discrete GPU only helps if the whole model fits in VRAM. Anything under 6 GB
holds nothing useful, and CUDA has dropped support for Maxwell-era cards, so an
old GPU is not worth wiring in — the CPU path is the one that works.

### Free-tier limits, and why requests are small

Providers publish two different numbers and it matters which one binds. Groq's
*context window* is 96K tokens, but its free tier allows 6,000 tokens a
**minute** — and the agent loop makes up to five requests per turn, each
re-sending the whole conversation plus the tool schemas.

So `maxRequestTokens` caps what a single request may cost, separately from
`maxContextTokens`. Trimming to the window instead would spend sixteen minutes
of quota on one question, which is what "Groq keeps running out" actually is.
Raise it with `JARVIS_GROQ_REQUEST_TOKENS` if your account has a higher limit;
the cost of a smaller budget is that JARVIS forgets earlier turns sooner.

## Security notes

- Server-side keys never reach the browser; the client only learns *whether* a
  key exists.
- The preview iframe runs with `allow-scripts` but deliberately **without**
  `allow-same-origin`, so model-written code gets an opaque origin and cannot
  touch this app's DOM, storage, or API routes. Don't add that flag.
- Chat ids are validated against a strict pattern before touching the filesystem.

## License

GPL-3.0
