# NOTICE

## Where this came from

This folder is **MARK LIV — JARVIS** by **FatihMakes**, the project shown in
*"Jarvis Mark 54 — Step by Step Guide"*.

- Source: <https://github.com/FatihMakes/Mark-LIV>
- Imported at commit `476a9c09d64423e97b08958c4088fde29a1b1713`
  (2026-09-16), unmodified, in its own commit — so everything listed below is
  a plain diff against the original.
- Copyright © 2026 FatihMakes.

## Licence

**Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)**
— the full text is in [`LICENSE`](LICENSE) and at
<https://creativecommons.org/licenses/by-nc/4.0/legalcode>.

In short: you may use, share and adapt this code, **but not commercially**, and
the credit above has to stay. That licence covers this folder only. It is kept
in its own root, with its own `LICENSE`, so its terms stay attached to this code
and do not reach the rest of the repository.

## What was changed

CC BY-NC asks that modifications be indicated. These are all of them.

### `.gitignore` — secrets were not being ignored

Upstream writes `pattern   # explanation` on one line. Git only treats `#` as a
comment at the **start** of a line, so each of those lines became a single
pattern that matched nothing. Tested with `git check-ignore` on the original:

| Path | Upstream | Here |
|---|---|---|
| `config/api_keys.json` | **committed** | ignored |
| `config/certs/` (dashboard TLS private key) | **committed** | ignored |
| `config/whatsapp_web/` (a linked WhatsApp session) | **committed** | ignored |
| `**/client_secret*.json` (Google OAuth) | **committed** | ignored |

Each comment now sits on its own line above its pattern. No pattern was added
or removed apart from `.pytest_cache/`.

> This affects every copy of Mark LIV, not just this one. It is worth
> reporting to FatihMakes.

### A NanoGPT engine, with local hearing and speech

An install can now think with a **NanoGPT subscription** instead of Gemini.
faster-whisper hears you and Kokoro speaks, both running locally. Gemini Live
remains available and is still what an existing config runs: nothing changes
unless `config/api_keys.json` says `"engine": "nanogpt"`. How to use it is in
[`readme.md`](readme.md#-running-on-nanogpt).

**New files.** None of these are part of upstream Mark LIV.

| File | What it is |
|---|---|
| `core/nanogpt.py` | NanoGPT client: streaming, tool calls, images, Gemini schema → JSON Schema, model choice |
| `core/local_live.py` | `LocalLiveSession`, a stand-in for the Gemini Live session with the same four methods `main.py` calls, built on faster-whisper, NanoGPT and Kokoro |
| `tests/` | pytest suite for the above, run against the parent repo's `test/mock-provider.mjs` |

**Changed files.** In each code file, the main change is also marked in place
with a comment that mentions the Jarivs-Mark-1 import.

| File | Change |
|---|---|
| `main.py` | The Live connect goes through a new `_open_session()`, which opens a `LocalLiveSession` when NanoGPT is configured and otherwise opens Gemini exactly as before. `interrupt()` also cancels a local reply that is still being generated. `_get_api_key()` no longer raises when there is no Gemini key. |
| `core/gemini.py` | `call()` routes to NanoGPT when that engine is configured, which covers every one-shot caller. The `SEARCH` tier returns `None` on NanoGPT, so callers use their existing DuckDuckGo fallback. |
| `actions/computer_control.py` | `screen_find` accepts a NanoGPT key as well as a Gemini one. |
| `ui.py` | The first-run screen chooses between NanoGPT and Gemini Live and asks for that engine's key. The first-run check accepts either engine. Saving setup now merges into `config/api_keys.json` instead of overwriting it, so re-running setup no longer erases the name, colour, devices or the other engine's key. The setup panel is 60 px taller to fit the choice. |
| `requirements.txt` | Adds `faster-whisper` and `kokoro`. |
| `setup.py` | The closing instructions name both engines. |
| `readme.md` | A pointer at the top, a *Running on NanoGPT* section, and matching lines under Requirements and Your Data. |

`core/stt.py` and `core/tts.py` shipped upstream but nothing used them. They
are now used as they are, unmodified.
