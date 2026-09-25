"""
A stand-in for the Gemini Live session, built from local ears, a NanoGPT
brain and a local voice.

NOT PART OF UPSTREAM MARK LIV. Added in the Jarivs-Mark-1 import; see
NOTICE.md.

WHY A STAND-IN AND NOT A REWRITE
    main.py talks to its Live session through exactly four methods:

        send_realtime_input(audio=...)    microphone audio in
        send_client_content(turns=...)    text in — typed, plugins, briefings
        send_tool_response(...)           results of the tools it ran
        receive()                         everything coming back

    and reads six fields off what `receive()` yields. Implement those and the
    rest of main.py — HUD, holographic face, lip-sync, echo guard, wake word,
    tools, plugins, memory, briefings, proactive mode — runs unchanged, because
    none of it ever knew what was on the other end.

    The face is the part that makes this work at all. `_play_audio` draws the
    mouth shapes from the AUDIO, 24 kHz int16 mono, pulled off a queue. Kokoro
    produces exactly that, so speech made here moves the lips with no change to
    the avatar.

THE PIPELINE
    mic PCM (16 kHz) → Segmenter → Whisper → NanoGPT (streaming, tools)
                                               → each finished sentence → Kokoro
                                               → 24 kHz PCM back to main.py

    Speech starts on the first finished sentence, not when the reply is done.
"""
from __future__ import annotations

import asyncio
import json
import re
import threading
import time
from types import SimpleNamespace
from typing import Any, Callable

import numpy as np

from core import nanogpt

IN_RATE = 16_000        # what main.py records at (SEND_SAMPLE_RATE)
OUT_RATE = 24_000       # what main.py plays at (RECEIVE_SAMPLE_RATE), and Kokoro's own rate
_CHUNK_BYTES = 4_800    # 100 ms at 24 kHz / 16-bit: small enough that an
                        # interrupt cuts off within a tenth of a second

# Tool rounds per turn. Each round is a whole request, and the subscription
# allows 60 a minute; a model stuck asking for tools would otherwise spend them
# all on one question. On the last round tools are withheld so it must answer.
MAX_ROUNDS = 6

# Conversation kept per request. Trimmed at a user message, never between a
# tool call and its result — an orphaned tool result is a 400 on every server.
_HISTORY_TURNS = 20
_HISTORY_CHARS = 60_000


# ── What receive() yields ────────────────────────────────────────────────────
# Plain objects carrying exactly the attributes main.py's _receive_audio reads,
# so none of the Gemini types are needed on this path.

def _message(*, data: bytes | None = None, said: str | None = None,
             heard: str | None = None, done: bool = False,
             calls: list | None = None) -> SimpleNamespace:
    content = None
    if said is not None or heard is not None or done:
        content = SimpleNamespace(
            output_transcription=SimpleNamespace(text=said) if said else None,
            input_transcription=SimpleNamespace(text=heard) if heard else None,
            turn_complete=done,
        )
    return SimpleNamespace(
        data=data,
        server_content=content,
        tool_call=SimpleNamespace(function_calls=calls) if calls else None,
        session_resumption_update=None,
    )


def _is_turn_complete(msg) -> bool:
    return bool(msg.server_content and msg.server_content.turn_complete)


# ── Hearing: where does an utterance end? ────────────────────────────────────

class Segmenter:
    """Cuts a stream of 16 kHz int16 microphone audio into utterances.

    An energy gate against an adaptive noise floor, not a model: main.py
    already keeps JARVIS's own voice out of the stream (nothing is sent while
    it speaks, and the echo tail is filtered), so what is left only needs to be
    split at pauses, and Whisper's own voice-activity filter cleans each piece.

    Two ways an utterance ends. Quiet for `end_ms`, which is the ordinary case.
    Or the audio simply stops arriving — push-to-talk released, the assistant
    put to sleep — which no amount of listening for silence would notice;
    `flush()` handles that, called when nothing has arrived for a while.
    """

    FRAME = 320  # 20 ms at 16 kHz

    def __init__(self, end_ms: int = 700, min_speech_ms: int = 300,
                 max_ms: int = 30_000, pre_roll_ms: int = 300,
                 floor: float = 350.0):
        self._end = end_ms // 20
        self._min = min_speech_ms // 20
        self._max = max_ms // 20
        self._pre = pre_roll_ms // 20
        self._floor_min = floor
        self.reset()

    def reset(self) -> None:
        self._noise = self._floor_min
        self._pending = np.zeros(0, dtype=np.int16)
        self._pre_frames: list[np.ndarray] = []
        self._frames: list[np.ndarray] = []
        self._voiced = 0
        self._quiet = 0
        self._onset = 0
        self._active = False

    @property
    def active(self) -> bool:
        return self._active

    def feed(self, pcm: bytes) -> list[np.ndarray]:
        """Add audio; return any utterances it completed, as float32 in [-1, 1]."""
        samples = np.frombuffer(pcm, dtype=np.int16)
        self._pending = np.concatenate([self._pending, samples])
        done: list[np.ndarray] = []

        while len(self._pending) >= self.FRAME:
            frame = self._pending[: self.FRAME]
            self._pending = self._pending[self.FRAME:]
            finished = self._frame(frame)
            if finished is not None:
                done.append(finished)
        return done

    def flush(self) -> np.ndarray | None:
        """End the current utterance now, if it has enough speech to be one."""
        if not self._active:
            return None
        return self._finish()

    def _frame(self, frame: np.ndarray) -> np.ndarray | None:
        rms = float(np.sqrt(np.mean(frame.astype(np.float32) ** 2)))
        loud = rms > max(self._noise * 3.0, self._floor_min)

        if not self._active:
            # Track the room only while nobody is talking, or a long sentence
            # would teach the gate that speech is the background.
            if not loud:
                self._noise = 0.95 * self._noise + 0.05 * max(rms, 1.0)
            self._pre_frames.append(frame)
            self._pre_frames = self._pre_frames[-self._pre:]
            self._onset = self._onset + 1 if loud else 0
            # Three loud frames in a row — a keystroke or a cough is one or two.
            if self._onset >= 3:
                self._active = True
                self._frames = list(self._pre_frames)
                self._voiced = self._onset
                self._quiet = 0
            return None

        self._frames.append(frame)
        if loud:
            self._voiced += 1
            self._quiet = 0
        else:
            self._quiet += 1

        if self._quiet >= self._end or len(self._frames) >= self._max:
            return self._finish()
        return None

    def _finish(self) -> np.ndarray | None:
        audio = np.concatenate(self._frames) if self._frames else np.zeros(0, dtype=np.int16)
        long_enough = self._voiced >= self._min
        noise = self._noise
        self.reset()
        self._noise = noise
        if not long_enough:
            return None
        return (audio.astype(np.float32) / 32768.0).clip(-1.0, 1.0)


# ── Local ears and voice ─────────────────────────────────────────────────────

class WhisperEars:
    """faster-whisper, via the upstream core/stt.py that Mark LIV ships unused.

    Loaded on first use, not at startup: the model is a download the first
    time and a few seconds of loading after that, and the assistant should be
    on screen and answering typed questions while that happens.
    """

    def __init__(self, model_name: str = "base", language: str | None = None):
        self._model_name = model_name
        self._language = language or None
        self._stt = None
        self._lock = threading.Lock()

    def transcribe(self, audio: np.ndarray) -> str:
        with self._lock:
            if self._stt is None:
                from core.stt import WhisperSTT
                self._stt = WhisperSTT(model_name=self._model_name, language=self._language)
        return self._stt.transcribe(audio)


class KokoroVoice:
    """Kokoro, via the upstream core/tts.py — synthesis only.

    Upstream's `speak()` plays straight to the speakers. Here the audio has to
    go to main.py instead, because that is where the lip-sync reads it, so
    this drives the same loaded pipeline and returns the samples.
    """

    def __init__(self, voice: str = "bm_george", speed: float = 1.05):
        self._voice = voice
        self._speed = speed
        self._engine = None
        self._lock = threading.Lock()

    def synthesize(self, text: str) -> bytes:
        """24 kHz int16 mono PCM for `text`."""
        from core.tts import KokoroTTSEngine, _compress_silence, _to_numpy

        with self._lock:
            if self._engine is None:
                self._engine = KokoroTTSEngine(voice=self._voice, speed=self._speed)
            pipeline = getattr(self._engine, "_pipeline", None)
            if pipeline is None:
                raise RuntimeError("Kokoro loaded without a pipeline — core/tts.py may have changed")

            pieces = []
            for _, _, audio in pipeline(text, voice=self._voice, speed=self._speed):
                if audio is not None:
                    arr = _compress_silence(_to_numpy(audio))
                    if arr.size:
                        pieces.append(arr)
        if not pieces:
            return b""
        samples = np.concatenate(pieces).astype(np.float32)
        return (samples.clip(-1.0, 1.0) * 32767.0).astype(np.int16).tobytes()


# ── Text for speaking ────────────────────────────────────────────────────────

_SENTENCE_END = re.compile(r"(?<=[.!?…])[\"')\]]*\s+|\n{2,}")


def split_sentences(buffer: str, min_chars: int = 24) -> tuple[list[str], str]:
    """Complete sentences out of a streaming buffer, plus what is left over.

    Short sentences are joined to the next ("Sure." on its own is a Kokoro call
    for half a second of audio). A long run with no full stop is broken at a
    comma so speech doesn't wait for the end of a paragraph.
    """
    out: list[str] = []
    start = 0
    carry = ""
    for match in _SENTENCE_END.finditer(buffer):
        piece = carry + buffer[start:match.end()]
        start = match.end()
        if len(piece.strip()) < min_chars:
            carry = piece
            continue
        out.append(piece.strip())
        carry = ""
    rest = carry + buffer[start:]
    if len(rest) > 220:
        cut = rest.rfind(", ", 0, 200)
        if cut > 40:
            out.append(rest[: cut + 1].strip())
            rest = rest[cut + 2:]
    return out, rest


_FENCE = re.compile(r"```.*?```", re.S)
_URL = re.compile(r"https?://\S+")
_MARKS = re.compile(r"[*_#`>|~]+")


def speakable(text: str) -> str:
    """What Kokoro should actually say. Markdown symbols are read aloud as
    words otherwise, and nobody wants a URL spelled out in a room."""
    text = _FENCE.sub(" I've put the code on screen. ", text)
    text = _URL.sub("the link", text)
    text = _MARKS.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


# ── The session ──────────────────────────────────────────────────────────────

def _config_parts(config) -> tuple[str, list]:
    """The system prompt and tool declarations out of main.py's LiveConnectConfig.
    Read from the config main.py already builds, so the prompt, the memory and
    the tool list have one source of truth rather than a copy here."""
    if hasattr(config, "model_dump"):
        config = config.model_dump(mode="json", exclude_none=True)
    config = config or {}

    system = config.get("system_instruction") or ""
    if isinstance(system, dict):
        system = "\n".join(p.get("text", "") for p in system.get("parts") or [] if isinstance(p, dict))

    declarations = []
    for tool in config.get("tools") or []:
        if isinstance(tool, dict):
            declarations.extend(tool.get("function_declarations") or [])
    return str(system), declarations


def _has_image(content) -> bool:
    return isinstance(content, list) and any(p.get("type") == "image_url" for p in content)


class LocalLiveSession:
    """See the module docstring. Used as `async with LocalLiveSession(cfg) as s`,
    exactly where main.py used `client.aio.live.connect(...)`."""

    def __init__(self, config, *, ears=None, voice=None,
                 brain: Callable[..., Any] | None = None,
                 pick_model: Callable[..., str] | None = None,
                 idle_flush_s: float = 0.6):
        self._system, declarations = _config_parts(config)
        self._tools = nanogpt.to_tools(declarations)
        s = _local_settings()
        self._ears = ears or WhisperEars(s["whisper_model"], s["whisper_language"])
        self._voice = voice or KokoroVoice(s["voice"], s["voice_speed"])
        self._brain = brain or nanogpt.stream
        self._pick_model = pick_model or nanogpt.model
        self._idle_flush_s = idle_flush_s

        self._history: list[dict] = []
        self._segmenter = Segmenter()
        self._last_audio = 0.0

        self._loop: asyncio.AbstractEventLoop | None = None
        self._out: asyncio.Queue | None = None
        self._inbox: asyncio.Queue | None = None
        self._tasks: list[asyncio.Task] = []
        self._current: asyncio.Task | None = None
        self._tool_future: asyncio.Future | None = None
        self._stop: threading.Event | None = None

    # ── lifecycle ────────────────────────────────────────────────────────────

    async def __aenter__(self):
        self._loop = asyncio.get_running_loop()
        self._out = asyncio.Queue()
        self._inbox = asyncio.Queue()
        self._tasks = [
            asyncio.create_task(self._turn_loop()),
            asyncio.create_task(self._idle_watch()),
        ]
        print(f"[Local] NanoGPT session open — {len(self._tools)} tools")
        return self

    async def __aexit__(self, *exc):
        self._halt_current()
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        return False

    # ── the four methods main.py calls ───────────────────────────────────────

    async def send_realtime_input(self, audio=None, **_ignored):
        """Microphone audio. main.py only sends it while JARVIS is silent and
        awake, and has already filtered the echo of its own voice."""
        if audio is None:
            return
        data = getattr(audio, "data", None)
        if data is None and isinstance(audio, dict):
            data = audio.get("data")
        if not data:
            return
        self._last_audio = time.monotonic()
        for utterance in self._segmenter.feed(bytes(data)):
            asyncio.create_task(self._hear(utterance))

    async def send_client_content(self, turns=None, turn_complete=True, **_ignored):
        """A text turn: typed, a plugin's `say`, the morning briefing, a monitor."""
        for turn in turns if isinstance(turns, list) else [turns]:
            if hasattr(turn, "model_dump"):
                turn = turn.model_dump(mode="json", exclude_none=True)
            if not isinstance(turn, dict):
                continue
            content = nanogpt.to_content(turn.get("parts") or [])
            if content:
                await self._inbox.put({"role": "user", "content": content})

    async def send_tool_response(self, function_responses=None, **_ignored):
        """The results of the tools main.py ran; resumes the turn that asked."""
        results = []
        for fr in function_responses or []:
            if hasattr(fr, "model_dump"):
                fr = fr.model_dump(mode="json", exclude_none=True)
            if isinstance(fr, dict):
                results.append(fr)
        if self._tool_future and not self._tool_future.done():
            self._tool_future.set_result(results)

    async def receive(self):
        """Everything for one turn, then return — the same shape as Gemini's,
        which main.py loops over with `while True: async for ...`. It WAITS for
        messages rather than returning when there are none; an empty return
        here would spin that loop at full speed."""
        while True:
            msg = await self._out.get()
            yield msg
            if _is_turn_complete(msg):
                return

    # ── interruption ─────────────────────────────────────────────────────────

    def cancel(self) -> None:
        """Stop the reply in progress. Thread-safe; main.py's interrupt() calls it.

        Always ends in a turn_complete, even when nothing was running: after an
        interrupt main.py discards audio until it sees one, so without it the
        first sentence of the NEXT reply would be silently thrown away.
        """
        if self._loop is None:
            return
        self._loop.call_soon_threadsafe(self._cancel_now)

    def _cancel_now(self) -> None:
        if self._current and not self._current.done():
            self._halt_current()   # its own finally emits the turn_complete
        else:
            self._emit(_message(done=True))

    def _halt_current(self) -> None:
        if self._stop:
            self._stop.set()
        if self._current and not self._current.done():
            self._current.cancel()

    # ── internals ────────────────────────────────────────────────────────────

    def _emit(self, msg) -> None:
        if self._out is not None:
            self._out.put_nowait(msg)

    async def _idle_watch(self) -> None:
        """End an utterance whose audio stopped arriving mid-word — push-to-talk
        released, or the assistant put to sleep — see Segmenter."""
        while True:
            await asyncio.sleep(0.2)
            if (self._segmenter.active
                    and time.monotonic() - self._last_audio > self._idle_flush_s):
                utterance = self._segmenter.flush()
                if utterance is not None:
                    asyncio.create_task(self._hear(utterance))

    async def _hear(self, audio: np.ndarray) -> None:
        try:
            text = (await asyncio.to_thread(self._ears.transcribe, audio)).strip()
        except Exception as e:
            print(f"[Local] couldn't transcribe: {e}")
            return
        if not text:
            return
        # Shown in the log before the answer starts, as Gemini's own
        # transcription would be.
        self._emit(_message(heard=text))
        await self._inbox.put({"role": "user", "content": text})

    async def _turn_loop(self) -> None:
        """One turn at a time, in order. A briefing arriving while you are
        being answered waits its turn instead of cutting across the reply and
        tangling two sets of tool calls in one history."""
        while True:
            message = await self._inbox.get()
            self._history.append(message)
            self._current = asyncio.create_task(self._run_turn())
            # wait(), not await: a cancelled turn must not cancel this loop.
            await asyncio.wait({self._current})
            self._current = None

    async def _run_turn(self) -> None:
        try:
            for round_no in range(MAX_ROUNDS):
                offer_tools = bool(self._tools) and round_no < MAX_ROUNDS - 1
                text, calls = await self._model_round(offer_tools)

                if not calls:
                    self._history.append({"role": "assistant", "content": text})
                    return

                self._history.append({
                    "role": "assistant",
                    "content": text or None,
                    "tool_calls": [
                        {"id": c["id"], "type": "function",
                         "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}}
                        for c in calls
                    ],
                })

                # main.py runs these through its own _execute_tool — the same
                # code path Gemini's calls take — and answers via
                # send_tool_response, which resolves this future.
                self._tool_future = self._loop.create_future()
                self._emit(_message(calls=[
                    SimpleNamespace(id=c["id"], name=c["name"], args=_parse_args(c["arguments"]))
                    for c in calls
                ]))
                results = await self._tool_future
                self._tool_future = None

                by_id = {r.get("id"): r for r in results}
                for c in calls:
                    result = by_id.get(c["id"]) or {"response": {"result": "no result returned"}}
                    self._history.append({
                        "role": "tool",
                        "tool_call_id": c["id"],
                        "content": json.dumps(result.get("response", {}), default=str)[:8000],
                    })
        except nanogpt.NanoGPTError as e:
            # A silent box is the worst failure a voice assistant has: nobody
            # can tell "thinking" from "broken". Say what went wrong.
            print(f"[Local] {e}")
            await self._say(f"Sorry, I couldn't reach my brain just now. {e}")
        finally:
            self._stop = None
            self._tool_future = None
            self._emit(_message(done=True))

    async def _model_round(self, offer_tools: bool) -> tuple[str, list]:
        """One request to NanoGPT, speaking each sentence as it completes."""
        messages = [{"role": "system", "content": self._system}] + self._trimmed()
        # A turn carrying a screenshot goes to a model that can see it; the
        # default one may well not (Kimi K2 is text-only).
        vision = any(_has_image(m.get("content")) for m in messages[-1:])

        stop = threading.Event()
        self._stop = stop
        events: asyncio.Queue = asyncio.Queue()
        loop = self._loop
        brain = self._brain
        pick = self._pick_model
        tools = self._tools if offer_tools else None

        def post(event) -> bool:
            # The session can close while a reply is still streaming — main.py
            # reconnects, or the app quits. Its loop is gone then, and posting
            # to it raises in this thread. Stop instead, which also closes the
            # HTTP stream rather than reading the rest of a reply nobody wants.
            try:
                loop.call_soon_threadsafe(events.put_nowait, event)
                return True
            except RuntimeError:
                stop.set()
                return False

        def worker():
            try:
                # Resolved HERE, in the thread: the first call may list models
                # over the network, and main.py plays audio on the event loop.
                model_id = pick(vision=vision)
                for event in brain(messages, tools=tools, model_id=model_id, stop=stop):
                    if not post(event):
                        return
            except Exception as e:  # noqa: BLE001 — reported through the queue
                post(("error", e))
            finally:
                post(("end", None))

        threading.Thread(target=worker, daemon=True, name="nanogpt-stream").start()

        full, pending, calls = "", "", []
        while True:
            kind, value = await events.get()
            if kind == "text":
                full += value
                pending += value
                ready, pending = split_sentences(pending)
                for sentence in ready:
                    await self._say(sentence)
            elif kind == "tool_calls":
                calls = value
            elif kind == "error":
                if isinstance(value, nanogpt.NanoGPTError):
                    raise value
                raise nanogpt.NanoGPTError(str(value))
            elif kind == "end":
                break
        if pending.strip():
            await self._say(pending.strip())
        return full.strip(), calls

    async def _say(self, sentence: str) -> None:
        """Transcript first, then its audio — the face reads the words to know
        where the lips close, and the sound to know when."""
        spoken = speakable(sentence)
        if not spoken:
            return
        try:
            pcm = await asyncio.to_thread(self._voice.synthesize, spoken)
        except Exception as e:
            print(f"[Local] couldn't synthesise speech: {e}")
            pcm = b""
        self._emit(_message(said=sentence))
        for i in range(0, len(pcm), _CHUNK_BYTES):
            self._emit(_message(data=pcm[i:i + _CHUNK_BYTES]))

    def _trimmed(self) -> list[dict]:
        """Recent history, cut at a user message so no tool result is orphaned."""
        users = [i for i, m in enumerate(self._history) if m.get("role") == "user"]
        start = users[-_HISTORY_TURNS] if len(users) > _HISTORY_TURNS else 0
        kept = self._history[start:]
        while len(json.dumps(kept, default=str)) > _HISTORY_CHARS:
            later = [i for i, m in enumerate(kept) if m.get("role") == "user" and i > 0]
            if not later:
                break
            kept = kept[later[0]:]
        return kept


def _parse_args(raw: str) -> dict:
    try:
        value = json.loads(raw or "{}")
        return value if isinstance(value, dict) else {}
    except ValueError:
        return {}


def _local_settings() -> dict:
    """Voice settings from config/api_keys.json, all optional."""
    try:
        data = json.loads(nanogpt.CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        data = {}
    return {
        # British male by default — the nearest Kokoro has to the films.
        "voice": str(data.get("local_voice") or "bm_george"),
        "voice_speed": float(data.get("local_voice_speed") or 1.05),
        # "base" answers quickly on a CPU; "small" hears better and is slower.
        "whisper_model": str(data.get("whisper_model") or "base"),
        "whisper_language": data.get("whisper_language") or None,
    }
