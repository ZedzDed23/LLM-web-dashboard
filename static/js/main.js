/* =========================================================
   LLM Dashboard — Frontend Logic
   ========================================================= */

'use strict';

// ── State ───────────────────────────────────────────────────────────────────

const state = {
  messages: [],       // { role, content }[]
  isStreaming: false,
  config: null,
};

// ── DOM references ──────────────────────────────────────────────────────────

const dom = {
  // Status
  statusDot:   document.getElementById('status-dot'),
  statusLabel: document.getElementById('status-label'),
  btnConnect:  document.getElementById('btn-connect'),

  // Server config
  cfgHost:    document.getElementById('cfg-host'),
  cfgPort:    document.getElementById('cfg-port'),
  cfgApiType: document.getElementById('cfg-api-type'),

  // Model config
  cfgModelName:       document.getElementById('cfg-model-name'),
  cfgModelPath:       document.getElementById('cfg-model-path'),
  btnRefreshModels:   document.getElementById('btn-refresh-models'),
  modelList:          document.getElementById('model-list'),

  // Parameter sliders / inputs
  cfgTemperature:   document.getElementById('cfg-temperature'),
  cfgTopK:          document.getElementById('cfg-top-k'),
  cfgTopP:          document.getElementById('cfg-top-p'),
  cfgMaxTokens:     document.getElementById('cfg-max-tokens'),
  cfgRepeatPenalty: document.getElementById('cfg-repeat-penalty'),
  cfgContextWindow: document.getElementById('cfg-context-window'),
  cfgSeed:          document.getElementById('cfg-seed'),

  // Parameter value labels
  valTemperature:   document.getElementById('val-temperature'),
  valTopK:          document.getElementById('val-top-k'),
  valTopP:          document.getElementById('val-top-p'),
  valMaxTokens:     document.getElementById('val-max-tokens'),
  valRepeatPenalty: document.getElementById('val-repeat-penalty'),
  valContextWindow: document.getElementById('val-context-window'),
  valSeed:          document.getElementById('val-seed'),

  // Sidebar actions
  btnSaveConfig: document.getElementById('btn-save-config'),
  btnClearChat:  document.getElementById('btn-clear-chat'),

  // Chat
  chatMessages: document.getElementById('chat-messages'),
  chatInput:    document.getElementById('chat-input'),
  btnSend:      document.getElementById('btn-send'),

  // Toast + mobile toggle
  toastContainer:    document.getElementById('toast-container'),
  btnToggleSidebar:  document.getElementById('btn-toggle-sidebar'),
  sidebar:           document.querySelector('.sidebar'),
};

// ── Toast notifications ─────────────────────────────────────────────────────

function toast(message, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  dom.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'slideOut 200ms ease forwards';
    setTimeout(() => el.remove(), 200);
  }, duration);
}

// ── Load config from backend ────────────────────────────────────────────────

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    state.config = cfg;
    applyConfigToUI(cfg);
  } catch (err) {
    toast('Failed to load configuration', 'error');
  }
}

function applyConfigToUI(cfg) {
  const s = cfg.server;
  const m = cfg.model;
  const p = cfg.parameters;

  dom.cfgHost.value    = s.host;
  dom.cfgPort.value    = s.port;
  dom.cfgApiType.value = s.api_type || 'ollama';

  dom.cfgModelName.value = m.name || '';
  dom.cfgModelPath.value = m.path || '';

  setSlider(dom.cfgTemperature,   dom.valTemperature,   p.temperature,    2);
  setSlider(dom.cfgTopK,          dom.valTopK,          p.top_k,          0);
  setSlider(dom.cfgTopP,          dom.valTopP,          p.top_p,          2);
  setSlider(dom.cfgMaxTokens,     dom.valMaxTokens,     p.max_tokens,     0);
  setSlider(dom.cfgRepeatPenalty, dom.valRepeatPenalty, p.repeat_penalty, 2);
  setSlider(dom.cfgContextWindow, dom.valContextWindow, p.context_window, 0);
  dom.cfgSeed.value = p.seed;
  dom.valSeed.textContent = p.seed;
}

function setSlider(input, label, value, decimals) {
  input.value = value;
  label.textContent = Number(value).toFixed(decimals);
}

// ── Save config to backend ──────────────────────────────────────────────────

async function saveConfig() {
  const cfg = buildConfigFromUI();
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.config = await res.json();
    toast('Configuration saved', 'success');
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  }
}

function buildConfigFromUI() {
  return {
    server: {
      host:     dom.cfgHost.value.trim(),
      port:     parseInt(dom.cfgPort.value, 10),
      api_type: dom.cfgApiType.value,
    },
    model: {
      name: dom.cfgModelName.value.trim(),
      path: dom.cfgModelPath.value.trim(),
    },
    parameters: {
      temperature:    parseFloat(dom.cfgTemperature.value),
      top_k:          parseInt(dom.cfgTopK.value, 10),
      top_p:          parseFloat(dom.cfgTopP.value),
      max_tokens:     parseInt(dom.cfgMaxTokens.value, 10),
      repeat_penalty: parseFloat(dom.cfgRepeatPenalty.value),
      context_window: parseInt(dom.cfgContextWindow.value, 10),
      seed:           parseInt(dom.cfgSeed.value, 10),
    },
  };
}

// ── Connection status ───────────────────────────────────────────────────────

async function checkConnection() {
  setStatus('checking', 'Checking…');
  dom.btnConnect.disabled = true;
  try {
    const res  = await fetch('/api/status');
    const data = await res.json();
    if (data.connected) {
      setStatus('connected', `Connected · ${data.base_url}`);
      toast('Connected to LLM server', 'success');
    } else {
      setStatus('disconnected', 'Disconnected');
      toast(`Cannot reach server: ${data.error || 'unknown error'}`, 'error');
    }
  } catch (err) {
    setStatus('disconnected', 'Disconnected');
    toast(`Connection error: ${err.message}`, 'error');
  } finally {
    dom.btnConnect.disabled = false;
  }
}

function setStatus(state, label) {
  dom.statusDot.className   = `status-dot ${state}`;
  dom.statusLabel.textContent = label;
}

// ── Model list ──────────────────────────────────────────────────────────────

async function refreshModels() {
  dom.btnRefreshModels.disabled = true;
  dom.modelList.classList.add('hidden');
  dom.modelList.innerHTML = '';

  try {
    const res  = await fetch('/api/models');
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    if (data.models.length === 0) {
      toast('No models found on the server', 'info');
      return;
    }

    data.models.forEach(name => {
      const item = document.createElement('div');
      item.className = 'model-item';
      item.textContent = name;
      item.addEventListener('click', () => {
        dom.cfgModelName.value = name;
        dom.modelList.classList.add('hidden');
      });
      dom.modelList.appendChild(item);
    });

    dom.modelList.classList.remove('hidden');
  } catch (err) {
    toast(`Failed to load models: ${err.message}`, 'error');
  } finally {
    dom.btnRefreshModels.disabled = false;
  }
}

// ── Chat ────────────────────────────────────────────────────────────────────

function clearChat() {
  state.messages = [];
  dom.chatMessages.innerHTML = `
    <div class="chat-welcome">
      <div class="welcome-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <h2>Ready to chat</h2>
      <p>Configure your server and model in the sidebar, then start a conversation below.</p>
    </div>`;
}

function appendMessage(role, content) {
  // Remove welcome screen if present
  const welcome = dom.chatMessages.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const isUser = role === 'user';
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;
  wrapper.dataset.role = role;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = isUser ? 'U' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = content;

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  dom.chatMessages.appendChild(wrapper);
  scrollToBottom();
  return bubble;
}

function appendTypingIndicator() {
  const welcome = dom.chatMessages.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const wrapper = document.createElement('div');
  wrapper.className = 'message assistant';
  wrapper.id = 'typing-indicator-wrapper';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  dom.chatMessages.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function scrollToBottom() {
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

async function sendMessage() {
  const text = dom.chatInput.value.trim();
  if (!text || state.isStreaming) return;

  // Save config first silently from current UI state so model/params are up to date
  await saveConfigSilent();

  state.messages.push({ role: 'user', content: text });
  appendMessage('user', text);
  dom.chatInput.value = '';
  autoResize(dom.chatInput);

  const typingWrapper = appendTypingIndicator();

  state.isStreaming = true;
  dom.btnSend.disabled = true;

  let fullResponse = '';
  let responseBubble = null;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.messages }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;

        let chunk;
        try { chunk = JSON.parse(payload); } catch { continue; }

        if (chunk.error) {
          toast(`LLM error: ${chunk.error}`, 'error');
          break;
        }

        if (chunk.token) {
          // On the first token, swap typing indicator for a real bubble
          if (!responseBubble) {
            typingWrapper.remove();
            responseBubble = appendMessage('assistant', '');
          }
          fullResponse += chunk.token;
          responseBubble.textContent = fullResponse;
          scrollToBottom();
        }
      }
    }
  } catch (err) {
    toast(`Send error: ${err.message}`, 'error');
  } finally {
    typingWrapper.remove();
    if (fullResponse) {
      state.messages.push({ role: 'assistant', content: fullResponse });
    }
    state.isStreaming = false;
    dom.btnSend.disabled = false;
    dom.chatInput.focus();
  }
}

// Save config without showing toast (called before each message)
async function saveConfigSilent() {
  const cfg = buildConfigFromUI();
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    if (res.ok) state.config = await res.json();
  } catch (_) { /* silent */ }
}

// ── Auto-resize textarea ────────────────────────────────────────────────────

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

// ── Event listeners ─────────────────────────────────────────────────────────

// Sliders live update labels
const sliderMap = [
  [dom.cfgTemperature,   dom.valTemperature,   2],
  [dom.cfgTopK,          dom.valTopK,          0],
  [dom.cfgTopP,          dom.valTopP,          2],
  [dom.cfgMaxTokens,     dom.valMaxTokens,     0],
  [dom.cfgRepeatPenalty, dom.valRepeatPenalty, 2],
  [dom.cfgContextWindow, dom.valContextWindow, 0],
];

sliderMap.forEach(([input, label, decimals]) => {
  input.addEventListener('input', () => {
    label.textContent = Number(input.value).toFixed(decimals);
  });
});

dom.cfgSeed.addEventListener('input', () => {
  dom.valSeed.textContent = dom.cfgSeed.value;
});

dom.btnConnect.addEventListener('click', checkConnection);
dom.btnSaveConfig.addEventListener('click', saveConfig);
dom.btnClearChat.addEventListener('click', clearChat);
dom.btnRefreshModels.addEventListener('click', refreshModels);
dom.btnSend.addEventListener('click', sendMessage);

dom.chatInput.addEventListener('input', () => autoResize(dom.chatInput));

dom.chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Mobile sidebar toggle
dom.btnToggleSidebar.addEventListener('click', () => {
  dom.sidebar.classList.toggle('open');
});

// Close model list when clicking elsewhere
document.addEventListener('click', e => {
  if (!dom.modelList.contains(e.target) && e.target !== dom.btnRefreshModels) {
    dom.modelList.classList.add('hidden');
  }
});

// ── Init ────────────────────────────────────────────────────────────────────

loadConfig();
