/**
 * aiClient — dynamic AI gateway powered by OpenCode's free tier.
 *
 * How it works:
 * - Free models are DISCOVERED at runtime via `opencode api get /api/model`
 *   (everything ending in "-free" on the built-in opencode provider).
 *   Any new free model OpenCode ships is picked up automatically.
 * - Calls run through the OpenCode CLI (`opencode run --format json`), which is
 *   the only supported way to consume the free tier.
 * - If a model fails (quota, timeout, bad output, outage), the client marks it
 *   unhealthy with an escalating cooldown and transparently retries the next
 *   best free model. Priority is task-aware: fast "flash"-class models serve
 *   metadata/tagging tasks first, ultra-class models serve deep-reasoning tasks.
 */

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
// Per-model ceiling. Measured successful free-tier calls run 40-55s, so 60s
// leaves headroom without letting a wedged model stall the cycle.
const DEFAULT_TIMEOUT_MS = 60000;
// Ceiling for the whole fallback chain, so a total outage degrades to the
// heuristic path in ~3 minutes instead of 9 models x per-model timeout.
const CHAIN_BUDGET_MS = 180000;
const DISCOVERY_CACHE_MS = 5 * 60 * 1000;

/**
 * Preferred execution order per task class. Anything discovered at runtime
 * that isn't listed here is appended after the preferred set.
 */
const PREFERENCE_TIERS = {
  // Title/hashtag/description writing + trend queries — needs creativity, low latency.
  metadata: [
    'opencode/glm-5.3-flash-free',
    'opencode/mimo-v2.6-flash-free',
    'opencode/deepseek-v4.1-flash-free',
    'opencode/beam-free',
    'opencode/longcat-2.5-preview-free',
    'opencode/space-bunny-free',
    'opencode/nemotron-3.5-lightning-free',
    'opencode/nemotron-3.5-super-vl-free',
    'opencode/nemotron-3-ultra-free'
  ],
  // Video selection / strategy evaluation — deeper reasoning preferred.
  reasoning: [
    'opencode/glm-5.3-flash-free',
    'opencode/nemotron-3-ultra-free',
    'opencode/nemotron-3.5-super-vl-free',
    'opencode/deepseek-v4.1-flash-free',
    'opencode/beam-free',
    'opencode/longcat-2.5-preview-free',
    'opencode/mimo-v2.6-flash-free',
    'opencode/space-bunny-free',
    'opencode/nemotron-3.5-lightning-free'
  ],
  // Video quality check / compliance validation — vision-language & deep reasoning.
  quality_check: [
    'opencode/nemotron-3.5-super-vl-free',
    'opencode/glm-5.3-flash-free',
    'opencode/deepseek-v4.1-flash-free',
    'opencode/nemotron-3-ultra-free',
    'opencode/mimo-v2.6-flash-free',
    'opencode/beam-free',
    'opencode/longcat-2.5-preview-free',
    'opencode/space-bunny-free',
    'opencode/nemotron-3.5-lightning-free'
  ]
};
const DEFAULT_TIER = PREFERENCE_TIERS.metadata;

// In-memory health registry: modelRef -> { failCount, cooldownUntil, lastError }
const health = new Map();
let discoveryCache = { models: null, fetchedAt: 0, pending: null };
// Monotonic per-process counter so concurrent runs never share a temp file.
let runSequence = 0;

let openCodeDisabled = (process.env.DISABLE_OPENCODE === 'true' || process.env.DISABLE_OPENCODE === '1');

let _venvPythonExists = null;
function isVenvPythonAvailable() {
  if (_venvPythonExists === null) {
    _venvPythonExists = fs.existsSync(path.join(PROJECT_ROOT, '.venv-mlx', 'bin', 'python'));
  }
  return _venvPythonExists;
}

// ── MLX Server Lifecycle Management ─────────────────────────────────────────
let mlxProcess = null;
let mlxStartingPromise = null;

async function isMLXRunning(baseUrl = 'http://127.0.0.1:8080') {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/models`, { signal: controller.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureMLXServer(timeoutMs = 60000) {
  const baseUrl = (process.env.MLX_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
  if (await isMLXRunning(baseUrl)) return true;
  if (mlxStartingPromise) return mlxStartingPromise;

  const venvPython = path.join(PROJECT_ROOT, '.venv-mlx', 'bin', 'python');
  if (!fs.existsSync(venvPython)) {
    return false;
  }

  mlxStartingPromise = (async () => {
    const model = (process.env.MLX_MODEL || 'mlx-community/Qwen3.5-9B-MLX-4bit').trim();
    const port = (new URL(baseUrl)).port || '8080';
    console.log(`[MLX] 🚀 Spawning local Apple Silicon MLX VLM server (${model}) on port ${port}...`);

    try {
      const isVL = /vl|vision|llava|omni/i.test(model);
      const serverArgs = isVL
        ? ['-m', 'mlx_vlm.server', '--model', model, '--port', String(port)]
        : ['-m', 'mlx_lm', 'server', '--model', model, '--port', String(port), '--chat-template-args', JSON.stringify({ enable_thinking: false })];

      mlxProcess = spawn(
        venvPython,
        serverArgs,
        { cwd: PROJECT_ROOT, stdio: 'ignore', detached: true }
      );
      mlxProcess.unref();

      // Poll until ready (up to timeoutMs for initial model load)
      const maxAttempts = Math.min(60, Math.max(1, Math.floor(timeoutMs / 1000)));
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await isMLXRunning(baseUrl)) {
          console.log(`[MLX] ✅ MLX Apple Silicon server active & ready on ${baseUrl}`);
          mlxStartingPromise = null;
          return true;
        }
      }
    } catch (err) {
      console.warn(`[MLX] Could not spawn MLX server:`, err.message);
    }

    mlxStartingPromise = null;
    return false;
  })();
  return mlxStartingPromise;
}

function disableOpenCode(reason = '') {
  if (!openCodeDisabled) {
    openCodeDisabled = true;
    console.warn(`[AIClient] 🛑 OpenCode disabled (${reason || 'user request / failure'}). Will not use OpenCode.`);
  }
}

function isUnhealthy(modelRef) {
  const record = health.get(modelRef);
  return !!(record && record.cooldownUntil > Date.now());
}

function reportSuccess(modelRef) {
  health.delete(modelRef);
}

function reportFailure(modelRef, err) {
  const record = health.get(modelRef) || { failCount: 0, cooldownUntil: 0, lastError: null };
  record.failCount += 1;
  record.lastError = String(err && err.message || err).slice(0, 200);
  // Escalating cooldown: 3min, 6min, 12min, capped at 30min.
  const cooldownMs = Math.min(30, 3 * Math.pow(2, record.failCount - 1)) * 60 * 1000;
  record.cooldownUntil = Date.now() + cooldownMs;
  health.set(modelRef, record);
  console.warn(`[AIClient] ⚠ ${modelRef} unhealthy for ${Math.round(cooldownMs / 60000)}min (${record.lastError})`);
}

/**
 * Discovery: query the local OpenCode service for every available free model.
 * Falls back to the static tier list if the service is unreachable.
 */
async function discoverFreeModels() {
  if (openCodeDisabled || process.env.DISABLE_OPENCODE === 'true') {
    return [];
  }
  const now = Date.now();
  if (discoveryCache.models && (now - discoveryCache.fetchedAt) < DISCOVERY_CACHE_MS) {
    return discoveryCache.models;
  }
  if (discoveryCache.pending) return discoveryCache.pending;

  discoveryCache.pending = (async () => {
    try {
      const stdout = await new Promise((resolve, reject) => {
        execFile('opencode', ['api', 'get', '/api/model'], { cwd: PROJECT_ROOT, timeout: 20000 }, (err, out) => {
          if (err) reject(err); else resolve(out || '');
        });
      });
      const lines = String(stdout).split(/\r?\n/).filter(Boolean);
      let models = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const payload = Array.isArray(parsed) ? parsed : parsed.data || parsed;
          if (Array.isArray(payload)) {
            models = payload
              .filter((m) => typeof m?.id === 'string' && m.id.includes('-free'))
              .map((m) => `${m.providerID || 'opencode'}/${m.modelID || m.id}`);
            break;
          }
        } catch { /* skip non-JSON lines */ }
      }
      if (models.length > 0) {
        discoveryCache = { models, fetchedAt: Date.now(), pending: null };
        console.log(`[AIClient] 🔌 Discovered ${models.length} free OpenCode models`);
        return models;
      }
      throw new Error('No free models found in service response');
    } catch (err) {
      console.warn(`[AIClient] Discovery failed (${String(err.message).slice(0, 120)}), using built-in preference list`);
      const fallback = Object.values(PREFERENCE_TIERS)[0];
      discoveryCache = { models: fallback, fetchedAt: now, pending: null };
      return fallback;
    }
  })();

  return discoveryCache.pending;
}

/**
 * Builds the fallback chain for a task: configured/preferred model first,
 * then the tiered list + any newly discovered free models. Skips models
 * currently in cooldown so a dead model is never retried back-to-back.
 */
async function buildChain(preferredModel, taskTier = 'metadata') {
  const venvPythonExists = isVenvPythonAvailable();
  const useMLX = process.env.USE_MLX === 'true' || process.env.USE_MLX === '1' || (process.env.USE_MLX !== 'false' && venvPythonExists);
  const mlxModel = (process.env.MLX_MODEL || 'mlx-community/Qwen3.5-9B-MLX-4bit').trim();
  const useOllama = process.env.USE_OLLAMA === 'true' || process.env.USE_OLLAMA === '1';
  const ollamaModel = (process.env.OLLAMA_MODEL || 'llama3.2').trim();
  const ollamaVisionModel = (process.env.OLLAMA_VISION_MODEL || '').trim();
  const hasGeminiKey = Boolean((process.env.GEMINI_API_KEY || '').trim());
  const geminiModel = (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();
  const ordered = [];
  const push = (ref) => {
    if (ref && !ordered.includes(ref)) {
      if (openCodeDisabled && ref.startsWith('opencode')) return;
      ordered.push(ref);
    }
  };

  const isVL = /vl|vision|llava|omni/i.test(mlxModel);

  // 1. If MLX is enabled / installed, prioritize local Apple Silicon MLX GPU execution.
  // For quality_check (visual keyframe analysis), only route to MLX if it has vision weights (mlx_vlm).
  if (useMLX) {
    if (taskTier === 'quality_check') {
      if (isVL) push(`mlx/${mlxModel}`);
    } else {
      push(`mlx/${mlxModel}`);
    }
  }

  // 2. Local Ollama (if explicitly enabled)
  if (useOllama) {
    if (taskTier === 'quality_check' && ollamaVisionModel) {
      push(`ollama/${ollamaVisionModel}`);
    } else if (taskTier !== 'quality_check') {
      push(`ollama/${ollamaModel}`);
    }
  }

  // 3. Google Gemini (e.g. gemini-2.5-flash / gemini-3.8-flash)
  // For quality_check, prioritize vision-capable Gemini endpoints ahead of text-only fallbacks
  if (hasGeminiKey) {
    if (taskTier === 'quality_check') {
      push('gemini/gemini-2.5-flash');
      push(`gemini/${geminiModel}`);
      if (geminiModel !== 'gemini-3.8-flash') push('gemini/gemini-3.8-flash');
    } else {
      push(`gemini/${geminiModel}`);
      if (geminiModel !== 'gemini-2.5-flash') push('gemini/gemini-2.5-flash');
      if (geminiModel !== 'gemini-3.8-flash') push('gemini/gemini-3.8-flash');
      if (geminiModel !== 'gemini-3.1-flash-lite') push('gemini/gemini-3.1-flash-lite');
    }
  }

  // 4. Preferred model requested by caller
  if (preferredModel) {
    if (useMLX && !preferredModel.startsWith('mlx') && !preferredModel.startsWith('gemini')) {
      push(`mlx/${mlxModel}`);
    } else if (useOllama && !preferredModel.startsWith('ollama') && !preferredModel.startsWith('gemini')) {
      push(`ollama/${ollamaModel}`);
    } else if (hasGeminiKey && preferredModel.startsWith('opencode')) {
      push(`gemini/${geminiModel}`);
    } else {
      push(preferredModel);
    }
  }

  // Only query and append OpenCode if it hasn't failed/been disabled
  if (!openCodeDisabled) {
    const discovered = await discoverFreeModels();
    const tier = PREFERENCE_TIERS[taskTier] || DEFAULT_TIER;
    for (const ref of tier) push(ref);
    for (const ref of discovered) push(ref);
  }

  // Prefer healthy models first; keep cooled-down models at the tail and only
  // use them when everything else has also failed.
  const healthy = ordered.filter((ref) => !isUnhealthy(ref));
  const cooled = ordered.filter((ref) => isUnhealthy(ref));
  return [...healthy, ...cooled];
}

/**
 * Parses the NDJSON emitted by `opencode run --format json`.
 * Returns the assistant text, any error text, and the session it created.
 */
function parseRunOutput(stdout) {
  let text = '';
  let errorText = '';
  let sessionId = null;
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.sessionID) sessionId = event.sessionID;
      if (event.type === 'text' && event.part?.text) {
        text += event.part.text;
      } else if (event.type === 'error' || event.part?.type === 'error') {
        errorText += ` ${JSON.stringify(event.part?.message || event.message || event.part || event)}`;
      }
    } catch { /* ignore non-JSON output lines */ }
  }
  return { text: text.trim(), errorText: errorText.trim(), sessionId };
}

/**
 * Best-effort removal of a throwaway AI session so the project's session list
 * doesn't grow without bound. Never awaited: it must not delay the AI result.
 */
function cleanupSession(sessionId) {
  if (!sessionId || process.env.AI_KEEP_SESSIONS) return;
  try {
    const child = spawn('opencode', ['api', 'delete', `/api/session/${sessionId}`], {
      cwd: PROJECT_ROOT,
      stdio: 'ignore'
    });
    child.on('error', () => { /* best effort */ });
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }, 15000);
    killTimer.unref?.();
  } catch { /* best effort */ }
}

/**
 * Core executor. Runs a single prompt through `opencode run` with a specific
 * model and returns the concatenated text output.
 *
 * Note: `opencode run` does not emit reliably through a Node pipe, so
 * stdout/stderr are captured to a temp file and read after the process exits.
 * Async spawn with an 'ignore'-ed stdin proves reliable; Node's execFile
 * callback path does not.
 */
function runOpenCode(modelRef, prompt, timeoutMs = DEFAULT_TIMEOUT_MS, files = []) {
  return new Promise((resolve, reject) => {
    const tmpOut = path.join(
      os.tmpdir(),
      `ai-client-${process.pid}-${++runSequence}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`
    );
    let outFd = null;
    let errFd = null;
    let settleAttempts = 0;

    const cleanup = () => {
      if (outFd !== null) try { fs.closeSync(outFd); } catch { /* ignore */ }
      if (errFd !== null) try { fs.closeSync(errFd); } catch { /* ignore */ }
    };

    try {
      outFd = fs.openSync(tmpOut, 'w');
      errFd = fs.openSync(tmpOut, 'a');
    } catch (err) {
      reject(new Error(`Could not create temp output for ${modelRef}: ${err.message}`));
      return;
    }

    const args = ['run', '--model', modelRef, '--format', 'json', '--log-level', 'error'];
    if (Array.isArray(files)) {
      for (const f of files) {
        if (f && fs.existsSync(f)) {
          args.push('--file', f);
        }
      }
    }
    args.push(prompt);

    const child = spawn(
      'opencode',
      args,
      { cwd: PROJECT_ROOT, stdio: ['ignore', outFd, errFd] }
    );

    const finish = (fn, arg) => {
      if (settleAttempts) return;
      settleAttempts = 1;
      clearTimeout(timer);
      cleanup();
      try { fs.unlinkSync(tmpOut); } catch { /* already gone */ }
      fn(arg);
    };

    const timer = setTimeout(() => {
      // Recover the session id from whatever streamed before the kill.
      let partial = '';
      try { partial = fs.readFileSync(tmpOut, 'utf8'); } catch { /* ignore */ }
      cleanupSession(parseRunOutput(partial).sessionId);

      child.kill('SIGTERM');
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, 5000);
      finish(reject, new Error(`${modelRef} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => {
      finish(reject, new Error(`${modelRef} spawn failed: ${String(err.message || err).slice(0, 200)}`));
    });

    child.on('exit', (code, signal) => {
      let stdout = '';
      try { stdout = fs.readFileSync(tmpOut, 'utf8'); } catch { /* ignore */ }
      const { text, errorText, sessionId } = parseRunOutput(stdout);
      cleanupSession(sessionId);

      if (signal) {
        finish(reject, new Error(`${modelRef} terminated (${signal}) after ${timeoutMs}ms`));
        return;
      }

      if (text) {
        finish(resolve, text);
      } else if (errorText) {
        finish(reject, new Error(`${modelRef} errored: ${errorText.slice(0, 300)}`));
      } else {
        finish(reject, new Error(`${modelRef} exited with code ${code} and returned no text`));
      }
    });
  });
}

/**
 * Core executor for Google Gemini API via GEMINI_API_KEY.
 * Provides direct fallback when OpenCode free models are unavailable or blocked.
 */
async function runGemini(modelRef, prompt, timeoutMs = 30000, files = []) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured in .env');

  let modelName = modelRef.includes('/') ? modelRef.split('/')[1] : modelRef;
  if (!modelName || modelName.includes('free') || modelName === 'default') {
    modelName = (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();
  }

  const parts = [];
  if (Array.isArray(files)) {
    for (const f of files) {
      if (f && fs.existsSync(f)) {
        try {
          const data = fs.readFileSync(f).toString('base64');
          const ext = path.extname(f).toLowerCase().replace('.', '');
          const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
          parts.push({
            inlineData: { mimeType, data }
          });
        } catch (readErr) {
          console.warn(`[AIClient] Could not read file for Gemini: ${f}`, readErr.message);
        }
      }
    }
  }
  parts.push({ text: prompt });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }]
      }),
      signal: controller.signal
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(`Gemini API error (${res.status}): ${data.error?.message || JSON.stringify(data.error)}`);
    }

    const responseParts = data.candidates?.[0]?.content?.parts || [];
    let text = '';
    for (const p of responseParts) {
      if (p.text) text += p.text;
    }
    if (!text.trim()) {
      throw new Error(`Gemini returned empty text response: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Core executor for local Apple Silicon MLX models via mlx_lm.server.
 * Exposes OpenAI-compatible completions API at http://127.0.0.1:8080/v1/chat/completions.
 * Runs natively on Apple Silicon GPU with unified memory.
 */
async function runMLX(modelRef, prompt, timeoutMs = 60000, files = []) {
  const baseUrl = (process.env.MLX_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
  let modelName = modelRef.replace(/^mlx\//i, '').trim();
  if (!modelName || modelName === 'default') {
    modelName = (process.env.MLX_MODEL || 'mlx-community/Qwen3.5-9B-MLX-4bit').trim();
  }

  // Handle multimodal vision inputs only for Vision-Language models
  const isVL = /vl|vision|llava|omni/i.test(modelName);
  if (Array.isArray(files) && files.length > 0 && !isVL) {
    throw new Error(`MLX model "${modelName}" is running text-only mlx_lm and cannot evaluate image keyframes. Falling back to vision model.`);
  }

  let userContent;
  const imageParts = [];
  if (isVL && Array.isArray(files) && files.length > 0) {
    for (const f of files) {
      if (f && fs.existsSync(f)) {
        try {
          const data = fs.readFileSync(f).toString('base64');
          const ext = path.extname(f).toLowerCase().replace('.', '');
          const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
          imageParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${data}`
            }
          });
        } catch (readErr) {
          console.warn(`[AIClient] Could not read file for MLX: ${f}`, readErr.message);
        }
      }
    }
  }

  if (isVL && imageParts.length > 0) {
    userContent = [
      { type: 'text', text: prompt },
      ...imageParts
    ];
  } else {
    userContent = prompt;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: 'system',
            content: 'You are an elite YouTube Shorts automation assistant producing viral Anime edits in @Editclips-k2r packaging style. You MUST return ONLY valid JSON output, strictly matching the requested format with no commentary, explanation, markdown fences, placeholder titles, or calls to action.'
          },
          { role: 'user', content: userContent }
        ],
        chat_template_kwargs: { enable_thinking: false },
        chat_template_args: { enable_thinking: false },
        temperature: 0.2,
        max_tokens: 1500
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`MLX API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.message?.reasoning || '';
    if (!text.trim()) {
      throw new Error(`MLX returned empty response: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Core executor for local Ollama models.
 * Calls http://127.0.0.1:11434/api/chat (or configured OLLAMA_BASE_URL).
 * Passes images as base64 strings only if model supports vision.
 */
async function runOllama(modelRef, prompt, timeoutMs = 60000, files = []) {
  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  let modelName = modelRef.includes('/') ? modelRef.split('/')[1] : modelRef;
  if (!modelName) modelName = (process.env.OLLAMA_MODEL || 'llama3.2').trim();

  const isVision = /vision|llava|moondream|minicpm|vl\b/i.test(modelName);
  const images = [];
  if (isVision && Array.isArray(files)) {
    for (const f of files) {
      if (f && fs.existsSync(f)) {
        try {
          const data = fs.readFileSync(f).toString('base64');
          images.push(data);
        } catch (readErr) {
          console.warn(`[AIClient] Could not read file for Ollama: ${f}`, readErr.message);
        }
      }
    }
  }

  const message = {
    role: 'user',
    content: prompt
  };
  if (images.length > 0) {
    message.images = images;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [message],
        format: 'json',
        stream: false,
        options: {
          temperature: 0.3
        }
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Ollama API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const text = data?.message?.content || '';
    if (!text.trim()) {
      throw new Error(`Ollama returned empty response: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracts a JSON value (object or array) from raw model text, tolerating
 * markdown fences and surrounding prose.
 */
function extractJSON(text) {
  const cleaned = String(text).replace(/```json\s*/gi, '```').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch { /* fall through to bracket scan */ }

  const candidates = [];
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const start = cleaned.indexOf(open);
    if (start === -1) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) { candidates.push(cleaned.slice(start, i + 1)); break; }
      }
    }
  }
  for (const raw of candidates.sort((a, b) => b.length - a.length)) {
    try { return JSON.parse(raw); } catch { /* try next */ }
  }
  throw new Error('Model response contained no parseable JSON');
}

/**
 * Main public API: run a prompt across the free-model fallback chain until one
 * produces valid JSON for the requested task.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {string} [options.model]      Preferred model ref ("provider/model")
 * @param {string} [options.task]       'metadata' (fast/creative) or 'reasoning'
 * @param {number} [options.timeoutMs]
 * @param {boolean} [options.expectArray] Request expects a JSON array (e.g. queries)
 * @returns {Promise<{ result: any, usedModel: string }>}
 */
async function generateJSON(prompt, options = {}) {
  const {
    model,
    task = 'metadata',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    totalBudgetMs = CHAIN_BUDGET_MS,
    expectArray = false,
    files = []
  } = options;
  const chain = await buildChain(model, task);
  const deadline = Date.now() + totalBudgetMs;

  let lastError = null;
  for (const modelRef of chain) {
    if (openCodeDisabled && modelRef.startsWith('opencode')) {
      continue;
    }
    const remaining = deadline - Date.now();
    if (remaining < 5000) {
      lastError = lastError || new Error('AI chain budget exhausted');
      break;
    }
    try {
      const perModelTimeout = Math.min(timeoutMs, remaining);
      console.log(`[AIClient] 🧠 Task=${task} → trying ${modelRef}`);
      let text;
      if (modelRef.startsWith('mlx')) {
        await ensureMLXServer(perModelTimeout);
        text = await runMLX(modelRef, prompt, perModelTimeout, files);
      } else if (modelRef.startsWith('ollama')) {
        text = await runOllama(modelRef, prompt, perModelTimeout, files);
      } else if (modelRef.startsWith('gemini')) {
        text = await runGemini(modelRef, prompt, perModelTimeout, files);
      } else {
        text = await runOpenCode(modelRef, prompt, perModelTimeout, files);
      }
      const parsed = extractJSON(text);
      if (expectArray) {
        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error('Response is not a non-empty JSON array');
        }
      } else if (Array.isArray(parsed) || typeof parsed !== 'object' || parsed === null) {
        throw new Error('Response is not a JSON object');
      }

      // Strict validation: Reject generic placeholder titles so fallbacks are never uploaded
      if (parsed && typeof parsed === 'object') {
        const titleVal = parsed.title || parsed.optimizedTitle;
        if (titleVal && typeof titleVal === 'string') {
          const clean = titleVal.trim();
          if (
            /^(catchy\s*short\s*title|catchy\s*title|short\s*title|title|untitled video|untitled short|untitled)/i.test(clean) ||
            clean.includes('Catchy Short Title') ||
            clean.includes('Catchy Title') ||
            clean.includes('[2-4 Word')
          ) {
            throw new Error(`AI validation failed: generic placeholder title returned ("${clean}")`);
          }
        }
      }
      reportSuccess(modelRef);
      return { result: parsed, usedModel: modelRef };
    } catch (err) {
      lastError = err;
      reportFailure(modelRef, err);
      if (modelRef.startsWith('opencode')) {
        disableOpenCode(err.message.slice(0, 120));
      }
    }
  }

  throw new Error(`AI model evaluation failed. Last error: ${lastError ? lastError.message : 'No available models'}`);
}

/**
 * Lists currently known free models with health status (for the UI).
 */
async function listFreeModels(taskTier = 'metadata') {
  const chain = await buildChain(null, taskTier);
  return chain.map((ref) => {
    const record = health.get(ref);
    return {
      id: ref,
      healthy: !isUnhealthy(ref),
      failCount: record ? record.failCount : 0,
      lastError: record ? record.lastError : null,
      cooldownUntil: record ? record.cooldownUntil : null
    };
  });
}

/**
 * Maps model names to MLX, Gemini, or OpenCode refs.
 */
function normalizeModelName(name) {
  const venvPythonExists = isVenvPythonAvailable();
  const useMLX = process.env.USE_MLX === 'true' || process.env.USE_MLX === '1' || (process.env.USE_MLX !== 'false' && venvPythonExists);
  const defaultMLX = (process.env.MLX_MODEL || 'mlx-community/Qwen3.5-9B-MLX-4bit').trim();
  if (useMLX) {
    if (!name || name.startsWith('opencode') || name.startsWith('ollama') || name.includes('-free')) {
      return `mlx/${defaultMLX}`;
    }
  }
  const useOllama = process.env.USE_OLLAMA === 'true' || process.env.USE_OLLAMA === '1';
  if (useOllama) {
    if (!name || name.startsWith('opencode') || name.includes('-free')) {
      return `ollama/${process.env.OLLAMA_MODEL || 'llama3.2'}`;
    }
  }
  const hasGeminiKey = Boolean((process.env.GEMINI_API_KEY || '').trim());
  const defaultGemini = (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();
  if (openCodeDisabled || hasGeminiKey) {
    if (!name || name.startsWith('opencode') || name.includes('-free')) {
      return `gemini/${defaultGemini}`;
    }
  }
  if (!name) return 'opencode/glm-5.3-flash-free';
  const clean = name.trim();
  if (clean.startsWith('mlx')) return clean;
  if (clean.startsWith('ollama')) return clean;
  if (clean.startsWith('gemini')) {
    return clean.includes('/') ? clean : `gemini/${clean}`;
  }
  if (openCodeDisabled) return `gemini/${defaultGemini}`;
  return clean;
}

/**
 * Builds @Editclips-k2r beat-synced YouTube title strictly enforcing:
 * ${hook} 🔥💀 | ${franchise} | Song - ${songName} | ${nicheTag} #edit #shorts
 * Strictly capped at max 95 characters.
 */
function buildBeatSyncTitle({
  hook = 'Peak Aura Moment',
  franchise = 'Anime',
  songName = 'MONTAGEM ALQUIMIA',
  nicheTag = '#anime'
} = {}) {
  let cleanHook = (hook || 'Peak Aura Moment')
    .replace(/[#|🔥💀]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleanHook) cleanHook = 'Peak Aura Moment';

  let cleanFranchise = (franchise || 'Anime')
    .replace(/[#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleanFranchise) cleanFranchise = 'Anime';

  let cleanSong = (songName || 'MONTAGEM ALQUIMIA')
    .replace(/[#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleanSong) cleanSong = 'MONTAGEM ALQUIMIA';

  let cleanNiche = (nicheTag || '#anime').trim();
  if (!cleanNiche.startsWith('#')) cleanNiche = `#${cleanNiche}`;
  cleanNiche = `#${cleanNiche.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`;
  if (!cleanNiche || cleanNiche === '#') cleanNiche = '#anime';

  const fixedSuffix = ` | Song - ${cleanSong} | ${cleanNiche} #edit #shorts`;
  const fixedMiddle = ` 🔥💀 | `;

  // Max 95 characters enforcement
  const availableForHookAndFranchise = 95 - fixedSuffix.length - fixedMiddle.length;
  if (availableForHookAndFranchise > 0 && (cleanHook.length + cleanFranchise.length > availableForHookAndFranchise)) {
    const franchiseBudget = Math.max(8, Math.floor(availableForHookAndFranchise * 0.45));
    if (cleanFranchise.length > franchiseBudget) {
      cleanFranchise = cleanFranchise.slice(0, franchiseBudget).trim();
    }
    const hookBudget = Math.max(5, availableForHookAndFranchise - cleanFranchise.length);
    if (cleanHook.length > hookBudget) {
      cleanHook = cleanHook.slice(0, hookBudget).trim();
    }
  }

  let title = `${cleanHook}${fixedMiddle}${cleanFranchise}${fixedSuffix}`;
  if (title.length > 95) {
    const excess = title.length - 95;
    if (cleanHook.length > excess + 4) {
      cleanHook = cleanHook.slice(0, cleanHook.length - excess).trim();
      title = `${cleanHook}${fixedMiddle}${cleanFranchise}${fixedSuffix}`;
    } else {
      title = title.slice(0, 95).trim();
    }
  }

  return title;
}

/**
 * Builds @Editclips-k2r beat-synced YouTube description strictly enforcing:
 * ${questionHook}
 *
 * Series: ${franchise}
 * Character: ${character}
 * Song: ${songName}
 *
 * ${nicheTag} #${cleanFranchiseTag} #edit #shorts
 * Strictly max 4 hashtags, zero cross-platform tags, zero hardcoded CTA paragraphs.
 */
function buildBeatSyncDescription({
  questionHook = 'Who had the colder aura in this scene?',
  franchise = 'Anime',
  character = 'Main Character',
  songName = 'MONTAGEM ALQUIMIA',
  nicheTag = '#anime'
} = {}) {
  const hook = (questionHook || 'Who had the colder aura in this scene?').trim();
  const series = (franchise || 'Anime').trim();
  const char = (character || 'Main Character').trim();
  const song = (songName || 'MONTAGEM ALQUIMIA').trim();

  let tag1 = (nicheTag || '#anime').trim();
  if (!tag1.startsWith('#')) tag1 = `#${tag1}`;
  tag1 = `#${tag1.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`;
  if (!tag1 || tag1 === '#') tag1 = '#anime';

  const cleanFranchiseTag = franchise.toLowerCase().replace(/[^a-z0-9]/g, '');
  const tag2 = cleanFranchiseTag ? `#${cleanFranchiseTag}` : '#animedit';
  const tag3 = '#edit';
  const tag4 = '#shorts';

  // Strictly 4 hashtags, zero cross-platform spam (#fyp, #reels, #foryoupage), zero CTA paragraphs
  return `${hook}\n\nSeries: ${series}\nCharacter: ${char}\nSong: ${song}\n\n${tag1} ${tag2} ${tag3} ${tag4}`.trim();
}

/**
 * Generates viral @Editclips-k2r metadata for beat-synced Short using songName
 * returned by beatSyncTranscoder.js
 */
async function generateBeatSyncMetadata(videoInfo = {}, options = {}) {
  const songName = (videoInfo.songName || options.songName || 'MONTAGEM ALQUIMIA').trim();
  const rawTitle = (videoInfo.title || videoInfo.sourceTitle || '').replace(/#\S+/g, '').trim();
  const rawDesc = (videoInfo.description || '').trim();
  const rawUploader = (videoInfo.uploader || '').trim();
  const franchiseHint = (videoInfo.franchise || '').trim();
  const nicheTag = (videoInfo.nicheTag || '#anime').trim();

  const prompt = `You are an elite YouTube Shorts packaging specialist for high-retention Anime edits (@Editclips-k2r viral style).
A beat-synced Short has been transcoded with trending soundtrack: "Song - ${songName}".

YOUR TASK:
Formulate viral metadata for this beat-synced Short strictly matching the @Editclips-k2r packaging formula:

REQUIREMENTS:
1. Title Formula: "[2-4 Word Emotional Hook] 🔥💀 | [Exact Franchise/Series Name] | Song - ${songName} | #[NicheTag] #edit #shorts" (STRICTLY Max 95 characters).
2. Question Hook: 1 short polarizing question about the scene/character to drive comment velocity.
3. Series: Exact franchise/anime title.
4. Character: Primary character in scene.
5. Song: "${songName}".
6. Hashtags: Strictly 4 hashtags: ["#[niche]", "#[cleanfranchise]", "#edit", "#shorts"]. Zero cross-platform tags (#fyp, #reels, #foryoupage).
7. NEVER return placeholder titles like "Catchy Short Title" or "Title".
8. ZERO calls to action ("Drop a like", "Subscribe").

Video Info:
Title: ${rawTitle || 'Epic Anime Edit'}
Description: ${rawDesc ? rawDesc.slice(0, 200) : 'N/A'}
Creator: ${rawUploader || 'N/A'}
Franchise Hint: ${franchiseHint || 'Anime'}
Soundtrack: ${songName}

Respond ONLY with valid JSON (no markdown backticks, no comments):
{
  "hook": "[2-4 Word Emotional Hook or Quote]",
  "questionHook": "[1 short polarizing question]",
  "franchise": "[Exact Franchise Name]",
  "character": "[Character Name]",
  "nicheTag": "#anime"
}`;

  let hook = 'Peak Aura Moment';
  let questionHook = 'Who had the colder aura in this scene?';
  let franchise = franchiseHint || 'Anime';
  let character = 'Main Character';
  let cleanNicheTag = nicheTag;

  try {
    const { result } = await generateJSON(prompt, {
      model: options.model,
      task: 'metadata',
      timeoutMs: options.timeoutMs || 25000
    });

    if (result) {
      if (result.hook && typeof result.hook === 'string') hook = result.hook.trim();
      if (result.questionHook && typeof result.questionHook === 'string') questionHook = result.questionHook.trim();
      if (result.franchise && typeof result.franchise === 'string') franchise = result.franchise.trim();
      if (result.character && typeof result.character === 'string') character = result.character.trim();
      if (result.nicheTag && typeof result.nicheTag === 'string') cleanNicheTag = result.nicheTag.trim();
    }
  } catch (err) {
    console.warn(`[AIClient] Beat-sync metadata AI generation fallback triggered: ${err.message}`);
    if (rawTitle) {
      hook = rawTitle.slice(0, 30).trim();
    }
  }

  const title = buildBeatSyncTitle({ hook, franchise, songName, nicheTag: cleanNicheTag });
  const description = buildBeatSyncDescription({ questionHook, franchise, character, songName, nicheTag: cleanNicheTag });
  const cleanFranchiseTag = `#${franchise.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const hashtags = [
    cleanNicheTag.startsWith('#') ? cleanNicheTag : `#${cleanNicheTag}`,
    cleanFranchiseTag,
    '#edit',
    '#shorts'
  ];

  return {
    title,
    description,
    optimizedTitle: title,
    optimizedDescription: description,
    songName,
    questionHook,
    franchise,
    character,
    hashtags,
    tags: ['anime', 'edit', 'shorts', franchise, character].filter(Boolean)
  };
}

module.exports = {
  generateJSON,
  extractJSON,
  listFreeModels,
  normalizeModelName,
  discoverFreeModels,
  ensureMLXServer,
  isMLXRunning,
  buildBeatSyncTitle,
  buildBeatSyncDescription,
  generateBeatSyncMetadata,
  resetVenvCache: () => { _venvPythonExists = null; }
};
