"""
NanoGPT — the brain, when this copy of Mark LIV runs without Google.

NOT PART OF UPSTREAM MARK LIV. Added in the Jarivs-Mark-1 import so the
assistant can run on a NanoGPT subscription instead of the Gemini Live API.
See NOTICE.md for everything that differs from FatihMakes' original.

WHICH URL, AND WHY IT MATTERS
    NanoGPT serves the same OpenAI-compatible API at two paths:

        https://nano-gpt.com/api/v1               billed per token, from credit
        https://nano-gpt.com/api/subscription/v1  covered by the subscription

    Same models, same requests. Pointing at the first one quietly charges for a
    plan that is already paid for, so the subscription path is the default and
    the model list comes from it too — anything offered is already included.

WHAT IT IS USED FOR
    Two callers, both of which used to talk to Gemini:
      * core/local_live.py — the conversation itself (streaming, with tools)
      * core/gemini.py     — the one-shot side calls actions make

CONFIG  (config/api_keys.json — gitignored; see .gitignore and NOTICE.md)
    "engine":             "nanogpt"        selects this module
    "nanogpt_api_key":    "..."            required
    "nanogpt_model":      "..."            optional — picked from your plan if unset
    "nanogpt_model_fast": "..."            optional — for quick side calls
    "nanogpt_model_vision": "..."          optional — for screenshots and the camera
    "nanogpt_base_url":   "..."            optional — only to point elsewhere
"""
from __future__ import annotations

import base64
import json
import re
import sys
import threading
from pathlib import Path
from typing import Any, Iterator

import requests

if getattr(sys, "frozen", False):
    _BASE = Path(sys.executable).parent
else:
    _BASE = Path(__file__).resolve().parent.parent

CONFIG_PATH = _BASE / "config" / "api_keys.json"

BASE_URL = "https://nano-gpt.com/api/subscription/v1"

# Which model to use when the config doesn't name one, matched as substrings
# against the live list from YOUR plan rather than written in as exact ids.
# Exact ids go stale — providers rename and retire them — and a hardcoded one
# that has vanished fails every request, whereas a family match keeps finding
# the current member. Order is preference: these are strong at tool calling,
# which is what lets JARVIS actually open apps rather than describe doing so.
_PREFERRED_FAMILIES = ("kimi-k2", "glm-4", "deepseek-v3", "qwen3-235b", "qwen3")

# For a turn that carries an image. The strongest tool-callers above are mostly
# text-only — Kimi K2 cannot see — so screen reading, which Mark LIV does a lot
# of, needs a model of its own or every screenshot is a 400.
_VISION_FAMILIES = ("qwen3-vl", "qwen2.5-vl", "-vl", "vision", "gemma-3", "llama-4", "pixtral")

# Reasoning models narrate their working-out before answering. In a voice
# assistant that is seconds of silence followed by a lecture, so they are
# skipped when choosing automatically. (Name one explicitly and it is used.)
_SLOW_FOR_VOICE = re.compile(r"thinking|reason|(^|[-/])r1([-/]|$)|-r1\b", re.I)


class NanoGPTError(RuntimeError):
    """A NanoGPT failure, worded for the person reading the log."""


# ── Configuration ────────────────────────────────────────────────────────────

def settings() -> dict:
    """The NanoGPT settings from config/api_keys.json. Never raises."""
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        data = {}
    return {
        "engine": str(data.get("engine") or "gemini").strip().lower(),
        "key": str(data.get("nanogpt_api_key") or "").strip(),
        "model": str(data.get("nanogpt_model") or "").strip(),
        "model_fast": str(data.get("nanogpt_model_fast") or "").strip(),
        "model_vision": str(data.get("nanogpt_model_vision") or "").strip(),
        "base_url": str(data.get("nanogpt_base_url") or BASE_URL).strip().rstrip("/"),
    }


def enabled() -> bool:
    """True when this install should think with NanoGPT instead of Gemini."""
    s = settings()
    return s["engine"] == "nanogpt" and bool(s["key"])


# ── Gemini schema → OpenAI tools ────────────────────────────────────────────

# Gemini writes schema types in capitals; JSON Schema — which NanoGPT, like
# every OpenAI-compatible server, expects — writes them in lower case. Keys
# Gemini understands and JSON Schema does not are dropped rather than passed
# through, because a strict server rejects the whole request over one of them.
_SCHEMA_KEYS = {"type", "description", "properties", "required", "items",
                "enum", "format", "minimum", "maximum", "minItems", "maxItems",
                "default"}


def to_json_schema(schema: Any) -> dict:
    """A Gemini-dialect schema (dict or SDK object) as plain JSON Schema."""
    if schema is None:
        return {"type": "object", "properties": {}}
    if hasattr(schema, "model_dump"):
        schema = schema.model_dump(mode="json", exclude_none=True)
    if not isinstance(schema, dict):
        return {}

    out: dict = {}
    for key, value in schema.items():
        if key not in _SCHEMA_KEYS:
            continue
        if key == "type":
            name = str(getattr(value, "value", value)).lower()
            if name and name != "type_unspecified":
                out["type"] = name
        elif key == "properties" and isinstance(value, dict):
            out["properties"] = {k: to_json_schema(v) for k, v in value.items()}
        elif key == "items":
            out["items"] = to_json_schema(value)
        else:
            out[key] = value

    # An object with no properties must still say so, or some servers reject
    # the tool as malformed. Upstream has several zero-argument tools.
    if out.get("type") == "object":
        out.setdefault("properties", {})
    return out


def to_tools(declarations) -> list[dict]:
    """Gemini function declarations → OpenAI `tools`. Accepts dicts or SDK objects."""
    tools = []
    for decl in declarations or []:
        if hasattr(decl, "model_dump"):
            decl = decl.model_dump(mode="json", exclude_none=True)
        if not isinstance(decl, dict) or not decl.get("name"):
            continue
        tools.append({
            "type": "function",
            "function": {
                "name": decl["name"],
                "description": decl.get("description", ""),
                "parameters": to_json_schema(decl.get("parameters")),
            },
        })
    return tools


# ── Message content ──────────────────────────────────────────────────────────

def to_content(parts: list) -> str | list:
    """Gemini-style parts → OpenAI message content.

    Text-only content goes as a plain string, which every server accepts.
    Images become data-URI `image_url` parts — they only work with a vision
    model, so a text model receiving one fails honestly rather than guessing.
    Anything else inline (a PDF, audio) is not something a chat endpoint takes,
    so it is replaced with a note saying it was left out.
    """
    texts: list[str] = []
    rich: list[dict] = []
    has_image = False

    for part in parts or []:
        if isinstance(part, str):
            part = {"text": part}
        elif hasattr(part, "model_dump"):
            part = part.model_dump(mode="json", exclude_none=True)
        if not isinstance(part, dict):
            continue

        if part.get("text"):
            texts.append(part["text"])
            rich.append({"type": "text", "text": part["text"]})
            continue

        blob = part.get("inline_data")
        if isinstance(blob, dict):
            mime = blob.get("mime_type") or "application/octet-stream"
            data = blob.get("data") or ""
            if isinstance(data, (bytes, bytearray)):
                data = base64.b64encode(data).decode("ascii")
            if mime.startswith("image/"):
                has_image = True
                rich.append({"type": "image_url",
                             "image_url": {"url": f"data:{mime};base64,{data}"}})
            else:
                note = f"[An attachment of type {mime} was left out: this model reads text and images only.]"
                texts.append(note)
                rich.append({"type": "text", "text": note})

    return rich if has_image else "\n".join(texts)


# ── Model choice ─────────────────────────────────────────────────────────────

_model_lock = threading.Lock()
_resolved: dict[str, str] = {}


def list_models(timeout: float = 15.0) -> list[str]:
    """Model ids your plan covers, from the subscription endpoint."""
    s = settings()
    try:
        res = requests.get(f"{s['base_url']}/models", headers=_headers(s["key"]), timeout=timeout)
    except requests.RequestException as e:
        raise NanoGPTError(f"couldn't reach NanoGPT to list models: {e}") from e
    _raise_for(res)
    rows = (res.json() or {}).get("data") or []
    return [r["id"] for r in rows if isinstance(r, dict) and r.get("id")]


def choose_model(available: list[str], vision: bool = False) -> str | None:
    """Best available model for a voice assistant, by family preference."""
    usable = [m for m in available if not _SLOW_FOR_VOICE.search(m)]
    for family in (_VISION_FAMILIES if vision else _PREFERRED_FAMILIES):
        for model in usable:
            if family in model.lower():
                return model
    if vision:
        return None
    return usable[0] if usable else (available[0] if available else None)


def model(fast: bool = False, vision: bool = False) -> str:
    """The model to use — from config if named, otherwise chosen once from the plan.

    May make a network request the first time. Call it off the event loop:
    main.py runs audio playback on that loop, and a blocking call there is
    audible.
    """
    s = settings()
    if vision and s["model_vision"]:
        return s["model_vision"]
    named = s["model_fast"] if fast and s["model_fast"] else s["model"]
    if named and not vision:
        return named

    slot = "vision" if vision else "auto"
    with _model_lock:
        if slot not in _resolved:
            available = list_models()
            picked = choose_model(available, vision=vision)
            if not picked and vision:
                # No vision model in the plan: fall back to the main one, which
                # will say it can't see rather than the turn vanishing. Chosen
                # from the list already in hand — calling model() again from
                # inside this lock would deadlock, and did.
                print("[NanoGPT] No vision model found in your plan — set "
                      "\"nanogpt_model_vision\" to one that can read images.")
                picked = named or _resolved.get("auto") or choose_model(available)
            if not picked:
                raise NanoGPTError(
                    "your NanoGPT plan listed no models. Set \"nanogpt_model\" "
                    "in config/api_keys.json to one it includes."
                )
            # Said out loud in the log, so an automatic choice is never a mystery
            # and can be pinned in config if it isn't the one you wanted.
            key = "nanogpt_model_vision" if vision else "nanogpt_model"
            print(f"[NanoGPT] Using {picked}{' for images' if vision else ''} — set "
                  f"\"{key}\" in config/api_keys.json to choose another.")
            _resolved[slot] = picked
        return _resolved[slot]


# ── HTTP ─────────────────────────────────────────────────────────────────────

def _headers(key: str) -> dict:
    if not key:
        raise NanoGPTError("no NanoGPT key — add \"nanogpt_api_key\" to config/api_keys.json")
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _raise_for(res: requests.Response) -> None:
    if res.ok:
        return
    try:
        detail = res.json().get("error") or res.text
        if isinstance(detail, dict):
            detail = detail.get("message") or json.dumps(detail)
    except Exception:
        detail = res.text
    detail = str(detail)[:200]

    if res.status_code in (401, 403):
        raise NanoGPTError(f"NanoGPT refused the key ({res.status_code}): {detail}")
    if res.status_code == 429:
        # The subscription allows 60 requests a minute. A long tool-using turn
        # is several requests, so this is reachable, and worth naming.
        raise NanoGPTError("NanoGPT rate limit reached (60 requests/minute) — try again shortly")
    if res.status_code in (402, 404):
        raise NanoGPTError(
            f"NanoGPT rejected the model ({res.status_code}): {detail}. It may not be in "
            "your subscription — pick one from the subscription model list."
        )
    raise NanoGPTError(f"NanoGPT error {res.status_code}: {detail}")


def _payload(messages, tools, model_id, temperature, stream, json_mode) -> dict:
    body: dict = {"model": model_id, "messages": messages, "stream": stream}
    if tools:
        body["tools"] = tools
    if temperature is not None:
        body["temperature"] = temperature
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    return body


def chat(messages: list, tools: list | None = None, model_id: str | None = None,
         temperature: float | None = None, timeout: float = 60.0,
         json_mode: bool = False) -> dict:
    """One completion, whole. Returns {"text": str, "tool_calls": [...]}.

    Built on `stream()` rather than a second, non-streaming request path: one
    way over the wire means one set of parsing, one set of thinking-block
    handling, and nothing that breaks against a server that streams whether or
    not it was asked to.
    """
    text, calls = [], []
    for kind, value in stream(messages, tools=tools, model_id=model_id,
                              temperature=temperature, timeout=timeout, json_mode=json_mode):
        if kind == "text":
            text.append(value)
        elif kind == "tool_calls":
            calls = value
    return {"text": "".join(text).strip(), "tool_calls": calls}


def stream(messages: list, tools: list | None = None, model_id: str | None = None,
           temperature: float | None = None, timeout: float = 90.0,
           stop: threading.Event | None = None,
           json_mode: bool = False) -> Iterator[tuple[str, Any]]:
    """Stream a completion.

    Yields ("text", delta) as words arrive, then ("tool_calls", [...]) if the
    model asked for any, then ("done", finish_reason). Setting `stop` ends the
    stream early and closes the connection — that is how an interrupted reply
    stops costing requests.
    """
    s = settings()
    body = _payload(messages, tools, model_id or model(), temperature, True, json_mode)
    try:
        res = requests.post(f"{s['base_url']}/chat/completions", headers=_headers(s["key"]),
                            json=body, timeout=timeout, stream=True)
    except requests.RequestException as e:
        raise NanoGPTError(f"couldn't reach NanoGPT: {e}") from e
    _raise_for(res)

    calls: dict[int, dict] = {}
    finish = None
    thinking = _ThinkFilter()
    try:
        for raw in res.iter_lines(decode_unicode=True):
            if stop is not None and stop.is_set():
                finish = "cancelled"
                break
            if not raw or not raw.startswith("data:"):
                continue
            payload = raw[5:].strip()
            if payload == "[DONE]":
                break
            try:
                chunk = json.loads(payload)
            except ValueError:
                continue
            choice = (chunk.get("choices") or [{}])[0]
            delta = choice.get("delta") or {}

            text = thinking.feed(delta.get("content") or "")
            if text:
                yield ("text", text)

            # Tool calls arrive in fragments keyed by index: the name once, the
            # arguments a few characters at a time. Assembled here, so callers
            # only ever see whole calls.
            for frag in delta.get("tool_calls") or []:
                slot = calls.setdefault(frag.get("index", 0), {"id": "", "name": "", "arguments": ""})
                if frag.get("id"):
                    slot["id"] = frag["id"]
                fn = frag.get("function") or {}
                if fn.get("name"):
                    slot["name"] += fn["name"]
                if fn.get("arguments"):
                    slot["arguments"] += fn["arguments"]

            finish = choice.get("finish_reason") or finish
    finally:
        res.close()

    tail = thinking.flush()
    if tail:
        yield ("text", tail)
    if calls:
        yield ("tool_calls", [calls[i] for i in sorted(calls)])
    yield ("done", finish)


# ── Thinking blocks ──────────────────────────────────────────────────────────

_THINK_BLOCK = re.compile(r"<(think|thinking|reasoning)>.*?</\1>\s*", re.S | re.I)


def strip_thinking(text: str) -> str:
    """Remove a model's inline working-out. It must never be read aloud."""
    text = _THINK_BLOCK.sub("", text)
    # An unterminated block is still working-out, not an answer.
    text = re.split(r"<(?:think|thinking|reasoning)>", text, flags=re.I)[0]
    return text.strip()


class _ThinkFilter:
    """Drops <think>…</think> from a stream whose tags may arrive split across
    chunks. Speech starts on the first complete sentence, so the filtering has
    to happen as it streams — cleaning the finished reply would be too late."""

    _OPEN = re.compile(r"<(think|thinking|reasoning)>", re.I)

    def __init__(self):
        self._buf = ""
        self._inside: str | None = None

    def feed(self, text: str) -> str:
        self._buf += text
        out = []
        while self._buf:
            if self._inside:
                end = self._buf.lower().find(f"</{self._inside}>")
                if end == -1:
                    # Keep only enough to catch a closing tag split in two.
                    self._buf = self._buf[-(len(self._inside) + 3):]
                    return "".join(out)
                self._buf = self._buf[end + len(self._inside) + 3:].lstrip()
                self._inside = None
                continue
            match = self._OPEN.search(self._buf)
            if match:
                out.append(self._buf[:match.start()])
                self._inside = match.group(1).lower()
                self._buf = self._buf[match.end():]
                continue
            # Hold back a trailing "<…" that might be the start of a tag.
            cut = self._buf.rfind("<")
            if cut != -1 and len(self._buf) - cut < 12:
                out.append(self._buf[:cut])
                self._buf = self._buf[cut:]
            else:
                out.append(self._buf)
                self._buf = ""
            break
        return "".join(out)

    def flush(self) -> str:
        rest = "" if self._inside else self._buf
        self._buf = ""
        return rest


# ── The one-shot path, for core/gemini.py ────────────────────────────────────

class Reply:
    """Shaped like the Gemini response's `.text`, so existing call sites work."""

    __slots__ = ("text",)

    def __init__(self, text: str):
        self.text = text


def one_shot(parts: list, system: str = "", fast: bool = True,
             timeout_s: float = 30.0, json_mode: bool = False,
             temperature: float | None = None) -> Reply | None:
    """One request, one answer — what core/gemini.call() needs. None on failure,
    which is what gemini.call() already returns when nothing answered."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    content = to_content(parts)
    messages.append({"role": "user", "content": content})
    try:
        # Screenshots are most of what the side calls send: they need a model
        # that can actually see them.
        sees = isinstance(content, list) and any(p.get("type") == "image_url" for p in content)
        result = chat(messages, model_id=model(fast=fast and not sees, vision=sees), timeout=timeout_s,
                      json_mode=json_mode, temperature=temperature)
    except NanoGPTError as e:
        print(f"[NanoGPT] {e}")
        return None
    return Reply(result["text"]) if result["text"] else None
