"""
LLM Web Dashboard — Flask backend

Provides:
  GET  /                     → serve the dashboard HTML
  GET  /api/config           → return current configuration
  POST /api/config           → update configuration
  POST /api/chat             → forward a prompt to the local LLM and stream the reply
  GET  /api/models           → list available models from the local LLM server
  GET  /api/status           → connectivity check against the configured LLM server
"""

import json
import os
import time

import requests
from flask import Flask, Response, jsonify, render_template, request, stream_with_context

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = Flask(__name__)

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def save_config(cfg: dict) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2)


# ---------------------------------------------------------------------------
# Helper: build the base URL for the LLM server
# ---------------------------------------------------------------------------

def _base_url(cfg: dict) -> str:
    host = cfg["server"]["host"].strip()
    port = int(cfg["server"]["port"])
    # Normalise – remove any trailing slash
    if host.startswith("http"):
        return f"{host.rstrip('/')}:{port}"
    return f"http://{host}:{port}"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config", methods=["GET"])
def get_config():
    return jsonify(load_config())


@app.route("/api/config", methods=["POST"])
def set_config():
    data = request.get_json(force=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid JSON body"}), 400

    cfg = load_config()

    # Deep-merge only the keys we know about so callers can send partial updates
    for section in ("server", "model", "parameters"):
        if section in data and isinstance(data[section], dict):
            cfg[section].update(data[section])

    save_config(cfg)
    return jsonify(cfg)


@app.route("/api/status", methods=["GET"])
def status():
    cfg = load_config()
    base = _base_url(cfg)
    api_type = cfg["server"].get("api_type", "ollama")

    try:
        if api_type == "ollama":
            r = requests.get(f"{base}/api/tags", timeout=4)
        else:
            # OpenAI-compatible (llama.cpp, LM Studio, …)
            r = requests.get(f"{base}/v1/models", timeout=4)
        r.raise_for_status()
        return jsonify({"connected": True, "base_url": base})
    except Exception as exc:
        return jsonify({"connected": False, "base_url": base, "error": str(exc)})


@app.route("/api/models", methods=["GET"])
def list_models():
    cfg = load_config()
    base = _base_url(cfg)
    api_type = cfg["server"].get("api_type", "ollama")

    try:
        if api_type == "ollama":
            r = requests.get(f"{base}/api/tags", timeout=6)
            r.raise_for_status()
            models = [m["name"] for m in r.json().get("models", [])]
        else:
            r = requests.get(f"{base}/v1/models", timeout=6)
            r.raise_for_status()
            models = [m["id"] for m in r.json().get("data", [])]
        return jsonify({"models": models})
    except Exception as exc:
        return jsonify({"models": [], "error": str(exc)})


@app.route("/api/chat", methods=["POST"])
def chat():
    """
    Accepts:
      { "messages": [ {"role": "user"|"assistant"|"system", "content": "…"}, … ] }

    Streams the assistant reply back as server-sent events:
      data: {"token": "…"}
      data: [DONE]
    """
    body = request.get_json(force=True)
    messages = body.get("messages", [])
    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    cfg = load_config()
    base = _base_url(cfg)
    api_type = cfg["server"].get("api_type", "ollama")
    params = cfg["parameters"]
    model_name = cfg["model"].get("name", "")

    def generate_ollama():
        payload = {
            "model": model_name,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": params.get("temperature", 0.7),
                "top_k": params.get("top_k", 40),
                "top_p": params.get("top_p", 0.9),
                "num_predict": params.get("max_tokens", 512),
                "repeat_penalty": params.get("repeat_penalty", 1.1),
                "num_ctx": params.get("context_window", 2048),
                "seed": params.get("seed", -1),
            },
        }
        try:
            with requests.post(
                f"{base}/api/chat",
                json=payload,
                stream=True,
                timeout=120,
            ) as resp:
                resp.raise_for_status()
                for raw_line in resp.iter_lines():
                    if not raw_line:
                        continue
                    try:
                        chunk = json.loads(raw_line)
                    except json.JSONDecodeError:
                        continue
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        yield f"data: {json.dumps({'token': token})}\n\n"
                    if chunk.get("done"):
                        yield "data: [DONE]\n\n"
                        return
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            yield "data: [DONE]\n\n"

    def generate_openai():
        payload = {
            "model": model_name,
            "messages": messages,
            "stream": True,
            "temperature": params.get("temperature", 0.7),
            "top_p": params.get("top_p", 0.9),
            "max_tokens": params.get("max_tokens", 512),
            "frequency_penalty": params.get("repeat_penalty", 1.1) - 1.0,
            "seed": params.get("seed", -1) if params.get("seed", -1) >= 0 else None,
        }
        # Remove None values
        payload = {k: v for k, v in payload.items() if v is not None}
        try:
            with requests.post(
                f"{base}/v1/chat/completions",
                json=payload,
                stream=True,
                timeout=120,
            ) as resp:
                resp.raise_for_status()
                for raw_line in resp.iter_lines():
                    if not raw_line:
                        continue
                    line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    if line == "[DONE]":
                        yield "data: [DONE]\n\n"
                        return
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    token = (
                        chunk.get("choices", [{}])[0]
                        .get("delta", {})
                        .get("content", "")
                    )
                    if token:
                        yield f"data: {json.dumps({'token': token})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            yield "data: [DONE]\n\n"

    generator = generate_ollama if api_type == "ollama" else generate_openai
    return Response(
        stream_with_context(generator()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug, host="0.0.0.0", port=5000)
