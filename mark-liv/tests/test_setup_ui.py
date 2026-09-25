"""The first-run setup screen. Added in the Jarivs-Mark-1 import; see NOTICE.md.

Runs Qt offscreen, so it needs PyQt6 and psutil but no display.
"""
from __future__ import annotations

import json
import os
from types import SimpleNamespace

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
QtWidgets = pytest.importorskip("PyQt6.QtWidgets")
pytest.importorskip("psutil")

import ui  # noqa: E402


@pytest.fixture(scope="module")
def app():
    return QtWidgets.QApplication.instance() or QtWidgets.QApplication([])


@pytest.fixture
def config(tmp_path, monkeypatch):
    path = tmp_path / "api_keys.json"
    monkeypatch.setattr(ui, "API_FILE", path)
    monkeypatch.setattr(ui, "CONFIG_DIR", tmp_path)
    return path


def _window():
    """Just enough of MainWindow for the two config methods."""
    return SimpleNamespace(
        _ready=False, _overlay=None, _assistant_name="JARVIS",
        _apply_state=lambda state: None,
        _log=SimpleNamespace(append_log=lambda line: None),
    )


def _submit(overlay, key):
    got = []
    overlay.done.connect(lambda *args: got.append(args))
    overlay._key_input.setText(key)
    overlay._submit()
    return got


# ── The overlay ──────────────────────────────────────────────────────────────

def test_a_first_run_opens_on_nanogpt(app, config):
    overlay = ui.SetupOverlay()
    assert overlay._engine == "nanogpt"
    assert overlay._key_label.text() == "NANOGPT API KEY"


def test_the_engine_travels_with_the_key(app, config):
    overlay = ui.SetupOverlay()
    [(key, os_name, engine)] = _submit(overlay, "  nano-key  ")
    assert (key, engine) == ("nano-key", "nanogpt")
    assert os_name in ("windows", "mac", "linux")


def test_gemini_can_still_be_chosen(app, config):
    overlay = ui.SetupOverlay()
    overlay._engine_btns["gemini"].click()
    assert overlay._key_input.placeholderText() == "AIza…"
    [(_, _, engine)] = _submit(overlay, "AIzaXYZ")
    assert engine == "gemini"


def test_a_re_prompt_opens_on_the_engine_in_use(app, config):
    # After a rejected Gemini key, the form must not quietly switch engines.
    config.write_text(json.dumps({"engine": "gemini", "gemini_api_key": "bad", "os_system": "linux"}))
    assert ui.SetupOverlay()._engine == "gemini"


def test_a_config_from_before_the_import_re_prompts_on_gemini(app, config):
    # Upstream configs have a Gemini key and no "engine" field at all.
    config.write_text(json.dumps({"gemini_api_key": "bad", "os_system": "linux"}))
    assert ui.SetupOverlay()._engine == "gemini"


def test_an_unknown_engine_in_the_file_does_not_crash_the_form(app, config):
    config.write_text(json.dumps({"engine": "something-else"}))
    assert ui.SetupOverlay()._engine == "nanogpt"


def test_an_empty_key_is_refused(app, config):
    assert _submit(ui.SetupOverlay(), "   ") == []


# ── The config gate and the save ─────────────────────────────────────────────

@pytest.mark.parametrize("data, ready", [
    ({}, False),
    ({"gemini_api_key": "AIza", "os_system": "linux"}, True),          # upstream, unchanged
    ({"engine": "nanogpt", "nanogpt_api_key": "k", "os_system": "linux"}, True),
    ({"engine": "nanogpt", "gemini_api_key": "AIza", "os_system": "linux"}, False),
    ({"engine": "nanogpt", "nanogpt_api_key": "k"}, False),
])
def test_the_first_run_gate(config, data, ready):
    config.write_text(json.dumps(data))
    assert ui.MainWindow._check_config(_window()) is ready


def test_saving_a_nanogpt_key_passes_the_gate_and_the_client(config, monkeypatch):
    ui.MainWindow._on_setup_done(_window(), "nano-key", "linux", "nanogpt")
    assert ui.MainWindow._check_config(_window()) is True

    from core import nanogpt
    monkeypatch.setattr(nanogpt, "CONFIG_PATH", config)
    assert nanogpt.enabled() is True
    assert nanogpt.settings()["key"] == "nano-key"


def test_saving_keeps_every_other_setting(config):
    # Upstream overwrote the whole file here, losing the name, colour, voice,
    # devices — and, now, the other engine's key.
    config.write_text(json.dumps({"gemini_api_key": "AIza", "user_name": "Tony",
                                  "ui_color": "#00ffcc", "os_system": "windows"}))
    ui.MainWindow._on_setup_done(_window(), "nano-key", "linux", "nanogpt")
    saved = json.loads(config.read_text())
    assert saved == {"gemini_api_key": "AIza", "user_name": "Tony", "ui_color": "#00ffcc",
                     "os_system": "linux", "engine": "nanogpt", "nanogpt_api_key": "nano-key"}


def test_switching_back_to_gemini_is_one_setup(config):
    ui.MainWindow._on_setup_done(_window(), "nano-key", "linux", "nanogpt")
    ui.MainWindow._on_setup_done(_window(), "AIzaXYZ", "linux", "gemini")
    saved = json.loads(config.read_text())
    assert saved["engine"] == "gemini" and saved["gemini_api_key"] == "AIzaXYZ"
    assert saved["nanogpt_api_key"] == "nano-key"
    assert ui.MainWindow._check_config(_window()) is True
