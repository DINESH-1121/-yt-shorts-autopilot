const { execFile } = require('child_process');
const { isAlreadyUploaded } = require('./store');
const { authArgs, describeError } = require('./ytdlp');

/**
 * Normalizes any source URL or keyword query to target strictly vertical Shorts / Reels format
 */
function normalizeSourceTarget(source, maxItems) {
  let target = source.url.trim();

  // If keyword query, format for YouTube Shorts search
  if (source.type === 'keyword' || !target.startsWith('http')) {
    // Ensure the query targets vertical short-form content
    if (!/#shorts\b|shorts\b/i.test(target)) {
      target = `${target} #shorts`;
    }
    return `ytsearch${maxItems}:${target}`;
  }

  // If YouTube channel, target the dedicated /shorts tab
  if (target.includes('youtube.com/@') || target.includes('youtube.com/channel/') || target.includes('youtube.com/c/')) {
    if (!target.includes('/shorts')) {
      target = target.replace(/\/videos|\/featured|\/playlists|\/streams|\/about|$/, '') + '/shorts';
    }
  }

  return target;
}

/**
 * Scan a single source using yt-dlp (metadata only, no video download)
 * Strictly filters for short-form video content (duration <= 60 seconds)
 * @returns {Promise<{ items: Array, error: string|null }>}
 */
function scanSource(source, ytDlpPath, maxItems = 8) {
  return new Promise((resolve) => {
    const target = normalizeSourceTarget(source, maxItems);

    const args = [
      '--no-warnings',
      '--flat-playlist',
      ...authArgs(),
      '--dump-json',
      '--playlist-end', String(maxItems),
      '--match-filter', '!is_live & !was_live & live_status =? "not_live" & duration <= 58 & duration >= 12',
      target
    ];

    execFile(ytDlpPath, args, { timeout: 20000 }, (err, stdout, stderr) => {
      if (err) {
        // Keep the raw error so callers can classify it; format only for display.
        const raw = String(stderr || err.message || '').replace(/\s+/g, ' ').trim().slice(0, 400);
        console.warn(`[Scanner] Warning querying source "${source.name || target}": ${describeError(raw).slice(0, 240)}`);
        return resolve({ items: [], error: raw });
      }

      const candidates = [];
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          const videoId = item.id;

          // Reject live streams, premiere countdowns, or non-Shorts
          if (item.is_live === true || item.was_live === true || item.live_status === 'is_live' || item.live_status === 'is_upcoming' || item.live_status === 'post_live') {
            continue;
          }

          // A valid Short must meet the YouTube Shorts retention sweet spot: 12s <= duration <= 59.5s
          // (Only filter if duration is known; yt-dlp --match-filter already enforces this during extraction)
          if (typeof item.duration === 'number' && (item.duration > 59.5 || item.duration < 12)) {
            continue;
          }

          let videoUrl = item.url || item.webpage_url;
          if (!videoUrl && videoId) {
            videoUrl = `https://www.youtube.com/shorts/${videoId}`;
          }

          if (!videoUrl || !videoId) continue;
          if (isAlreadyUploaded(videoId)) continue;

          candidates.push({
            id: videoId,
            url: videoUrl,
            title: item.title || 'Untitled Short',
            description: item.description || '',
            duration: item.duration || null,
            viewCount: item.view_count || null,
            uploader: item.uploader || item.channel || source.name || 'Creator',
            channelUrl: item.channel_url || item.uploader_url || '',
            sourceName: source.name || source.url,
            sourcePercentage: Number(source.percentage || source.weight || 0)
          });
        } catch {
          // ignore malformed JSON lines
        }
      }

      resolve({ items: candidates, error: null });
    });
  });
}

/**
 * Scan all configured sources and gather non-duplicate candidates strictly under 60 seconds.
 * Sources are scanned with a small worker pool (default 3, SCAN_CONCURRENCY to override).
 * Every source is scanned fairly to guarantee candidate diversity.
 */
async function scanAllSources(sources, ytDlpPath, maxTotal = 15) {
  if (!sources || sources.length === 0) {
    return { candidates: [], errors: [] };
  }

  // High-concurrency parallel scan across all sources for immediate discovery
  const concurrency = Math.max(1, Math.min(10, Number(process.env.SCAN_CONCURRENCY) || sources.length));
  const perSource = new Array(sources.length);
  let nextIndex = 0;

  // Search top fresh items per source (default 8 items per source discovers 50+ candidates in ~2s)
  const perSourceLimit = Math.max(5, Number(process.env.SCAN_PER_SOURCE) || 8);

  const worker = async () => {
    while (nextIndex < sources.length) {
      const index = nextIndex++;
      const result = await scanSource(sources[index], ytDlpPath, perSourceLimit);
      perSource[index] = result;
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, () => worker()));

  const allCandidates = [];
  const errors = [];
  const seenIds = new Set();

  for (let i = 0; i < perSource.length; i++) {
    const result = perSource[i];
    if (!result) continue;
    if (result.error) {
      errors.push({ source: sources[i].name || sources[i].url, error: result.error });
      continue;
    }
    for (const c of result.items) {
      if (!seenIds.has(c.id)) {
        seenIds.add(c.id);
        allCandidates.push(c);
      }
    }
  }

  return { candidates: allCandidates, errors };
}

module.exports = {
  scanSource,
  scanAllSources,
  normalizeSourceTarget
};
