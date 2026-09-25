"""The NanoGPT client. Added in the Jarivs-Mark-1 import; see NOTICE.md."""
from __future__ import annotations

import threading

import pytest

from core import nanogpt as n


# ── The subscription path ────────────────────────────────────────────────────

def test_default_url_is_the_subscription_path_not_the_billed_one():
    # /api/v1 bills per token against credit; /api/subscription/v1 is covered
    # by the plan. Same models, same requests — only the bill differs.
    assert n.BASE_URL.endswith("/api/subscription/v1")
    assert "/api/v1" not in n.BASE_URL


def test_settings_default_to_gemini_so_upstream_behaviour_is_unchanged(tmp_path, monkeypatch):
    monkeypatch.setattr(n, "CONFIG_PATH", tmp_path / "missing.json")
    assert n.settings()["engine"] == "gemini"
    assert n.enabled() is False


def test_nanogpt_needs_both_the_engine_and_a_key(tmp_path, monkeypatch):
    cfg = tmp_path / "api_keys.json"
    monkeypatch.setattr(n, "CONFIG_PATH", cfg)
    cfg.write_text('{"engine": "nanogpt"}')
    assert n.enabled() is False
    cfg.write_text('{"engine": "nanogpt", "nanogpt_api_key": "k"}')
    assert n.enabled() is True


# ── Gemini schema → JSON Schema ──────────────────────────────────────────────

def test_schema_types_are_lowercased_recursively():
    out = n.to_json_schema({
        "type": "OBJECT",
        "properties": {
            "name": {"type": "STRING", "description": "who"},
            "tags": {"type": "ARRAY", "items": {"type": "STRING"}},
            "deep": {"type": "OBJECT", "properties": {"n": {"type": "INTEGER"}}},
        },
        "required": ["name"],
    })
    assert out["type"] == "object"
    assert out["properties"]["name"] == {"type": "string", "description": "who"}
    assert out["properties"]["tags"] == {"type": "array", "items": {"type": "string"}}
    assert out["properties"]["deep"]["properties"]["n"] == {"type": "integer"}
    assert out["required"] == ["name"]


def test_gemini_only_keys_are_dropped_not_passed_through():
    # A strict server rejects the WHOLE request over one unknown key.
    out = n.to_json_schema({"type": "STRING", "nullable": True, "propertyOrdering": ["a"]})
    assert out == {"type": "string"}


def test_a_zero_argument_tool_still_declares_its_properties():
    assert n.to_json_schema({"type": "OBJECT"}) == {"type": "object", "properties": {}}
    assert n.to_json_schema(None) == {"type": "object", "properties": {}}


def test_sdk_objects_convert_the_same_as_dicts():
    from google.genai import types

    decl = types.FunctionDeclaration(
        name="open_app", description="Open an app",
        parameters=types.Schema(type="OBJECT", properties={"app": types.Schema(type="STRING")}),
    )
    [tool] = n.to_tools([decl])
    assert tool == {
        "type": "function",
        "function": {
            "name": "open_app",
            "description": "Open an app",
            "parameters": {"type": "object", "properties": {"app": {"type": "string"}}},
        },
    }


# ── Content ──────────────────────────────────────────────────────────────────

def test_text_only_content_is_a_plain_string():
    assert n.to_content([{"text": "a"}, {"text": "b"}]) == "a\nb"


def test_images_become_data_uri_parts():
    content = n.to_content([{"text": "what is this"},
                            {"inline_data": {"mime_type": "image/png", "data": b"\x89PNG"}}])
    assert content[0] == {"type": "text", "text": "what is this"}
    assert content[1]["image_url"]["url"] == "data:image/png;base64,iVBORw=="


def test_non_image_attachments_are_named_not_silently_dropped():
    content = n.to_content([{"inline_data": {"mime_type": "application/pdf", "data": "x"}}])
    assert "application/pdf" in content and "left out" in content


# ── Thinking blocks ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("size", range(1, 92))
def test_thinking_is_removed_however_the_stream_splits_it(size):
    # Speech starts on the first finished sentence, so this has to work on the
    # stream — and a tag can be cut anywhere, including mid-word.
    full = "Sure. <think>secret plan, do not say</think>The answer is 4. <thinking>x</thinking>Done."
    f = n._ThinkFilter()
    out = "".join(f.feed(full[i:i + size]) for i in range(0, len(full), size)) + f.flush()
    assert out == "Sure. The answer is 4. Done."


def test_an_unterminated_thinking_block_is_never_spoken():
    f = n._ThinkFilter()
    assert f.feed("Hi <think>never closed") + f.flush() == "Hi "
    assert n.strip_thinking("Hi <think>never closed") == "Hi"


def test_an_ordinary_less_than_sign_survives():
    f = n._ThinkFilter()
    assert f.feed("a < b and 2<3 ok") + f.flush() == "a < b and 2<3 ok"


# ── Choosing a model ─────────────────────────────────────────────────────────

PLAN = ["deepseek-ai/DeepSeek-R1", "Qwen/Qwen3-32B", "moonshotai/Kimi-K2-Instruct-0905",
        "zai-org/GLM-4.6", "Qwen/Qwen2.5-VL-72B-Instruct"]


def test_prefers_a_strong_tool_caller():
    assert n.choose_model(PLAN) == "moonshotai/Kimi-K2-Instruct-0905"


def test_skips_reasoning_models_for_voice():
    # Seconds of silent working-out, then a lecture, is wrong for a voice.
    assert n.choose_model(["moonshotai/Kimi-K2-Thinking", "zai-org/GLM-4.6"]) == "zai-org/GLM-4.6"
    assert n.choose_model(["deepseek-ai/DeepSeek-R1", "zai-org/GLM-4.6"]) == "zai-org/GLM-4.6"


def test_a_screenshot_turn_gets_a_model_that_can_see():
    # Kimi K2 is text-only; a screenshot sent to it is a 400.
    assert n.choose_model(PLAN, vision=True) == "Qwen/Qwen2.5-VL-72B-Instruct"


def test_no_vision_model_falls_back_without_deadlocking(monkeypatch):
    # Regression: the fallback called model() again while holding the lock.
    monkeypatch.setattr(n, "settings", lambda: {"engine": "nanogpt", "key": "k", "model": "",
                                                 "model_fast": "", "model_vision": "", "base_url": "x"})
    monkeypatch.setattr(n, "list_models", lambda timeout=15.0: ["moonshotai/Kimi-K2-Instruct"])
    n._resolved.clear()

    result = {}
    worker = threading.Thread(target=lambda: result.setdefault("m", n.model(vision=True)), daemon=True)
    worker.start()
    worker.join(timeout=5)
    assert not worker.is_alive(), "model(vision=True) deadlocked"
    assert result["m"] == "moonshotai/Kimi-K2-Instruct"


def test_a_named_model_is_used_as_is(nanogpt_config):
    assert n.model() == "mock-fast-8b"


# ── Against a live OpenAI-compatible server ──────────────────────────────────

def test_chat_sends_the_key_and_returns_text(nanogpt_config):
    # The mock 401s without a Bearer key, so an answer proves the key was sent.
    # (Upstream's orphaned llm_client.py never sent one at all.)
    result = n.chat([{"role": "user", "content": "hello"}])
    assert result["text"]
    assert result["tool_calls"] == []


def test_a_bad_key_is_named_as_a_key_problem(nanogpt_config, monkeypatch):
    real = n.settings
    monkeypatch.setattr(n, "settings", lambda: {**real(), "key": ""})
    with pytest.raises(n.NanoGPTError, match="no NanoGPT key"):
        n.chat([{"role": "user", "content": "hello"}])


def test_streaming_delivers_the_reply_in_pieces(nanogpt_config):
    events = list(n.stream([{"role": "user", "content": "explain at length"}]))
    texts = [v for k, v in events if k == "text"]
    assert len(texts) > 1, "expected the reply to stream, not arrive whole"
    assert events[-1][0] == "done"


def test_streamed_tool_calls_are_assembled_whole(nanogpt_config):
    tools = n.to_tools([{"name": "calculate", "description": "maths",
                         "parameters": {"type": "OBJECT", "properties": {"expression": {"type": "STRING"}}}}])
    events = dict((k, v) for k, v in n.stream([{"role": "user", "content": "calculate 2+2"}], tools=tools))
    [call] = events["tool_calls"]
    assert call["name"] == "calculate"
    assert call["id"]
    # Arguments arrive a few characters at a time; they must be valid JSON once joined.
    import json
    assert "expression" in json.loads(call["arguments"])


def test_stopping_a_stream_ends_it_early(nanogpt_config):
    stop = threading.Event()
    stop.set()
    events = list(n.stream([{"role": "user", "content": "explain at length"}], stop=stop))
    assert ("done", "cancelled") in events


def test_one_shot_matches_what_gemini_call_returns(nanogpt_config):
    reply = n.one_shot(["say hi"], system="be brief")
    assert reply is not None and reply.text
