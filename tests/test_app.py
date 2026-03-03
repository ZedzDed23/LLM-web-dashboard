"""
Tests for the LLM Dashboard Flask application.
Run inside a virtual environment via:  make test
"""

import json
import os
import shutil
import tempfile

import pytest

# Import the Flask app; we swap config.json for a temporary copy so tests
# are fully isolated from the real config on disk.
import app as app_module
from app import app


# ── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def isolated_config(tmp_path, monkeypatch):
    """Copy the real config.json to a temp dir; point the app at that copy."""
    src = os.path.join(os.path.dirname(app_module.__file__), "config.json")
    dest = tmp_path / "config.json"
    shutil.copy(src, dest)
    monkeypatch.setattr(app_module, "CONFIG_PATH", str(dest))
    yield dest


@pytest.fixture()
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ── Dashboard HTML ───────────────────────────────────────────────────────────

class TestIndex:
    def test_returns_200(self, client):
        r = client.get("/")
        assert r.status_code == 200

    def test_content_type_html(self, client):
        r = client.get("/")
        assert "text/html" in r.content_type

    def test_contains_brand_name(self, client):
        r = client.get("/")
        assert b"LLM Dashboard" in r.data

    def test_contains_chat_panel(self, client):
        r = client.get("/")
        assert b"chat-panel" in r.data

    def test_contains_sidebar(self, client):
        r = client.get("/")
        assert b"sidebar" in r.data


# ── GET /api/config ──────────────────────────────────────────────────────────

class TestGetConfig:
    def test_returns_200(self, client):
        r = client.get("/api/config")
        assert r.status_code == 200

    def test_returns_json(self, client):
        r = client.get("/api/config")
        data = r.get_json()
        assert data is not None

    def test_has_server_section(self, client):
        data = client.get("/api/config").get_json()
        assert "server" in data
        assert "host" in data["server"]
        assert "port" in data["server"]
        assert "api_type" in data["server"]

    def test_has_model_section(self, client):
        data = client.get("/api/config").get_json()
        assert "model" in data
        assert "name" in data["model"]
        assert "path" in data["model"]

    def test_has_parameters_section(self, client):
        data = client.get("/api/config").get_json()
        p = data["parameters"]
        for key in ("temperature", "top_k", "top_p", "max_tokens",
                    "repeat_penalty", "context_window", "seed"):
            assert key in p, f"Missing parameter: {key}"

    def test_default_temperature(self, client):
        data = client.get("/api/config").get_json()
        assert data["parameters"]["temperature"] == 0.7

    def test_default_port(self, client):
        data = client.get("/api/config").get_json()
        assert data["server"]["port"] == 11434


# ── POST /api/config ─────────────────────────────────────────────────────────

class TestSetConfig:
    def test_returns_200(self, client):
        r = client.post("/api/config", json={"parameters": {"temperature": 0.5}})
        assert r.status_code == 200

    def test_partial_update_parameters(self, client):
        client.post("/api/config", json={"parameters": {"temperature": 1.2}})
        data = client.get("/api/config").get_json()
        assert data["parameters"]["temperature"] == 1.2

    def test_partial_update_server(self, client):
        client.post("/api/config", json={"server": {"port": 8080}})
        data = client.get("/api/config").get_json()
        assert data["server"]["port"] == 8080

    def test_partial_update_model(self, client):
        client.post("/api/config", json={"model": {"name": "llama3"}})
        data = client.get("/api/config").get_json()
        assert data["model"]["name"] == "llama3"

    def test_unrelated_keys_ignored(self, client):
        r = client.post("/api/config", json={"unknown_section": {"foo": "bar"}})
        assert r.status_code == 200

    def test_invalid_body_returns_400(self, client):
        r = client.post(
            "/api/config",
            data="not-json",
            content_type="application/json",
        )
        assert r.status_code == 400

    def test_persists_across_requests(self, client):
        client.post("/api/config", json={"parameters": {"top_k": 99}})
        data = client.get("/api/config").get_json()
        assert data["parameters"]["top_k"] == 99

    def test_returns_full_config(self, client):
        r = client.post("/api/config", json={"parameters": {"seed": 42}})
        data = r.get_json()
        assert "server" in data
        assert "model" in data
        assert "parameters" in data


# ── GET /api/status ───────────────────────────────────────────────────────────

class TestStatus:
    def test_returns_200(self, client):
        r = client.get("/api/status")
        assert r.status_code == 200

    def test_returns_json_with_connected_key(self, client):
        data = client.get("/api/status").get_json()
        assert "connected" in data

    def test_returns_base_url(self, client):
        data = client.get("/api/status").get_json()
        assert "base_url" in data
        assert "127.0.0.1" in data["base_url"]

    def test_disconnected_when_no_llm_server(self, client):
        # No real LLM server is running in test environment
        data = client.get("/api/status").get_json()
        assert data["connected"] is False

    def test_disconnected_includes_error(self, client):
        data = client.get("/api/status").get_json()
        assert "error" in data


# ── GET /api/models ───────────────────────────────────────────────────────────

class TestModels:
    def test_returns_200(self, client):
        r = client.get("/api/models")
        assert r.status_code == 200

    def test_returns_models_list(self, client):
        data = client.get("/api/models").get_json()
        assert "models" in data
        assert isinstance(data["models"], list)

    def test_empty_list_when_no_server(self, client):
        data = client.get("/api/models").get_json()
        assert data["models"] == []

    def test_includes_error_when_no_server(self, client):
        data = client.get("/api/models").get_json()
        assert "error" in data


# ── POST /api/chat ────────────────────────────────────────────────────────────

class TestChat:
    def test_no_messages_returns_400(self, client):
        r = client.post("/api/chat", json={"messages": []})
        assert r.status_code == 400

    def test_missing_messages_key_returns_400(self, client):
        r = client.post("/api/chat", json={})
        assert r.status_code == 400

    def test_error_json_on_400(self, client):
        r = client.post("/api/chat", json={"messages": []})
        data = r.get_json()
        assert "error" in data


# ── Helper: _base_url ─────────────────────────────────────────────────────────

class TestBaseUrl:
    def test_plain_host_gets_http_prefix(self):
        cfg = {"server": {"host": "127.0.0.1", "port": 11434}}
        url = app_module._base_url(cfg)
        assert url == "http://127.0.0.1:11434"

    def test_host_with_http_prefix_kept(self):
        cfg = {"server": {"host": "http://192.168.1.10", "port": 8080}}
        url = app_module._base_url(cfg)
        assert url == "http://192.168.1.10:8080"

    def test_trailing_slash_stripped(self):
        cfg = {"server": {"host": "http://localhost/", "port": 11434}}
        url = app_module._base_url(cfg)
        assert url == "http://localhost:11434"
