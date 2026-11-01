const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'autopilot-config.json');
const HISTORY_PATH = path.join(__dirname, '..', 'history.json');

const { buildCronFromCadence, getScheduleInfo } = require('./cadence');

const DEFAULT_CONFIG = {
  enabled: false,
  schedule: '0 */12 * * *',
  scheduleLabel: 'Every 12 Hours (2x Daily)',
  cadence: {
    mode: 'preset',
    preset: 'every-12h',
    intervalValue: 2,
    intervalUnit: 'hours',
    peakPreset: 'gaming_peak',
    specificTimes: ['12:00', '19:00'],
    customCron: '0 */12 * * *'
  },
  privacy: 'private',
  autoTrending: true,
  nicheFocus: 'smart_mix', // 'smart_mix', 'gaming', 'awaited_launches', 'trending_now'
  geminiModel: 'opencode/glm-5.3-flash-free', // field name kept for config/UI compatibility; value is an OpenCode free-model ref
  sources: [
    { type: 'keyword', url: 'GTA 6 gameplay graphics shorts', name: 'GTA 6 & Awaited Launches' },
    { type: 'keyword', url: 'insane viral gaming clips shorts', name: 'Gaming Highlights' },
    { type: 'keyword', url: 'most anticipated upcoming games shorts', name: 'Upcoming Game Launches' },
    { type: 'keyword', url: 'futuristic technology gadgets innovations shorts', name: 'Trending Tech Innovations' }
  ],
  maxCandidates: 10
};

// ---------------------------------------------------------------------------
// In-memory caches
// ---------------------------------------------------------------------------

/** @type {Object|null} Cached parsed config */
let _configCache = null;

/** @type {Array|null} Cached history array */
let _historyCache = null;

/**
 * Set of lowercased canonical IDs from processed history entries.
 * Enables O(1) lookup for the common case in isAlreadyUploaded().
 * @type {Set<string>|null}
 */
let _canonicalIdSet = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeModel(m) {
  if (!m) return 'opencode/glm-5.3-flash-free';
  const clean = m.trim();
  if (clean.includes('-free')) return clean; // already an OpenCode free-model ref
  // Map legacy Gemini-only names to the free tier
  return 'opencode/glm-5.3-flash-free';
}

/**
 * Extracts a normalized, canonical video ID from any URL format or ID string
 */
function extractCanonicalId(videoIdOrUrl) {
  if (!videoIdOrUrl || typeof videoIdOrUrl !== 'string') return '';
  const clean = videoIdOrUrl.trim();

  // YouTube Shorts: /shorts/ABC123xyz-_
  const shortsMatch = clean.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch) return shortsMatch[1];

  // YouTube Watch: v=ABC123xyz-_
  const watchMatch = clean.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];

  // youtu.be/ABC123xyz-_
  const shortUrlMatch = clean.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortUrlMatch) return shortUrlMatch[1];

  // Instagram Reel: /reel/C123xyz/ or /reels/C123xyz/
  const reelMatch = clean.match(/\/reels?\/([a-zA-Z0-9_-]+)/);
  if (reelMatch) return reelMatch[1];

  // Raw 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;

  return clean;
}

// ---------------------------------------------------------------------------
// History cache internals
// ---------------------------------------------------------------------------

/**
 * Build (or rebuild) the _canonicalIdSet from a history array.
 * Stores lowercased canonical IDs for every field combination on processed entries.
 */
function _rebuildIdSet(history) {
  const set = new Set();
  for (const h of history) {
    const isProcessed = h.status === 'uploaded' || h.status === 'rejected';
    if (!isProcessed) continue;

    // Canonical IDs derived from various fields
    const fields = [h.canonicalId, h.id, h.sourceUrl, h.newVideoId];
    for (const f of fields) {
      const canon = extractCanonicalId(f);
      if (canon) set.add(canon.toLowerCase());
    }

    // Also store raw lowercased strings for direct / substring matching fallback
    if (h.id) set.add(String(h.id).trim().toLowerCase());
    if (h.sourceUrl) set.add(String(h.sourceUrl).trim().toLowerCase());
    if (h.newVideoId) set.add(String(h.newVideoId).trim().toLowerCase());
    if (h.newVideoUrl) set.add(String(h.newVideoUrl).trim().toLowerCase());
  }
  return set;
}

/**
 * Loads history from disk once, populating both _historyCache and _canonicalIdSet.
 */
function _loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    _historyCache = [];
    _canonicalIdSet = new Set();
    return;
  }
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf-8');
    _historyCache = JSON.parse(raw);
  } catch {
    _historyCache = [];
  }
  _canonicalIdSet = _rebuildIdSet(_historyCache);
}

/**
 * Ensures history is loaded into memory. No-op after the first call.
 */
function _ensureHistoryLoaded() {
  if (_historyCache === null) {
    _loadHistory();
  }
}

// ---------------------------------------------------------------------------
// Public API — Config
// ---------------------------------------------------------------------------

function getConfig() {
  if (_configCache) return _configCache;

  if (!fs.existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    if (parsed.geminiModel) {
      parsed.geminiModel = normalizeModel(parsed.geminiModel);
    }
    if (Array.isArray(parsed.sources) && parsed.sources.length > 0) {
      const defaultPct = Math.round(100 / parsed.sources.length);
      parsed.sources.forEach(s => {
        if (typeof s.percentage !== 'number' || s.percentage <= 0) {
          s.percentage = defaultPct;
        }
      });
    }
    if (!parsed.cadence) {
      parsed.cadence = {
        mode: 'preset',
        preset: 'every-12h',
        intervalValue: 2,
        intervalUnit: 'hours',
        peakPreset: 'gaming_peak',
        specificTimes: ['12:00', '19:00'],
        customCron: parsed.schedule || '0 */12 * * *'
      };
    } else {
      // Keep schedule/scheduleLabel derived from the cadence definition
      const { cron, label } = buildCronFromCadence(parsed.cadence);
      parsed.schedule = cron;
      parsed.scheduleLabel = label;
    }
    _configCache = parsed;
    return parsed;
  } catch (err) {
    console.error('Failed to read config, returning default:', err.message);
    return DEFAULT_CONFIG;
  }
}

function saveConfig(config) {
  const toSave = { ...config };
  if (toSave.cadence) {
    const { cron, label } = buildCronFromCadence(toSave.cadence);
    toSave.schedule = cron;
    toSave.scheduleLabel = label;
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2));
  _configCache = toSave;
  return toSave;
}

/**
 * Clears the in-memory config cache so the next getConfig() re-reads from disk.
 * Useful after .env reload or external config file changes.
 */
function invalidateConfigCache() {
  _configCache = null;
}

// ---------------------------------------------------------------------------
// Public API — History
// ---------------------------------------------------------------------------

function getHistory() {
  _ensureHistoryLoaded();
  return _historyCache;
}

function addToHistory(entry) {
  _ensureHistoryLoaded();
  const history = _historyCache;
  const canonical = extractCanonicalId(entry.id || entry.sourceUrl);

  // Prevent duplicate entries within history itself
  const filtered = history.filter((h) => {
    const hCanon = extractCanonicalId(h.id || h.sourceUrl);
    return !(canonical && hCanon && canonical === hCanon);
  });

  const newEntry = {
    ...entry,
    canonicalId: canonical || entry.id,
    uploadedAt: new Date().toISOString()
  };

  filtered.unshift(newEntry);

  // Retain up to 5,000 entries so past videos are never forgotten
  const trimmed = filtered.slice(0, 5000);

  // Update in-memory cache and rebuild the Set
  _historyCache = trimmed;
  _canonicalIdSet = _rebuildIdSet(trimmed);

  // Async write to disk (fire-and-forget with error logging)
  fs.writeFile(HISTORY_PATH, JSON.stringify(trimmed, null, 2), (err) => {
    if (err) console.error('Failed to write history to disk:', err.message);
  });

  return trimmed;
}

function isAlreadyUploaded(videoIdOrUrl) {
  if (!videoIdOrUrl) return false;
  const canonical = extractCanonicalId(videoIdOrUrl);
  const targetStr = String(videoIdOrUrl).trim().toLowerCase();

  _ensureHistoryLoaded();

  // --- Fast path: O(1) Set lookup for canonical ID ---
  if (canonical && _canonicalIdSet.has(canonical.toLowerCase())) {
    return true;
  }

  // Also check if the raw target string is directly in the Set
  if (_canonicalIdSet.has(targetStr)) {
    return true;
  }

  // --- Slow path: substring / cross-field matching on cached array (no disk I/O) ---
  // This handles edge cases where only .includes() substring matching would catch a match
  // (e.g., a partial URL embedded in another, or non-standard ID formats).
  return _historyCache.some((h) => {
    // Only 'uploaded' or permanently rejected videos count as processed
    const isProcessed = h.status === 'uploaded' || h.status === 'rejected';
    if (!isProcessed) return false;

    // Canonical ID match was already handled by the Set above, skip to substring checks

    // Direct string / URL match (substring variants)
    const hId = String(h.id || '').trim().toLowerCase();
    const hSrc = String(h.sourceUrl || '').trim().toLowerCase();
    const hNewId = String(h.newVideoId || '').trim().toLowerCase();
    const hNewUrl = String(h.newVideoUrl || '').trim().toLowerCase();

    if (hId && targetStr.includes(hId)) return true;
    if (hSrc && (targetStr.includes(hSrc) || hSrc.includes(targetStr))) return true;
    if (hNewId && targetStr.includes(hNewId)) return true;
    if (hNewUrl && targetStr.includes(hNewUrl)) return true;

    return false;
  });
}

/**
 * Calculates total successful uploads completed today in Pacific Time (PT).
 * YouTube API v3 quotas reset at midnight Pacific Time (00:00 PT).
 */
function getDailyUploadCount() {
  _ensureHistoryLoaded();
  const nowPT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  let count = 0;
  for (const h of _historyCache) {
    if (h.status === 'uploaded' && h.uploadedAt) {
      const uploadPT = new Date(h.uploadedAt).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      if (uploadPT === nowPT) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Checks if the daily YouTube API upload quota limit is reached.
 * Standard free quota: 10,000 units/day.
 * A single videos.insert call costs 1,600 units (max ~6 uploads per day).
 */
function isDailyQuotaReached(maxDailyUploads = 5) {
  const config = getConfig();
  const limit = Number(process.env.MAX_DAILY_UPLOADS || config.maxDailyUploads || maxDailyUploads);
  const count = getDailyUploadCount();
  return {
    reached: count >= limit,
    count,
    limit,
    remaining: Math.max(0, limit - count)
  };
}

module.exports = {
  getConfig,
  saveConfig,
  getHistory,
  addToHistory,
  isAlreadyUploaded,
  getDailyUploadCount,
  isDailyQuotaReached,
  invalidateConfigCache,
  CONFIG_PATH,
  HISTORY_PATH
};
