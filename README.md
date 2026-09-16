# JARVIS Mark 5

A self-hosted AI workspace that runs on **free, fast inference**. Chat list on
the left, conversation in the middle, live code canvas on the right — and it
can now use tools mid-answer instead of only talking.

- **Free to run.** No credit card, no trial clock, no hosting bill.
- **Fast.** Groq and Cerebras are the two quickest inference providers going.
- **Provider-agnostic.** Groq, Gemini, Cerebras, Mistral, OpenRouter, NanoGPT,
  Featherless, Arli and Awan ship in the box, plus a slot for any
  OpenAI-compatible URL of your own; adding another is one entry in a config
  object.
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

### Gemini — the most headroom by far

1. Go to **https://aistudio.google.com/apikey**
2. **Create API key.** No credit card.

Free tier: **250,000 tokens per minute**, 250 requests/day, 1M context. Groq
allows 6,000 tokens a minute, so this is roughly forty times the room — if you
keep running out mid-conversation, this is the fix.

> Google's free tier may use your conversations to improve its products, and
> JARVIS remembers things about you. Worth deciding deliberately.

### NanoGPT — the cheapest way off the free tiers

**$8/month**, and the one to reach for first if the free tiers keep running
out. It is cheaper than Arli below and carries far more: **200+ open models** —
every DeepSeek, Qwen and Kimi K2 release, plus uncensored and roleplay
fine-tunes — and **100 images a day** on top.

1. Go to **https://nano-gpt.com/**, take the subscription, create a key.
2. Put it in `.env.local` as `NANOGPT_API_KEY`.

Its limits are **60 requests a minute** and **60 million input tokens a week**.
Both are about how *often* you ask. That is the distinction that matters:
Groq's 6,000 tokens a minute is spent by how *long* you have been talking, so
it tightens as a conversation grows and fails you mid-thought. You cannot
speak sixty times a minute, and at JARVIS' default budget the weekly cap is
around 500 tool-using turns. If you somehow meet it, set
`JARVIS_NANOGPT_REQUEST_TOKENS=12000` rather than paying for more.

> JARVIS points this slot at `/api/subscription/v1`, not `/api/v1`. The second
> one bills per token against deposited credit — same models, same API, but
> you would be paying twice.

### Featherless — when you want all 22,000

**$25/month** for the entire Hugging Face open-weight catalogue behind one
key: roughly 22,000 models, no size cap, 32K context, four concurrent. Also
unlimited tokens and requests.

Worth it for one reason only — the breadth. If NanoGPT already serves what you
want, this is three times the price for models you will not use.

1. Go to **https://featherless.ai/** and take the **$25 Chat** plan.

> The **$50 "Developer"** plan is not a bigger version of this. It is $50 of
> credits billed per token — the metered arrangement these slots exist to
> escape. Several comparison sites also still list a $10 tier; it is gone.

The picker lists 400 models, not 22,000 — past a few hundred rows it stops
being something you can read. For anything else, type its full id into the
picker's filter box and choose **"use it anyway"**.

### Arli AI — the one that never runs out

Not free, but the answer to "everything keeps hitting a limit".

1. Go to **https://www.arliai.com/**, pick a plan, create a key.

**$10/month buys unlimited tokens and unlimited requests** on models up to
31B at 16K context. $15 raises that to 355B and 32K — set
`JARVIS_ARLI_CONTEXT=32000` if you take that tier.

All four paid slots sit **behind every free tier** and ahead of your own
hardware. Among themselves the order is not by price — Awan is the cheapest
and comes last, because its models are two years old and poor at tool
calling, which is the thing JARVIS actually needs. That is deliberate: the free providers are faster and cost nothing,
so they should answer normal use, and the providers that never rate-limit are
what should catch whatever they cannot. You reach the thing you pay for only
at the moment you would otherwise have been stuck.

> Flat-rate "unlimited" plans are sold on the bet that most subscribers
> under-use, and the big sellers have been drifting back toward metering.
> Treat it as a good introductory price rather than a permanent arrangement —
> which is the argument for leaving a free key configured behind it.

### Awan LLM

The cheapest of the four at about $5/month, also unlimited tokens — but see
the catalogue warning below before choosing it over NanoGPT for $3 more.

Its **limits are not the constraint** people expect: daily caps run 30,000 to
80,000 requests, against maybe 200 a day for heavy use. You will not meet
them. That is a different shape of limit from Groq's 6,000 tokens a minute,
which is spent by how *long* you have been talking rather than how often you
ask — which is why Groq tightens as a conversation grows and this doesn't.

**The catalogue is what to weigh.** Llama 3.1 8B and 70B Instruct, Llama 3,
and Awan's own 8B fine-tunes — 2024-era models. That matters for one reason:
tool calling is what drives the projector, and Llama 3.1 8B is weak at it
while 70B is acceptable. Use the picker's **"Can this model use tools?"**
before relying on one, or the display will quietly never respond.

### Mistral

1. Go to **https://console.mistral.ai/api-keys**
2. Create a key. No credit card.

Free tier: roughly a billion tokens a month. Mistral no longer publishes exact
rate limits, so JARVIS ships a conservative per-request budget for it.

### On being under 18

GitHub Models used to be the one mainstream free option open to 13+, which is
why it was here. **GitHub retired it entirely on 30 July 2026** — API,
catalog and all — so that option is gone rather than deprecated.

Every remaining hosted provider above requires 18 in its terms of service.
The path that has no age gate at all is running the model yourself: see
[Running your own model](#running-your-own-model) below. It is slower, it is
free forever, and nobody's terms apply to a machine you own.

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

<a id="running-your-own-model"></a>
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

Then point JARVIS at it. Either **Settings → API keys → Self-hosted**, which
takes any OpenAI-compatible URL and has a Test button that tells you
immediately whether the machine is reachable — or, to pin it so the browser
cannot change it:

```bash
JARVIS_LOCAL_BASE_URL=http://192.168.1.50:11434/v1
JARVIS_LOCAL_MODEL=qwen3:4b
```

The key field beside it is optional: a server on your own network
authenticates nobody, while a host you rent usually issues a key.

Two rules govern that field, both enforced server-side:

- **Only this slot can be repointed from the browser.** The cloud providers
  cannot, or anyone with a session could aim the Groq slot at a server they
  control and read the key out of the forwarded request.
- **A browser-chosen URL never receives the server's key** — only a key typed
  alongside it. Same reason.

`JARVIS_LOCAL_BASE_URL` always outranks the Settings field, so on a JARVIS
exposed through a tunnel the endpoint can be nailed down.

**Context and Max reply** sit beside the URL for the same reason. They default
to 3,500 and 1,024 — sized for a Raspberry Pi — and a hosted endpoint pasted
into that box deserves to be told it can use more.

#### Serving a specific model from Hugging Face

Ollama only serves what it has packaged. To run an arbitrary repo — a
community fine-tune, say — use **vLLM**, which exposes an OpenAI-compatible
server of its own, so JARVIS needs nothing beyond the URL:

```bash
pip install vllm
vllm serve <org>/<model> --host 0.0.0.0 --port 8000 --max-model-len 8192
```

That serves at `http://<host>:8000/v1`, which goes straight into the
Self-hosted field. Raise Context and Max reply to match `--max-model-len`.

If the repo ships **GGUF** files instead, Ollama can take it directly and you
skip vLLM:

```bash
ollama pull hf.co/<org>/<model>:<quant-tag>
```

**Check it fits before you start.** vLLM wants the weights in VRAM: roughly
2 GB per billion parameters at fp16, or half that at Q4/AWQ. A 27B model is
~17 GB quantised, so it needs a 24 GB card — a rented RTX 3090 or 4090, not
anything with 16 GB of system RAM and an old GPU. The sizing table under
[Running your own model](#running-your-own-model) is the one that decides
this, and it does not care how good the model is.

#### Letting the machine sleep

A desktop running all night to answer the occasional question is a waste. Put
its MAC address in the field under the URL and JARVIS sends a Wake-on-LAN
packet when it finds the machine asleep.

It never makes you wait. If anything else can answer — a cloud key, any
provider — the packet goes out and your question is answered immediately by
something that is already awake; the server is up by the time you ask again.
Only when the self-hosted slot is your *sole* provider does it pause, and then
for 25 seconds, which covers a resume from sleep but not a cold boot. If it
isn't up by then it says so rather than hanging.

**Wake-on-LAN must be enabled in two places on the server**, and neither is on
by default:

```bash
# Linux — and make it stick across reboots via systemd or NetworkManager
sudo ethtool -s eth0 wol g
ethtool eth0 | grep Wake-on        # should show "Wake-on: g"

# Windows — Device Manager → adapter → Power Management →
# "Allow this device to wake the computer"
powercfg /devicequery wake_armed
```

...plus the BIOS/UEFI setting, usually called **Wake on PCI-E**, **Power On by
PCI-E** or **Resume by LAN** depending on the vendor.

**It has to be wired.** Wake-on-WLAN exists on paper but needs adapter and
driver support most desktops do not have, so the server wants an Ethernet
cable to the router.

The **Test** button in Settings sends a packet when the URL is unreachable and
a MAC is set — which is the quickest way to find out whether all of the above
is configured. It reports that the packet *left*, not that the machine woke:
Wake-on-LAN has no acknowledgement, because a sleeping machine cannot reply.

#### A specific model that only one provider serves

Community fine-tunes usually are not on the big per-token hosts, but they are
often reachable through **Hugging Face Inference Providers**, which routes to
whoever does serve them behind one OpenAI-compatible URL:

```
URL:   https://router.huggingface.co/v1
Key:   your Hugging Face token
Model: <org>/<model>:<provider>        e.g. …:featherless-ai
```

The `:provider` suffix is required — it tells the router where to send the
request. `:cheapest` picks the lowest price per output token instead.

**Featherless AI** can also be used directly at `https://api.featherless.ai/v1`.
It bills a flat monthly subscription with unlimited tokens rather than per
token, which is the shape you want if you keep meeting rate limits.

**Thinking models** — Qwen3, DeepSeek-R1 distills, GLM — open a `<think>`
block by default, and some providers pass it through inline. JARVIS folds that
into a collapsed "Thought for N words" section and never reads it aloud, so
they work in voice mode without narrating their own working-out.

#### Other endpoints worth putting in that field

**Cloudflare Workers AI** — 10,000 neurons/day free, ~80 models, no card. Its
URL embeds your account id, which is why it is a recipe rather than a
built-in slot:

```
https://api.cloudflare.com/client/v4/accounts/<account_id>/ai/v1
```

with an API token from **AI → Workers AI → Use REST API**.

**DeepInfra** — not free, but `$0.06/M` tokens for an 8B means €20 lasts a
very long time, with no idle cost and no rate limit worth planning around:

```
https://api.deepinfra.com/v1/openai
```

Raise Context and Max reply when you use either; the defaults assume a Pi.

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

## Will this model actually work?

Open the model picker and hit **"Can this model use tools?"**. It sends one
request that can only be answered by calling a tool, and reports whether the
model did, plus how fast it replied.

That question is the one that matters, because tool calling is what moves the
projector, searches the web and stores a memory. Everything else degrades
gracefully; tool calling either happens or JARVIS silently does nothing and
looks broken.

Nothing else catches the important failure. A model that *rejects* the `tools`
parameter is detected and retried without them. A model that **accepts it and
then never calls one** — the usual behaviour of a roleplay-tuned fine-tune —
passes every check there is and just ignores your projector. Check before you
rely on it, especially with a small model or an unusual fine-tune.

## Images

Drop an image into the chat and JARVIS sends it to the model — if that model
can see. Vision is per **model**, not per provider, so it is matched against
the live model id: anything named `-VL`, `vision`, `llava`, `pixtral`,
`internvl`, `minicpm-v`, `moondream`, `scout` or `maverick`, plus every Gemini
model, which are all multimodal.

When the chosen model can't see, the image isn't dropped — it arrives as
`[Attached image: photo.jpg]`, so the model knows one was sent and can say it
can't see it rather than answering as though nothing was attached.

The matching is deliberately narrow, because the two mistakes are not equal:
claiming vision a model lacks **fails the request outright**, while claiming
none still gets you an answer. If a model you know sees isn't being given the
image, its name is the thing to check.

## The room display

JARVIS can put things on a screen — an answer easier to read than to hear,
code it just wrote, an image — and with a projector on HDMI it can switch the
projector itself on and off.

The display is just a browser page. On the Pi:

```bash
chromium --kiosk http://localhost:3000/display
```

It holds one SSE connection and renders whatever arrives; when there is
nothing, it shows a clock rather than black, because a black rectangle looks
exactly like a broken display and someone will go and check the cable.

For projector power:

```bash
sudo apt install cec-utils
```

**Then turn HDMI-CEC on in the projector's own menu.** It is off by default on
most of them and is the single most likely reason power control appears
broken. Manufacturers each brand it differently — Anynet+, Bravia Sync,
SimpLink, Viera Link — but it is all CEC. Without it JARVIS falls back to
blanking the signal with `wlr-randr` or `vcgencmd`, which leaves the projector
itself running.

Three tools come with it: `show_on_display`, `clear_display` and
`display_power`. They are registered only when a screen might exist — device
mode, or a display currently connected — because their schemas cost 287
tokens on every request and a laptop with no projector should not pay that.

Two rules apply to everything that reaches the wall, since the content is
model-authored and the display is a browser in your room:

- **Markdown is escaped, never rendered as HTML.** A `<script>` tag from a
  model arrives as text.
- **Images must be on this server or a `data:` URI.** An arbitrary URL would
  make the wall display fetch anywhere, and unlike a tool fetch there is no
  `net-guard` on the page to stop it.

`display_power` spawns a process, so the model chooses `on` or `off` and the
command is built from that boolean here — no model-supplied string ever
reaches a shell, which is why it needs no approval gate.

## Security notes

- Server-side keys never reach the browser; the client only learns *whether* a
  key exists.
- The preview iframe runs with `allow-scripts` but deliberately **without**
  `allow-same-origin`, so model-written code gets an opaque origin and cannot
  touch this app's DOM, storage, or API routes. Don't add that flag.
- Chat ids are validated against a strict pattern before touching the filesystem.

## License

GPL-3.0
