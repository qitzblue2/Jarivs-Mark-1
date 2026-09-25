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
