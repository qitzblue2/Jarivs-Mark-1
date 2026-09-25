"""
The local stand-in for the Gemini Live session. Added in the Jarivs-Mark-1
import; see NOTICE.md.

Each session test plays main.py's side of the conversation: it iterates
`receive()` the way `_receive_audio` does and answers tool calls the way
`_execute_tool` + `send_tool_response` do. The brain is real — the NanoGPT
client talking to the mock provider — and only the ears and voice are fakes,
because Whisper and Kokoro need model downloads.
"""
from __future__ import annotations

import asyncio

import numpy as np
import pytest

from core import local_live as L
from core import nanogpt

# ── Fakes for the parts that need model downloads ────────────────────────────


class FakeEars:
    def __init__(self, text="hello there"):
        self.text = text
        self.heard = []

    def transcribe(self, audio):
        self.heard.append(audio)
        return self.text


class FakeVoice:
    """Silence of a plausible length: 24 kHz int16, ~0.05 s a character."""

    def __init__(self):
        self.said = []

    def synthesize(self, text):
        self.said.append(text)
        return np.zeros(1200 * max(1, len(text)), dtype=np.int16).tobytes()


def _session(**kw):
    kw.setdefault("ears", FakeEars())
    kw.setdefault("voice", FakeVoice())
    return L.LocalLiveSession({"system_instruction": "You are JARVIS.", "tools": [
        {"function_declarations": [{
            "name": "calculate", "description": "maths",
            "parameters": {"type": "OBJECT", "properties": {"expression": {"type": "STRING"}}},
        }]}
    ]}, **kw)


async def _turn(session, respond_to_tools=True, timeout=15):
    """Everything receive() yields for one turn, answering tool calls like main.py."""
    from google.genai import types

    got = []

    async def run():
        async for msg in session.receive():
            got.append(msg)
            if msg.tool_call and respond_to_tools:
                await session.send_tool_response(function_responses=[
                    types.FunctionResponse(id=fc.id, name=fc.name, response={"result": "20"})
                    for fc in msg.tool_call.function_calls
                ])

    await asyncio.wait_for(run(), timeout)
    return got


def _speech(seconds=1.0, rate=16_000):
    t = np.arange(int(seconds * rate)) / rate
    return (np.sin(2 * np.pi * 220 * t) * 8000).astype(np.int16).tobytes()


def _silence(seconds=1.0, rate=16_000):
    return np.zeros(int(seconds * rate), dtype=np.int16).tobytes()


# ── What main.py reads off each message ──────────────────────────────────────

def test_messages_carry_exactly_the_fields_main_py_reads():
    # _receive_audio reads: data, server_content.{output,input}_transcription,
    # server_content.turn_complete, tool_call.function_calls, and
    # session_resumption_update through getattr.
    msg = L._message(said="Hi.")
    assert msg.data is None
    assert msg.server_content.output_transcription.text == "Hi."
    assert msg.server_content.input_transcription is None
    assert msg.server_content.turn_complete is False
    assert msg.tool_call is None
    assert msg.session_resumption_update is None

    audio = L._message(data=b"\x00\x00")
    assert audio.server_content is None  # main.py tests `if response.server_content:`


# ── Hearing ──────────────────────────────────────────────────────────────────

def test_silence_is_not_an_utterance():
    seg = L.Segmenter()
    assert seg.feed(_silence(3)) == []


def test_speech_followed_by_a_pause_is_one_utterance():
    seg = L.Segmenter()
    done = seg.feed(_silence(0.5) + _speech(1.0) + _silence(1.0))
    assert len(done) == 1
    assert done[0].dtype == np.float32
    assert -1.0 <= done[0].min() and done[0].max() <= 1.0
    # Pre-roll keeps the start of the first word.
    assert len(done[0]) > 16_000


def test_a_click_is_not_an_utterance():
    seg = L.Segmenter()
    click = _speech(0.04)  # two frames — a keystroke, not a word
    assert seg.feed(_silence(0.5) + click + _silence(1.5)) == []


def test_audio_that_stops_arriving_can_still_end_an_utterance():
    # Push-to-talk released mid-word: no silence ever arrives to end it.
    seg = L.Segmenter()
    assert seg.feed(_silence(0.3) + _speech(0.8)) == []
    assert seg.active
    assert seg.flush() is not None
    assert not seg.active


def test_audio_split_into_odd_blocks_segments_the_same():
    pcm = _silence(0.5) + _speech(1.0) + _silence(1.0)
    whole = L.Segmenter().feed(pcm)
    seg = L.Segmenter()
    pieces = []
    for i in range(0, len(pcm), 2 * 777):  # blocks that don't align to frames
        pieces += seg.feed(pcm[i:i + 2 * 777])
    assert len(pieces) == len(whole) == 1


# ── Speaking ─────────────────────────────────────────────────────────────────

def test_sentences_come_out_as_soon_as_they_finish():
    ready, rest = L.split_sentences("The first sentence is complete. The second is not")
    assert ready == ["The first sentence is complete."]
    assert rest == "The second is not"


def test_tiny_sentences_are_joined_to_the_next():
    ready, _ = L.split_sentences("Sure. Here is the full answer you asked for. ")
    assert ready == ["Sure. Here is the full answer you asked for."]


def test_a_long_run_without_a_full_stop_breaks_at_a_comma():
    text = "word, " * 60
    ready, rest = L.split_sentences(text)
    assert ready and len(ready[0]) <= 205


def test_markdown_and_links_are_not_read_aloud():
    said = L.speakable("**Done** — see https://example.com/x and `code`.\n```py\nx=1\n```")
    assert "*" not in said and "`" not in said and "https" not in said
    assert "the link" in said and "on screen" in said


# ── Reading main.py's config ─────────────────────────────────────────────────

def test_prompt_and_tools_come_from_the_config_main_py_builds():
    from google.genai import types

    cfg = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction="line one\nline two",
        tools=[{"function_declarations": [
            {"name": "open_app", "description": "x",
             "parameters": {"type": "OBJECT", "properties": {"app": {"type": "STRING"}}}},
        ]}],
    )
    system, decls = L._config_parts(cfg)
    assert system == "line one\nline two"
    assert [d["name"] for d in decls] == ["open_app"]


# ── The session, end to end against the mock ─────────────────────────────────

def test_a_text_turn_is_spoken_and_ends(nanogpt_config):
    async def go():
        voice = FakeVoice()
        async with _session(voice=voice) as s:
            await s.send_client_content(turns={"role": "user", "parts": [{"text": "hello"}]})
            return await _turn(s), voice

    msgs, voice = asyncio.run(go())
    said = [m.server_content.output_transcription.text for m in msgs
            if m.server_content and m.server_content.output_transcription]
    audio = [m.data for m in msgs if m.data]

    assert said, "nothing was said"
    assert audio, "nothing was heard"
    assert L._is_turn_complete(msgs[-1])
    assert voice.said


def test_audio_is_what_play_audio_expects(nanogpt_config):
    # _play_audio writes these straight to a 24 kHz int16 mono stream, and the
    # lip-sync reads them in that format. Chunks stay small so an interrupt
    # cuts off within a tenth of a second.
    async def go():
        async with _session() as s:
            await s.send_client_content(turns={"role": "user", "parts": [{"text": "explain at length"}]})
            return await _turn(s)

    audio = [m.data for m in asyncio.run(go()) if m.data]
    assert all(len(chunk) % 2 == 0 for chunk in audio), "int16 samples are two bytes"
    assert all(len(chunk) <= L._CHUNK_BYTES for chunk in audio)
    assert L.OUT_RATE == 24_000


def test_each_sentences_words_arrive_before_its_sound(nanogpt_config):
    async def go():
        async with _session() as s:
            await s.send_client_content(turns={"role": "user", "parts": [{"text": "explain at length"}]})
            return await _turn(s)

    msgs = asyncio.run(go())
    first_words = next(i for i, m in enumerate(msgs)
                       if m.server_content and m.server_content.output_transcription)
    first_sound = next(i for i, m in enumerate(msgs) if m.data)
    assert first_words < first_sound


def test_speech_starts_before_the_reply_is_finished(nanogpt_config):
    # A long answer should be spoken in several pieces, not one at the end.
    async def go():
        voice = FakeVoice()
        async with _session(voice=voice) as s:
            await s.send_client_content(turns={"role": "user", "parts": [{"text": "explain at length"}]})
            await _turn(s)
        return voice.said

    assert len(asyncio.run(go())) > 1


def test_a_tool_call_round_trips_through_main_pys_own_executor(nanogpt_config):
    async def go():
        async with _session() as s:
            await s.send_client_content(turns={"role": "user", "parts": [{"text": "calculate 2+3"}]})
            return await _turn(s)

    msgs = asyncio.run(go())
    calls = [fc for m in msgs if m.tool_call for fc in m.tool_call.function_calls]
    assert [c.name for c in calls] == ["calculate"]
    assert isinstance(calls[0].args, dict) and calls[0].id
    # After the result went back, the turn carried on to an answer and ended.
    assert any(m.server_content and m.server_content.output_transcription for m in msgs)
    assert L._is_turn_complete(msgs[-1])


def test_a_model_that_never_stops_asking_is_cut_off(nanogpt_config):
    # The mock's "keep going" asks for a tool every round, forever.
    async def go():
        async with _session() as s:
            await s.send_client_content(turns={"role": "user", "parts": [{"text": "keep going"}]})
            return await _turn(s, timeout=30)

    msgs = asyncio.run(go())
    rounds = sum(1 for m in msgs if m.tool_call)
    assert rounds == L.MAX_ROUNDS - 1, "tools are withheld on the final round"
    assert L._is_turn_complete(msgs[-1])


def test_speech_from_the_microphone_is_heard_then_answered(nanogpt_config):
    async def go():
        ears = FakeEars("what time is it")
        async with _session(ears=ears) as s:
            await s.send_realtime_input(audio={"data": _silence(0.4) + _speech(1.0) + _silence(1.0)})
            msgs = await _turn(s)
        return msgs, ears

    msgs, ears = asyncio.run(go())
    assert len(ears.heard) == 1
    heard = [m.server_content.input_transcription.text for m in msgs
             if m.server_content and m.server_content.input_transcription]
    assert heard == ["what time is it"]
    assert L._is_turn_complete(msgs[-1])


def test_push_to_talk_released_mid_word_is_still_heard(nanogpt_config):
    async def go():
        ears = FakeEars("open the browser")
        async with _session(ears=ears, idle_flush_s=0.3) as s:
            # Speech, then nothing at all — no trailing silence arrives.
            await s.send_realtime_input(audio={"data": _silence(0.3) + _speech(0.8)})
            await _turn(s)
        return ears

    assert len(asyncio.run(go()).heard) == 1


def test_receive_waits_rather_than_returning_when_idle(nanogpt_config):
    # main.py loops `while True: async for ... in receive()`. A receive() that
    # returned immediately when there was nothing to say would spin that loop
    # at full speed.
    async def go():
        async with _session() as s:
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(s.receive().__anext__(), 0.5)

    asyncio.run(go())


def test_cancelling_while_idle_still_completes_a_turn(nanogpt_config):
    # After interrupt() main.py drops audio until it sees a turn_complete; with
    # none coming, the first sentence of the NEXT reply would be thrown away.
    async def go():
        async with _session() as s:
            s.cancel()
            return await _turn(s, timeout=2)

    msgs = asyncio.run(go())
    assert len(msgs) == 1 and L._is_turn_complete(msgs[0])


def test_cancelling_mid_reply_stops_it_and_completes_the_turn(nanogpt_config):
    async def go():
        async with _session() as s:
            await s.send_client_content(turns={"role": "user", "parts": [{"text": "explain at length"}]})
            got = []
            async for msg in s.receive():
                got.append(msg)
                if msg.data and not any(m.data for m in got[:-1]):
                    s.cancel()  # interrupt as soon as it starts talking
            return got

    msgs = asyncio.run(asyncio.wait_for(go(), 10))
    assert L._is_turn_complete(msgs[-1])


def test_a_briefing_during_a_reply_waits_its_turn(nanogpt_config):
    # Two text turns sent at once must not interleave into one history.
    async def go():
        async with _session() as s:
            await s.send_client_content(turns={"role": "user", "parts": [{"text": "hello"}]})
            await s.send_client_content(turns={"role": "user", "parts": [{"text": "hello again"}]})
            first = await _turn(s)
            second = await _turn(s)
            return first, second, s._history

    first, second, history = asyncio.run(go())
    assert L._is_turn_complete(first[-1]) and L._is_turn_complete(second[-1])
    roles = [m["role"] for m in history]
    assert roles == ["user", "assistant", "user", "assistant"]


def test_a_failure_is_spoken_not_silent(nanogpt_config, monkeypatch):
    # A silent box is the worst failure a voice assistant has: nobody can tell
    # "thinking" from "broken".
    def broken(*_a, **_k):
        raise nanogpt.NanoGPTError("NanoGPT refused the key (401)")
        yield  # pragma: no cover

    async def go():
        voice = FakeVoice()
        async with _session(voice=voice, brain=broken) as s:
            await s.send_client_content(turns={"role": "user", "parts": [{"text": "hello"}]})
            msgs = await _turn(s)
        return msgs, voice

    msgs, voice = asyncio.run(go())
    assert any("refused the key" in said for said in voice.said)
    assert L._is_turn_complete(msgs[-1])


def test_model_lookup_happens_off_the_event_loop(nanogpt_config):
    # The first model() call may hit the network; main.py plays audio on the
    # event loop, so that call must happen in the worker thread.
    import threading

    seen = {}

    def pick(vision=False):
        seen["thread"] = threading.current_thread().name
        return "mock-fast-8b"

    async def go():
        async with _session(pick_model=pick) as s:
            await s.send_client_content(turns={"role": "user", "parts": [{"text": "hello"}]})
            await _turn(s)

    asyncio.run(go())
    assert seen["thread"] == "nanogpt-stream"


def test_a_screenshot_turn_asks_for_a_vision_model(nanogpt_config):
    asked = []

    def pick(vision=False):
        asked.append(vision)
        return "mock-fast-8b"

    async def go():
        async with _session(pick_model=pick) as s:
            await s.send_client_content(turns={"role": "user", "parts": [
                {"inline_data": {"mime_type": "image/png", "data": "iVBORw=="}},
                {"text": "what is on screen"},
            ]})
            await _turn(s)

    asyncio.run(go())
    assert asked[0] is True
