"""
Shared fixtures for the NanoGPT path. Added in the Jarivs-Mark-1 import.

The fake NanoGPT is the parent repo's own `test/mock-provider.mjs`: it speaks
the OpenAI wire format, streams, requires a Bearer key, and asks for tool calls
on cue — everything the real subscription endpoint does that these tests need,
without a key or the network.
"""
from __future__ import annotations

import json
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
MARK_LIV = HERE.parent
REPO = MARK_LIV.parent
MOCK = REPO / "test" / "mock-provider.mjs"

sys.path.insert(0, str(MARK_LIV))


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def mock_url():
    """Base URL of a running mock provider, or skip if node isn't available."""
    node = shutil.which("node")
    if not node or not MOCK.exists():
        pytest.skip("needs node and the parent repo's test/mock-provider.mjs")

    port = _free_port()
    proc = subprocess.Popen(
        [node, str(MOCK)], cwd=str(REPO),
        env={"MOCK_PORT": str(port), "PATH": "/usr/bin:/bin"},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                break
        except OSError:
            time.sleep(0.1)
    else:
        proc.kill()
        pytest.fail("mock provider did not start")

    yield f"http://127.0.0.1:{port}/v1"
    proc.kill()


@pytest.fixture
def nanogpt_config(tmp_path, monkeypatch, mock_url):
    """A config/api_keys.json selecting NanoGPT, pointed at the mock."""
    from core import nanogpt

    path = tmp_path / "api_keys.json"
    path.write_text(json.dumps({
        "engine": "nanogpt",
        "nanogpt_api_key": "test-key",
        "nanogpt_model": "mock-fast-8b",
        "nanogpt_base_url": mock_url,
    }))
    monkeypatch.setattr(nanogpt, "CONFIG_PATH", path)
    nanogpt._resolved.clear()
    return path
