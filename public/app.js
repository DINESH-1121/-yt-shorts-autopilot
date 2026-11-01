// ── DOM Elements ─────────────────────────────────────────────────────────
const btnConnect = document.getElementById('btn-connect');
const connectedBadge = document.getElementById('connected-badge');

// Stats Bar Elements
const statModel = document.getElementById('stat-model');
const statAutopilotStatus = document.getElementById('stat-autopilot-status');
const statUploadsCount = document.getElementById('stat-uploads-count');

// Manual Upload Elements
const btnUpload = document.getElementById('btn-upload');
const btnText = btnUpload.querySelector('.btn-text');
const btnLoading = btnUpload.querySelector('.btn-loading');
const progressSection = document.getElementById('progress-section');
const progressBarWrap = document.getElementById('progress-bar-wrap');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const progressLog = document.getElementById('progress-log');
const resultSection = document.getElementById('result-section');
const resultLink = document.getElementById('result-link');
const errorSection = document.getElementById('error-section');
const errorText = document.getElementById('error-text');

// Auto-Pilot Elements
const autopilotToggle = document.getElementById('autopilot-toggle');
const toggleLabel = document.getElementById('toggle-label');
const autopilotIndicator = document.getElementById('autopilot-indicator');
const btnRunAutopilot = document.getElementById('btn-run-autopilot');
const btnRunText = btnRunAutopilot.querySelector('.btn-text');
const btnRunLoading = btnRunAutopilot.querySelector('.btn-loading');
const geminiBadge = document.getElementById('gemini-badge');
const geminiStatusText = document.getElementById('gemini-status-text');
const autoModel = document.getElementById('auto-model');
const autoSchedule = document.getElementById('auto-schedule');
const autoPrivacy = document.getElementById('auto-privacy');
const autoNiche = document.getElementById('auto-niche');
const autoTrending = document.getElementById('auto-trending');
const sourcesList = document.getElementById('sources-list');
const autopilotLog = document.getElementById('autopilot-log');
const historyContainer = document.getElementById('history-container');

let uploadFinished = false;
let autopilotConfig = null;

// ── Tab Navigation & Accessibility ───────────────────────────────────────
function switchTab(tab) {
  const tabManual = document.getElementById('tab-btn-manual');
  const tabAuto = document.getElementById('tab-btn-autopilot');
  const viewManual = document.getElementById('view-manual');
  const viewAuto = document.getElementById('view-autopilot');

  if (tab === 'manual') {
    tabManual.classList.add('active');
    tabManual.setAttribute('aria-selected', 'true');
    tabAuto.classList.remove('active');
    tabAuto.setAttribute('aria-selected', 'false');

    viewManual.classList.remove('hidden');
    viewAuto.classList.add('hidden');
  } else {
    tabAuto.classList.add('active');
    tabAuto.setAttribute('aria-selected', 'true');
    tabManual.classList.remove('active');
    tabManual.setAttribute('aria-selected', 'false');

    viewAuto.classList.remove('hidden');
    viewManual.classList.add('hidden');

    loadAutoPilotConfig();
    loadHistory();
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    if (data.authenticated) {
      btnConnect.classList.add('hidden');
      connectedBadge.classList.remove('hidden');
    } else {
      btnConnect.classList.remove('hidden');
      connectedBadge.classList.add('hidden');
    }
  } catch {
    btnConnect.classList.remove('hidden');
    connectedBadge.classList.add('hidden');
  }
}

function connectYouTube() {
  window.location.href = '/auth/google';
}

async function disconnect() {
  await fetch('/api/auth/disconnect', { method: 'POST' });
  btnConnect.classList.remove('hidden');
  connectedBadge.classList.add('hidden');
}

// ── Manual Upload Pipeline ───────────────────────────────────────────────
function startUpload() {
  const url = document.getElementById('video-url').value.trim();
  if (!url) {
    showError('Please paste a video URL');
    return;
  }

  const validPatterns = [
    /youtube\.com\/shorts\//,
    /youtu\.be\//,
    /youtube\.com\/watch\?/,
    /instagram\.com\/(reel|reels|p)\//,
    /instagram\.com\/stories\//,
  ];

  if (!validPatterns.some((p) => p.test(url))) {
    showError('Please enter a valid YouTube Shorts or Instagram Reels URL');
    return;
  }

  const title = document.getElementById('video-title').value.trim();
  const description = document.getElementById('video-desc').value.trim();
  const privacy = document.getElementById('video-privacy').value;

  const params = new URLSearchParams({ url, privacy });
  if (title) params.set('title', title);
  if (description) params.set('description', description);

  uploadFinished = false;
  setUploading(true);

  const evtSource = new EventSource(`/api/upload?${params.toString()}`);

  evtSource.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (data.type) {
      case 'progress': {
        addLog(data.message);
        progressText.textContent = data.message;
        const pctMatch = data.message.match(/(\d+\.?\d*)%/);
        if (pctMatch) {
          const pct = parseFloat(pctMatch[1]);
          let totalPct = pct / 2;
          if (data.message.includes('YouTube')) {
            totalPct = 50 + pct / 2;
          }
          progressBar.style.width = `${totalPct}%`;
          if (progressBarWrap) {
            progressBarWrap.setAttribute('aria-valuenow', Math.round(totalPct));
          }
        }
        break;
      }

      case 'done': {
        uploadFinished = true;
        evtSource.close();
        progressBar.style.width = '100%';
        if (progressBarWrap) progressBarWrap.setAttribute('aria-valuenow', 100);
        progressText.textContent = data.message;
        addLog(`✅ ${data.message}`);

        const resultHeading = document.getElementById('result-heading');
        const resultSubtitle = document.getElementById('result-subtitle');
        const scheduleBadge = document.getElementById('result-schedule-badge');

        if (data.publishAt) {
          const formatted = new Date(data.publishAt).toLocaleString([], {
            weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
          });
          if (resultHeading) resultHeading.textContent = 'Uploaded & Auto-Scheduled!';
          if (resultSubtitle) resultSubtitle.textContent = 'Held as Private on YouTube; will flip to Public automatically.';
          if (scheduleBadge) {
            scheduleBadge.textContent = `📅 Scheduled Public Release: ${formatted}`;
            scheduleBadge.classList.remove('hidden');
          }
        } else {
          if (resultHeading) resultHeading.textContent = 'Uploaded Successfully!';
          if (resultSubtitle) resultSubtitle.textContent = 'Your short is now live on your YouTube channel';
          if (scheduleBadge) scheduleBadge.classList.add('hidden');
        }

        resultLink.href = data.videoUrl;
        resultLink.textContent = data.videoUrl;
        resultSection.classList.remove('hidden');
        progressSection.classList.add('hidden');
        setUploading(false);
        loadHistory();
        break;
      }

      case 'error': {
        uploadFinished = true;
        evtSource.close();
        showError(data.message);
        break;
      }
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
    if (!uploadFinished) {
      showError('Connection lost. Please try again.');
    }
  };
}

function showError(message) {
  uploadFinished = true;
  addLog(`❌ ${message}`);
  errorText.textContent = message;
  errorSection.classList.remove('hidden');
  progressSection.classList.add('hidden');
  setUploading(false);
}

function setUploading(isUploading) {
  btnUpload.disabled = isUploading;
  btnText.classList.toggle('hidden', isUploading);
  btnLoading.classList.toggle('hidden', !isUploading);

  if (isUploading) {
    progressSection.classList.remove('hidden');
    resultSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    progressBar.style.width = '0%';
    if (progressBarWrap) progressBarWrap.setAttribute('aria-valuenow', 0);
    progressLog.innerHTML = '';
    progressText.textContent = 'Starting download...';
  }
}

function addLog(message) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.textContent = message;
  progressLog.appendChild(entry);
  progressLog.scrollTop = progressLog.scrollHeight;
}

function resetForm() {
  document.getElementById('video-url').value = '';
  document.getElementById('video-title').value = '';
  document.getElementById('video-desc').value = '';
  document.getElementById('video-privacy').value = 'scheduled';
  const scheduleBadge = document.getElementById('result-schedule-badge');
  if (scheduleBadge) scheduleBadge.classList.add('hidden');
  resultSection.classList.add('hidden');
  errorSection.classList.add('hidden');
  progressSection.classList.add('hidden');
  uploadFinished = false;
  setUploading(false);
}

// ── AI Metadata Generator (Manual Upload) ────────────────────────────────
async function generateAIMetadata() {
  const url = document.getElementById('video-url').value.trim();
  if (!url) {
    alert('Please paste a video link first');
    return;
  }

  const btn = document.getElementById('btn-ai-preview');
  const btnTxt = btn.querySelector('.btn-text');
  const btnLoad = btn.querySelector('.btn-loading');

  btn.disabled = true;
  btnTxt.classList.add('hidden');
  btnLoad.classList.remove('hidden');

  try {
    const res = await fetch('/api/ai/preview-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (data.ok) {
      document.getElementById('video-title').value = data.optimizedTitle;
      document.getElementById('video-desc').value = data.optimizedDescription;

      const details = document.getElementById('manual-options-toggle');
      if (details) details.open = true;
    } else {
      alert('AI Generation error: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Failed to connect to AI engine: ' + err.message);
  } finally {
    btn.disabled = false;
    btnTxt.classList.remove('hidden');
    btnLoad.classList.add('hidden');
  }
}

// ── Auto-Pilot Pro Controls ──────────────────────────────────────────────

// Acronyms that should keep their canonical casing in model labels.
const MODEL_ACRONYMS = { glm: 'GLM', mimo: 'MiMo', deepseek: 'DeepSeek', ai: 'AI', vl: 'VL', gpt: 'GPT', llm: 'LLM' };

function getModelLabel(modelName) {
  if (!modelName) return 'AI (Free Tier)';
  // OpenCode refs look like "opencode/glm-5.3-flash-free" → "GLM-5.3-Flash Free"
  const isFree = modelName.includes('-free');
  const short = modelName.split('/').pop().replace(/-free$/, '');
  const pretty = short
    .split('-')
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (MODEL_ACRONYMS[lower]) return MODEL_ACRONYMS[lower];
      if (/^\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('-');
  return isFree ? `${pretty} Free` : pretty;
}

/**
 * Populates the AI model dropdown from the gateway's live discovery endpoint.
 * Returns the fetched payload so callers can reuse it for the health badge.
 */
async function refreshModelList() {
  if (!autoModel) return null;
  try {
    const res = await fetch('/api/ai/models');
    const data = await res.json();
    if (data.ok && Array.isArray(data.models) && data.models.length > 0) {
      const selected = data.configured || autoModel.value;
      autoModel.innerHTML = '';
      for (const m of data.models) {
        const option = document.createElement('option');
        option.value = m.id;
        option.textContent = `${getModelLabel(m.id)}${m.healthy ? '' : ' (cooling down — auto-used as last resort)'}`;
        autoModel.appendChild(option);
      }
      if (data.models.some((m) => m.id === selected)) autoModel.value = selected;
      if (statModel) statModel.textContent = getModelLabel(selected);
    } else {
      autoModel.innerHTML = '<option value="opencode/glm-5.3-flash-free">No free models available</option>';
    }
    return data;
  } catch (err) {
    console.warn('Could not refresh AI model list:', err.message);
    autoModel.innerHTML = '<option value="opencode/glm-5.3-flash-free">Could not reach AI gateway</option>';
    return null;
  }
}

// ── Dynamic Cadence Studio State & Logic ─────────────────────────────────

let currentCadence = {
  mode: 'immediate',
  preset: 'every-2h',
  intervalValue: 2,
  intervalUnit: 'hours',
  dailyHour: 12,
  peakPreset: 'gaming_peak',
  specificTimes: ['12:00', '19:00'],
  customCron: '0 */2 * * *'
};
let cadenceDebounceTimer = null;
let countdownIntervalTimer = null;
let nextScheduledRunDate = null;

function selectCadenceMode(mode) {
  currentCadence.mode = mode;

  // Toggle mode tab buttons
  document.querySelectorAll('.cadence-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === `cadence-tab-${mode}`);
  });

  // Toggle panel view
  document.querySelectorAll('.cadence-mode-view').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `cadence-panel-${mode}`);
  });

  triggerCadencePreviewAndSave();
}

function stepInterval(delta) {
  const input = document.getElementById('cadence-interval-val');
  if (!input) return;
  let val = parseInt(input.value || 2, 10) + delta;
  const unit = document.getElementById('cadence-interval-unit')?.value || 'hours';
  const max = unit === 'minutes' ? 59 : (unit === 'hours' ? 23 : 30);
  val = Math.max(1, Math.min(max, val));
  input.value = val;
  currentCadence.intervalValue = val;
  triggerCadencePreviewAndSave();
}

function onIntervalUnitChange() {
  const unit = document.getElementById('cadence-interval-unit')?.value || 'hours';
  currentCadence.intervalUnit = unit;
  const input = document.getElementById('cadence-interval-val');
  const dailyHourGroup = document.getElementById('daily-hour-group');

  if (dailyHourGroup) {
    dailyHourGroup.classList.toggle('hidden', unit !== 'days');
  }

  if (input) {
    const max = unit === 'minutes' ? 59 : (unit === 'hours' ? 23 : 30);
    input.max = max;
    if (parseInt(input.value, 10) > max) input.value = max;
    currentCadence.intervalValue = parseInt(input.value, 10);
  }

  triggerCadencePreviewAndSave();
}

function onCadenceInputChange() {
  const val = parseInt(document.getElementById('cadence-interval-val')?.value || 2, 10);
  const unit = document.getElementById('cadence-interval-unit')?.value || 'hours';
  const dailyHour = parseInt(document.getElementById('cadence-daily-hour')?.value || 12, 10);

  currentCadence.intervalValue = Math.max(1, val);
  currentCadence.intervalUnit = unit;
  currentCadence.dailyHour = dailyHour;

  triggerCadencePreviewAndSave();
}

function onPeakPresetChange(presetKey) {
  currentCadence.peakPreset = presetKey;
  document.querySelectorAll('.peak-card').forEach(card => {
    const radio = card.querySelector('input[type="radio"]');
    card.classList.toggle('selected', radio && radio.value === presetKey);
  });
  triggerCadencePreviewAndSave();
}

function formatTimeDisplay(timeStr) {
  const [hStr, mStr] = (timeStr || '12:00').split(':');
  const h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12 < 10 ? '0' + h12 : h12}:${m} ${ampm}`;
}

function renderSpecificTimes() {
  const container = document.getElementById('selected-times-list');
  if (!container) return;
  container.innerHTML = '';

  const times = currentCadence.specificTimes || [];
  if (times.length === 0) {
    container.innerHTML = '<span class="text-muted text-sm">No specific times selected. Click a quick time above or add custom.</span>';
    return;
  }

  times.forEach(timeStr => {
    const tag = document.createElement('div');
    tag.className = 'time-tag';
    tag.innerHTML = `
      <span>🕒 ${formatTimeDisplay(timeStr)}</span>
      <button type="button" class="time-tag-remove" onclick="removeSpecificTime('${timeStr}')" title="Remove time">✕</button>
    `;
    container.appendChild(tag);
  });

  // Highlight active chips
  document.querySelectorAll('.time-chip').forEach(chip => {
    const match = times.some(t => chip.textContent.includes(t) || chip.textContent.includes(formatTimeDisplay(t)));
    chip.classList.toggle('active', match);
  });
}

function toggleSpecificTime(timeStr) {
  if (!currentCadence.specificTimes) currentCadence.specificTimes = [];
  const idx = currentCadence.specificTimes.indexOf(timeStr);
  if (idx >= 0) {
    currentCadence.specificTimes.splice(idx, 1);
  } else {
    currentCadence.specificTimes.push(timeStr);
  }
  currentCadence.specificTimes.sort();
  renderSpecificTimes();
  triggerCadencePreviewAndSave();
}

function addCustomSpecificTime() {
  const input = document.getElementById('new-specific-time');
  if (!input || !input.value) return;
  const time = input.value.trim();
  if (!currentCadence.specificTimes) currentCadence.specificTimes = [];
  if (!currentCadence.specificTimes.includes(time)) {
    currentCadence.specificTimes.push(time);
    currentCadence.specificTimes.sort();
    renderSpecificTimes();
    triggerCadencePreviewAndSave();
  }
}

function removeSpecificTime(timeStr) {
  if (!currentCadence.specificTimes) return;
  currentCadence.specificTimes = currentCadence.specificTimes.filter(t => t !== timeStr);
  renderSpecificTimes();
  triggerCadencePreviewAndSave();
}

function onPresetDropdownChange() {
  const sel = document.getElementById('auto-schedule');
  if (!sel) return;
  currentCadence.preset = sel.value;
  triggerCadencePreviewAndSave();
}

function onCustomCronInput() {
  clearTimeout(cadenceDebounceTimer);
  cadenceDebounceTimer = setTimeout(() => {
    const input = document.getElementById('cadence-custom-cron');
    if (input) {
      currentCadence.customCron = input.value.trim();
      triggerCadencePreviewAndSave();
    }
  }, 450);
}

function applyCustomCron() {
  const input = document.getElementById('cadence-custom-cron');
  if (input) {
    currentCadence.customCron = input.value.trim();
    triggerCadencePreviewAndSave(true);
  }
}

function triggerCadencePreviewAndSave(forceImmediate = false) {
  clearTimeout(cadenceDebounceTimer);
  if (forceImmediate) {
    executeCadenceUpdate();
  } else {
    cadenceDebounceTimer = setTimeout(executeCadenceUpdate, 350);
  }
}

async function executeCadenceUpdate() {
  try {
    const res = await fetch('/api/autopilot/cadence-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentCadence)
    });
    const data = await res.json();
    if (data.ok && data.scheduleInfo) {
      updateCadenceUIElements(data.scheduleInfo);

      if (autopilotConfig) {
        autopilotConfig.cadence = currentCadence;
        autopilotConfig.schedule = data.cron;
        autopilotConfig.scheduleLabel = data.label;
        await saveAutoPilotConfig();
      }
    } else if (data.error) {
      const lbl = document.getElementById('cadence-active-label');
      if (lbl) lbl.textContent = `⚠️ ${data.error}`;
    }
  } catch (err) {
    console.error('Cadence preview error:', err);
  }
}

function updateCadenceUIElements(info) {
  if (!info) return;

  const lbl = document.getElementById('cadence-active-label');
  const cronEl = document.getElementById('cadence-active-cron');
  const nextTime = document.getElementById('cadence-next-time');
  const countdownBadge = document.getElementById('cadence-countdown-badge');
  const statusPillText = document.getElementById('cadence-next-countdown');

  if (currentCadence.mode === 'immediate' || info.cron === 'immediate') {
    if (lbl) lbl.textContent = '⚡ Immediate Continuous (No hard time set)';
    if (cronEl) cronEl.textContent = 'immediate';
    if (nextTime) nextTime.textContent = 'Immediate (Continuous)';
    if (countdownBadge) countdownBadge.textContent = '⚡ Immediate (Active)';
    if (statusPillText) statusPillText.textContent = 'Upload: ⚡ Immediate (No delay)';
    nextScheduledRunDate = null;
    return;
  }

  if (lbl) lbl.textContent = info.label;
  if (cronEl) cronEl.textContent = info.cron;
  if (nextTime) nextTime.textContent = info.nextRunFormatted || 'None scheduled';
  if (countdownBadge) countdownBadge.textContent = info.countdown;
  if (statusPillText) statusPillText.textContent = `Next upload: ${info.countdown}`;

  if (info.nextRunDate) {
    nextScheduledRunDate = new Date(info.nextRunDate);
  }
}

function startCountdownTicker() {
  if (countdownIntervalTimer) clearInterval(countdownIntervalTimer);
  countdownIntervalTimer = setInterval(() => {
    if (currentCadence.mode === 'immediate') {
      const countdownBadge = document.getElementById('cadence-countdown-badge');
      const statusPillText = document.getElementById('cadence-next-countdown');
      if (countdownBadge) countdownBadge.textContent = '⚡ Immediate (Active)';
      if (statusPillText) statusPillText.textContent = 'Upload: ⚡ Immediate (No delay)';
      return;
    }
    if (!nextScheduledRunDate) return;
    const now = new Date();
    const diffMs = nextScheduledRunDate.getTime() - now.getTime();
    const countdownBadge = document.getElementById('cadence-countdown-badge');
    const statusPillText = document.getElementById('cadence-next-countdown');

    if (diffMs <= 0) {
      if (countdownBadge) countdownBadge.textContent = 'Due now';
      if (statusPillText) statusPillText.textContent = 'Next upload: Due now';
      return;
    }
    const totalMins = Math.round(diffMs / 60000);
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    const text = hours === 0 ? `in ${mins}m` : `in ${hours}h ${mins}m`;
    if (countdownBadge) countdownBadge.textContent = text;
    if (statusPillText) statusPillText.textContent = `Next upload: ${text}`;
  }, 10000);
}

async function loadAutoPilotConfig() {
  try {
    const res = await fetch('/api/autopilot/config');
    const data = await res.json();
    autopilotConfig = data.config;

    // Toggle & stats
    const isEnabled = !!autopilotConfig.enabled;
    autopilotToggle.checked = isEnabled;
    toggleLabel.textContent = isEnabled ? 'ON' : 'OFF';
    toggleLabel.classList.toggle('active', isEnabled);

    autopilotIndicator.textContent = isEnabled ? 'ACTIVE' : 'OFF';
    autopilotIndicator.className = isEnabled ? 'pill-badge pill-on' : 'pill-badge pill-off';
    if (statAutopilotStatus) {
      statAutopilotStatus.textContent = isEnabled ? 'Active (ON)' : 'Off';
      statAutopilotStatus.style.color = isEnabled ? 'var(--success)' : 'inherit';
    }

    // Model selection + gateway health (single fetch, reused for both)
    const activeModel = autopilotConfig.geminiModel || 'opencode/glm-5.3-flash-free';
    const modelsData = await refreshModelList();
    if (autoModel) autoModel.value = activeModel;
    if (statModel) statModel.textContent = getModelLabel(activeModel);

    if (modelsData?.ok) {
      const healthyCount = modelsData.models.filter((m) => m.healthy).length;
      if (healthyCount > 0) {
        geminiBadge.textContent = `Active (${healthyCount} Free)`;
        geminiBadge.className = 'pill-badge pill-on';
        geminiStatusText.textContent = `${healthyCount} free model(s) ready. Failed models switch automatically via fallback chain.`;
      } else {
        geminiBadge.textContent = 'Degraded';
        geminiBadge.className = 'pill-badge pill-off';
        geminiStatusText.textContent = 'No healthy AI model right now — heuristic mode is used until one recovers.';
      }
    } else {
      geminiBadge.textContent = 'Offline';
      geminiBadge.className = 'pill-badge pill-off';
      geminiStatusText.textContent = 'Could not reach the AI gateway (is the OpenCode service running?).';
    }

    // Initialize Cadence Studio
    if (autopilotConfig.cadence) {
      currentCadence = { ...currentCadence, ...autopilotConfig.cadence };
    }

    if (data.scheduleInfo) {
      updateCadenceUIElements(data.scheduleInfo);
    }

    // Restore mode
    selectCadenceMode(currentCadence.mode || 'immediate');

    // Populate Interval controls
    const intVal = document.getElementById('cadence-interval-val');
    const intUnit = document.getElementById('cadence-interval-unit');
    const dailyHour = document.getElementById('cadence-daily-hour');
    if (intVal) intVal.value = currentCadence.intervalValue || 2;
    if (intUnit) intUnit.value = currentCadence.intervalUnit || 'hours';
    if (dailyHour) dailyHour.value = currentCadence.dailyHour || 12;
    onIntervalUnitChange();

    // Populate Peak hours
    const peakRadio = document.querySelector(`input[name="peakPreset"][value="${currentCadence.peakPreset || 'gaming_peak'}"]`);
    if (peakRadio) peakRadio.checked = true;
    onPeakPresetChange(currentCadence.peakPreset || 'gaming_peak');

    // Populate Specific times
    renderSpecificTimes();

    // Populate Custom cron
    const customCronInput = document.getElementById('cadence-custom-cron');
    if (customCronInput) customCronInput.value = currentCadence.customCron || autopilotConfig.schedule || '';

    // Populate Preset dropdown
    const presetDropdown = document.getElementById('auto-schedule');
    if (presetDropdown && currentCadence.preset) presetDropdown.value = currentCadence.preset;

    // Start Live Countdown Ticker
    startCountdownTicker();

    // Privacy & Niche dropdowns
    if (autopilotConfig.privacy && autoPrivacy) {
      autoPrivacy.value = autopilotConfig.privacy;
    }
    if (autopilotConfig.nicheFocus && autoNiche) {
      autoNiche.value = autopilotConfig.nicheFocus;
    }
    if (autoTrending) {
      autoTrending.checked = autopilotConfig.autoTrending !== false;
    }

    renderSources();
  } catch (err) {
    console.error('Failed to load autopilot config:', err);
  }
}

function updateSourcesTotalPill() {
  const pill = document.getElementById('sources-total-pill');
  if (!pill || !autopilotConfig || !autopilotConfig.sources) return;
  const total = autopilotConfig.sources.reduce((acc, s) => acc + (Number(s.percentage) || 0), 0);
  pill.textContent = `Total: ${total}%`;
  if (total === 100) {
    pill.className = 'pill-badge pill-on';
    pill.title = 'Perfect 100% distribution';
  } else {
    pill.className = 'pill-badge pill-off';
    pill.title = `Total is ${total}% — weights will be scaled proportionally`;
  }
}

function renderSources() {
  if (!autopilotConfig || !autopilotConfig.sources || !sourcesList) return;
  sourcesList.innerHTML = '';

  if (autopilotConfig.sources.length === 0) {
    sourcesList.innerHTML = '<div class="empty-state">No custom sources added. Dynamic trending topics will be used automatically.</div>';
    updateSourcesTotalPill();
    return;
  }

  const defaultPct = Math.round(100 / autopilotConfig.sources.length);

  autopilotConfig.sources.forEach((src, idx) => {
    if (typeof src.percentage !== 'number') {
      src.percentage = defaultPct;
    }
    const div = document.createElement('div');
    div.className = 'source-item';
    div.setAttribute('role', 'listitem');
    div.innerHTML = `
      <div class="source-meta">
        <span class="source-type-tag">${src.type || 'source'}</span>
        <span class="source-name" title="${src.url}">${src.name || src.url}</span>
      </div>
      <div class="source-actions">
        <div class="source-weight-badge" title="Target percentage of total uploads">
          <input
            type="number"
            min="1"
            max="100"
            class="source-weight-input"
            value="${src.percentage}"
            onchange="updateSourcePercentage(${idx}, this.value)"
            aria-label="Percentage weight for ${src.name || src.url}"
          />
          <span class="weight-unit">%</span>
        </div>
        <button class="btn-icon-del" onclick="deleteSource(${idx})" aria-label="Remove source ${src.name || src.url}" title="Remove source">✕</button>
      </div>
    `;
    sourcesList.appendChild(div);
  });

  updateSourcesTotalPill();
}

async function updateSourcePercentage(idx, val) {
  if (!autopilotConfig || !autopilotConfig.sources || !autopilotConfig.sources[idx]) return;
  const num = Math.max(1, Math.min(100, parseInt(val, 10) || 1));
  autopilotConfig.sources[idx].percentage = num;
  updateSourcesTotalPill();
  await saveAutoPilotConfig();
  addTerminalLog(`Updated "${autopilotConfig.sources[idx].name}" target share to ${num}%.`);
}

async function addSource() {
  const type = document.getElementById('new-source-type').value;
  const input = document.getElementById('new-source-url');
  const pctInput = document.getElementById('new-source-pct');
  const val = input.value.trim();

  if (!val) {
    alert('Please enter a channel URL or search keyword');
    return;
  }

  if (!autopilotConfig.sources) autopilotConfig.sources = [];

  let name = val;
  if (type === 'channel' && val.includes('@')) {
    const match = val.match(/@([^/]+)/);
    name = match ? `@${match[1]}` : val;
  }

  const percentage = Math.max(1, Math.min(100, parseInt(pctInput?.value || 25, 10) || 25));

  autopilotConfig.sources.push({ type, url: val, name, percentage });
  input.value = '';
  renderSources();
  await saveAutoPilotConfig();
  addTerminalLog(`Added source: "${name}" (${type}) with target ${percentage}%.`);
}

async function deleteSource(idx) {
  if (!autopilotConfig || !autopilotConfig.sources) return;
  const removed = autopilotConfig.sources.splice(idx, 1);
  renderSources();
  await saveAutoPilotConfig();
  if (removed[0]) {
    addTerminalLog(`Removed source: "${removed[0].name || removed[0].url}"`);
  }
}

async function saveAutoPilotConfig() {
  try {
    await fetch('/api/autopilot/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(autopilotConfig)
    });
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

function runAutoPilotNow() {
  btnRunAutopilot.disabled = true;
  btnRunText.classList.add('hidden');
  btnRunLoading.classList.remove('hidden');

  autopilotLog.innerHTML = '';
  addTerminalLog('⚡ Manual trigger initiated...');

  const evtSource = new EventSource('/api/autopilot/run');

  evtSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.message) {
        addTerminalLog(data.message);
      }
      if (data.type === 'completed' || data.type === 'done' || data.type === 'error') {
        if (data.type === 'completed') {
          evtSource.close();
          btnRunAutopilot.disabled = false;
          btnRunText.classList.remove('hidden');
          btnRunLoading.classList.add('hidden');
          loadHistory();
        }
      }
    } catch { /* ignore */ }
  };

  evtSource.onerror = () => {
    evtSource.close();
    btnRunAutopilot.disabled = false;
    btnRunText.classList.remove('hidden');
    btnRunLoading.classList.add('hidden');
    loadHistory();
  };
}

function addTerminalLog(msg) {
  const div = document.createElement('div');
  div.className = 'log-entry';
  const time = new Date().toLocaleTimeString();
  div.textContent = `[${time}] ${msg}`;
  autopilotLog.appendChild(div);
  autopilotLog.scrollTop = autopilotLog.scrollHeight;
}

async function loadHistory() {
  try {
    const res = await fetch('/api/autopilot/history');
    const items = await res.json();
    if (!historyContainer) return;
    historyContainer.innerHTML = '';

    if (statUploadsCount) {
      statUploadsCount.textContent = items ? items.length : 0;
    }

    if (!items || items.length === 0) {
      historyContainer.innerHTML = '<div class="empty-state">No automated uploads yet. Trigger a run above to publish your first short!</div>';
      return;
    }

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'history-item';
      if (item.status === 'rejected') {
        div.innerHTML = `
          <div class="history-header">
            <span class="history-title" style="color: #f87171;">🛑 Rejected: ${item.sourceTitle || 'Video'}</span>
            <span class="pill-badge pill-off" style="font-size: 0.72rem; letter-spacing: 0.05em;">AI CHECK REJECTED</span>
          </div>
          <div class="history-reason" style="color: #fca5a5; font-size: 0.85rem; margin-top: 6px; line-height: 1.4;">
            <strong>Quality Check:</strong> ${item.rejectReason || 'Rejected by AI Quality Check (AI Slop or Person Name detected)'}
          </div>
          <div class="history-meta">
            <span>Source: ${item.sourceTitle || item.sourceUrl}</span>
            <span>•</span>
            <span>Creator: ${item.uploader || 'Unknown'}</span>
            <span>•</span>
            <span>${item.uploadedAt ? new Date(item.uploadedAt).toLocaleDateString() : ''}</span>
          </div>
        `;
      } else {
        div.innerHTML = `
          <div class="history-header">
            <span class="history-title">${item.newTitle || 'Uploaded Short'}</span>
            <a class="history-link" href="${item.newVideoUrl}" target="_blank" rel="noopener noreferrer">View on YouTube ↗</a>
          </div>
          ${item.aiReasoning ? `<div class="history-reason">"${item.aiReasoning}"</div>` : ''}
          <div class="history-meta">
            <span>Source: ${item.sourceTitle || item.sourceUrl}</span>
            <span>•</span>
            <span>${item.uploadedAt ? new Date(item.uploadedAt).toLocaleDateString() : ''}</span>
            <span>•</span>
            <span>Privacy: ${item.privacy || 'private'}</span>
            ${item.publishAt ? `<span>•</span><span style="color:#10b981;font-weight:600;">📅 Scheduled: ${new Date(item.publishAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>` : ''}
          </div>
        `;
      }
      historyContainer.appendChild(div);
    });
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

// ── Initial Boot ─────────────────────────────────────────────────────────
checkAuth();
loadAutoPilotConfig();
loadHistory();
