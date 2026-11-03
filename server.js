require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Auto-Pilot Modules ──────────────────────────────────────────────────
const { getConfig, saveConfig, getHistory, isAlreadyUploaded, addToHistory, invalidateConfigCache, isDailyQuotaReached } = require('./lib/store');
const { runAutoPilotCycle, setupScheduler, getRecentLogs, isBusy, clearCandidatePool } = require('./lib/autopilot');
const { rewriteSingleVideoMetadata, normalizeModelName } = require('./lib/aiEngine');
const { listFreeModels } = require('./lib/aiClient');
const { getScheduleInfo, buildCronFromCadence, calculateNextOptimalPublishSlot, getNextAutoScheduleSlot } = require('./lib/cadence');
const { ensureShortsFormat } = require('./lib/shortsFormatter');
const { applyWatermarkInPlace } = require('./lib/watermark');
const { authArgs, resetAuthArgsCache, describeError } = require('./lib/ytdlp');
const { checkVideoQuality, heuristicQualityCheck } = require('./lib/qualityChecker');
const { createBeatSyncedShort } = require('./lib/beatSyncTranscoder');
const { applyVisualHookInPlace, generateHookText } = require('./lib/visualHook');
const { enhanceForYouTubeShortsInPlace } = require('./lib/localEnhancer');
const {
  COLOR_GRADING_PRESETS,
  getVisualIdentityConfig,
  saveVisualIdentityConfig,
  getActiveBrandProfile,
  applyColorGradeInPlace
} = require('./lib/visualIdentity');

// ── Directories ──────────────────────────────────────────────────────────
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const TOKENS_PATH = path.join(__dirname, 'tokens.json');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR);

function cleanupStaleDownloads() {
  try {
    if (!fs.existsSync(DOWNLOADS_DIR)) return;
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const now = Date.now();
    for (const f of files) {
      const fullPath = path.join(DOWNLOADS_DIR, f);
      const stat = fs.statSync(fullPath);
      // Clean up orphaned .part files or temp mp4 files older than 15 minutes
      if ((f.endsWith('.part') || f.endsWith('.mp4')) && (now - stat.mtimeMs > 15 * 60 * 1000)) {
        try { fs.unlinkSync(fullPath); console.log('[Storage] 🗑️ Cleaned stale download file:', f); } catch {}
      }
    }
  } catch {}
}
cleanupStaleDownloads();

/**
 * Applies the selected Brand Style Profile to a finished vertical Short.
 * Both manual upload and Auto-Pilot call this helper so the channel identity
 * cannot drift between workflows.
 */
function getPipelineBrandProfile() {
  const identity = getVisualIdentityConfig();
  return getActiveBrandProfile(identity);
}

async function applyVisualGradeInPlace(filePath, onProgress) {
  const profile = getPipelineBrandProfile();
  if (!profile || profile.enabled === false) return filePath;
  await applyColorGradeInPlace(filePath, profile.grading, onProgress);
  return filePath;
}

async function applyVisualBrandingInPlace(filePath, onProgress) {
  const profile = getPipelineBrandProfile();
  if (!profile || profile.enabled === false) return filePath;
  const persistent = profile.visibility === 'persistent';
  await applyWatermarkInPlace(filePath, {
    text: `${profile.label} ${profile.brandName}`,
    startTime: profile.startTime,
    duration: persistent ? 58.5 : profile.revealDuration + profile.holdDuration + profile.exitDuration,
    revealDuration: persistent ? 0.05 : profile.revealDuration,
    holdDuration: persistent ? 58.35 : profile.holdDuration,
    wipeDuration: persistent ? 0.1 : profile.exitDuration,
    opacity: profile.opacity,
    yPosition: profile.customPosition?.y || 0.82,
    brand: profile
  }, onProgress);
  return filePath;
}

// ── Resolve yt-dlp binary path ───────────────────────────────────────────
const YT_DLP = (() => {
  const candidates = [
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    'yt-dlp',
  ];
  for (const c of candidates) {
    try {
      require('child_process').execFileSync(c, ['--version'], { timeout: 5000, stdio: 'pipe' });
      console.log(`✅ Found yt-dlp at: ${c}`);
      return c;
    } catch { /* try next */ }
  }
  console.error('❌ yt-dlp not found! Install with: brew install yt-dlp');
  return 'yt-dlp'; // fallback
})();

// ── OAuth2 Client ────────────────────────────────────────────────────────
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
];

// Load saved tokens on startup
if (fs.existsSync(TOKENS_PATH)) {
  try {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
    oauth2Client.setCredentials(tokens);
    console.log('✅ Loaded saved YouTube tokens');
  } catch {
    console.log('⚠️  Could not load saved tokens');
  }
}

// Persist tokens whenever they refresh
oauth2Client.on('tokens', (tokens) => {
  const existing = fs.existsSync(TOKENS_PATH)
    ? JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'))
    : {};
  const merged = { ...existing, ...tokens };
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(merged, null, 2));
  console.log('💾 Tokens saved');
});

// ── Middleware ────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Visual Identity Studio ───────────────────────────────────────────────

app.get('/api/visual-identity', (req, res) => {
  res.json({ ok: true, ...getVisualIdentityConfig(), presets: COLOR_GRADING_PRESETS });
});

app.post('/api/visual-identity', (req, res) => {
  try {
    const saved = saveVisualIdentityConfig(req.body || {});
    res.json({ ok: true, ...saved, presets: COLOR_GRADING_PRESETS });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/visual-identity/profiles', (req, res) => {
  try {
    const current = getVisualIdentityConfig();
    const profile = req.body || {};
    const profiles = current.profiles.filter(item => item.id !== profile.id);
    profiles.push(profile);
    const saved = saveVisualIdentityConfig({ ...current, profiles, activeProfileId: profile.id || current.activeProfileId });
    res.json({ ok: true, ...saved, presets: COLOR_GRADING_PRESETS });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Auth Routes ──────────────────────────────────────────────────────────

// Check if user is authenticated
app.get('/api/auth/status', (req, res) => {
  const hasTokens = oauth2Client.credentials && oauth2Client.credentials.access_token;
  res.json({ authenticated: !!hasTokens });
});

// Start OAuth flow
app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  res.redirect(url);
});

// OAuth callback
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing auth code');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
    console.log('✅ YouTube authenticated successfully');
    res.redirect('/');
  } catch (err) {
    console.error('OAuth error:', err.message);
    res.status(500).send('Authentication failed: ' + err.message);
  }
});

// Disconnect (clear tokens)
app.post('/api/auth/disconnect', (req, res) => {
  oauth2Client.revokeCredentials().catch(() => {});
  oauth2Client.credentials = {};
  if (fs.existsSync(TOKENS_PATH)) fs.unlinkSync(TOKENS_PATH);
  res.json({ ok: true });
});

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Validate that a URL is a supported short-form video URL
 */
function validateUrl(url) {
  const patterns = [
    /^https?:\/\/(www\.)?youtube\.com\/shorts\//,
    /^https?:\/\/youtu\.be\//,
    /^https?:\/\/(www\.)?youtube\.com\/watch\?/,
    /^https?:\/\/(www\.)?instagram\.com\/(reel|reels|p)\//,
    /^https?:\/\/(www\.)?instagram\.com\/stories\//,
  ];
  return patterns.some((p) => p.test(url));
}

/**
 * Download video using yt-dlp in a single optimized pass without compromising resolution or bitrate.
 * Returns { filePath, metadata }
 */
function downloadVideo(url, onProgress, existingMetadata = null) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const outputTemplate = path.join(DOWNLOADS_DIR, `${timestamp}_%(id)s.%(ext)s`);

    const startDownload = (metadata) => {
      onProgress?.('Downloading video in High Quality (1080p60 / 4K)...');

      // Uncompromised studio stream selection: 1080p60 native Shorts resolution sorted by bitrate
      const dlArgs = [
        '--no-warnings',
        '--newline',
        ...authArgs(),
        '--no-playlist',
        '--no-live-from-start',
        '--match-filter', '!is_live & !was_live & live_status =? "not_live"',
        '--max-filesize', '250M', // Protect against runaway live recordings or full movies
        // Do not cap by height: portrait 1080p is 1080x1920 and was being
        // incorrectly downgraded to 608x1080 before the editor ever saw it.
        '-f', 'bv*+ba/b',
        '--format-sort', 'res,fps:60,vcodec:h264,br,size',
        '--merge-output-format', 'mp4',
        '-o', outputTemplate,
        url,
      ];

      const dl = spawn(YT_DLP, dlArgs);
      let dlStderr = '';

      // 90-second download watchdog: aborts runaway downloads (e.g. infinite live streams)
      const downloadTimer = setTimeout(() => {
        try {
          dl.kill('SIGKILL');
          console.warn('[Downloader] ⏱️ Download timed out after 90s — aborting runaway stream.');
        } catch {}
      }, 90000);

      dl.stdout.on('data', (data) => {
        const line = data.toString().trim();
        const match = line.match(/(\d+\.?\d*)%/);
        if (match) {
          onProgress?.(`Downloading: ${match[1]}%`);
        }
      });

      dl.stderr.on('data', (data) => {
        dlStderr += data.toString();
      });

      dl.on('error', (err) => {
        clearTimeout(downloadTimer);
        reject(new Error('Failed to spawn yt-dlp: ' + err.message));
      });

      dl.on('close', (code) => {
        clearTimeout(downloadTimer);
        if (code !== 0) {
          console.error('yt-dlp download stderr:', dlStderr);
          // Clean up any partial files
          try {
            fs.readdirSync(DOWNLOADS_DIR)
              .filter(f => f.startsWith(`${timestamp}_`) && f.endsWith('.part'))
              .forEach(f => fs.unlinkSync(path.join(DOWNLOADS_DIR, f)));
          } catch {}
          return reject(new Error('Download failed: ' + describeError(dlStderr || `exit code ${code}`)));
        }

        // Find the downloaded file
        const possibleFiles = fs.readdirSync(DOWNLOADS_DIR)
          .filter(f => f.startsWith(`${timestamp}_`) && !f.endsWith('.part'))
          .map(f => path.join(DOWNLOADS_DIR, f));

        if (possibleFiles.length === 0) {
          // Fallback: look for any file with the video id
          const fallbackFiles = fs.readdirSync(DOWNLOADS_DIR)
            .filter(f => f.includes(metadata.id) && !f.endsWith('.part'))
            .map(f => path.join(DOWNLOADS_DIR, f));

          if (fallbackFiles.length === 0) {
            return reject(new Error('Downloaded file not found on disk'));
          }
          return resolve({ filePath: fallbackFiles[0], metadata });
        }

        resolve({
          filePath: possibleFiles[0],
          metadata,
        });
      });
    };

    // If metadata was already provided (e.g. from AutoPilot scan), skip the extra network metadata call!
    if (existingMetadata && existingMetadata.id) {
      onProgress?.(`Found: "${existingMetadata.title || 'Video'}"`);
      return startDownload(existingMetadata);
    }

    // Otherwise, fetch metadata quickly in single pass
    const metaArgs = [
      '--no-warnings',
      '--skip-download',
      ...authArgs(),
      '--print', '%(title)s',
      '--print', '%(id)s',
      '--print', '%(ext)s',
      '--print', '%(uploader)s',
      '--print', '%(channel_url)s',
      '--print', '%(description).300s',
      '--no-playlist',
      url,
    ];

    onProgress?.('Fetching video info (Highest Quality Stream)...');

    execFile(YT_DLP, metaArgs, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('yt-dlp meta error:', err.message, stderr);
        return reject(new Error('Failed to fetch video info. Details: ' + describeError(stderr || err.message)));
      }

      const lines = stdout.trim().split('\n');
      const title = lines[0] || 'Untitled';
      const id = lines[1] || 'unknown';
      const ext = lines[2] || 'mp4';
      const uploader = lines[3] || 'Creator';
      const channelUrl = lines[4] || '';
      const description = lines.slice(5).join('\n') || '';

      onProgress?.(`Found: "${title}" by ${uploader}`);
      startDownload({ title, id, ext, uploader, channelUrl, description, sourceUrl: url });
    });
  });
}

/**
 * Upload video to YouTube
 */
async function uploadToYouTube(filePath, metadata, onProgress) {
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const fileSize = fs.statSync(filePath).size;

  onProgress?.('Uploading to YouTube...');

    const isAnimeOrEdit = /anime|edit|edits|manga|marvel|cinematic|film|animation|solo leveling|attack on titan|jujutsu|demon slayer/i.test(`${metadata.title} ${metadata.description || ''}`);
    const isGaming = /gta|game|gaming|gameplay|clutch|ps5|xbox|unreal|valorant|minecraft|cod|fortnite|wukong|esports/i.test(`${metadata.title} ${metadata.description || ''}`);
    const categoryId = isAnimeOrEdit ? '1' : (isGaming ? '20' : '1'); // Default '1' (Film & Animation) for Anime/Marvel edits

    // Build publishing status respecting user's privacy selection (public, unlisted, private, or scheduled)
    const statusObj = {
      selfDeclaredMadeForKids: false
    };

    const requestedPrivacy = (metadata.privacy || 'scheduled').toLowerCase();
    if (metadata.publishAt || requestedPrivacy === 'scheduled') {
      const cfg = getConfig ? getConfig() : null;
      let spacingHours = 5;
      if (cfg && cfg.cadence) {
        if (cfg.cadence.mode === 'interval' && cfg.cadence.intervalValue) {
          spacingHours = parseInt(cfg.cadence.intervalValue, 10) || 5;
        } else if (cfg.cadence.preset === 'every-8h') {
          spacingHours = 8;
        } else if (cfg.cadence.preset === 'every-12h') {
          spacingHours = 12;
        } else if (cfg.cadence.preset === 'every-4h') {
          spacingHours = 4;
        }
      }
      const scheduledTime = metadata.publishAt || getNextAutoScheduleSlot({
        history: getHistory(),
        bufferHours: spacingHours,
        spacingHours: spacingHours
      });
      statusObj.privacyStatus = 'private';
      statusObj.publishAt = scheduledTime;
      console.log(`[YouTube] 📅 Auto-scheduling publication for: ${scheduledTime} (${spacingHours}h spacing, held as Private on YouTube until release)`);
    } else {
      statusObj.privacyStatus = requestedPrivacy === 'public' ? 'public' : (requestedPrivacy === 'unlisted' ? 'unlisted' : 'private');
      console.log(`[YouTube] 🚀 Publishing with privacy status: ${statusObj.privacyStatus}`);
    }

    try {
      const res = await youtube.videos.insert({
        part: 'snippet,status',
        requestBody: {
          snippet: {
            title: metadata.title.substring(0, 100),
            description: metadata.description || '',
            categoryId: categoryId,
          },
          status: statusObj,
        },
        media: {
          body: fs.createReadStream(filePath),
        },
      }, {
        onUploadProgress: (evt) => {
          const pct = Math.round((evt.bytesRead / fileSize) * 100);
          if (pct >= 100) {
            onProgress?.('Uploading to YouTube: 100% (Finalizing upload on YouTube servers, awaiting confirmation...)');
          } else {
            onProgress?.(`Uploading to YouTube: ${pct}%`);
          }
        },
      });

      const videoId = res.data.id;

      // Auto-post first comment (questionHook) to jumpstart viewer comment velocity
      const questionHook = (metadata.questionHook || '').trim();
      if (videoId && questionHook) {
        try {
          onProgress?.(`Auto-posting top question comment: "${questionHook}"...`);
          await youtube.commentThreads.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                videoId: videoId,
                topLevelComment: {
                  snippet: {
                    textOriginal: questionHook,
                  },
                },
              },
            },
          });
          console.log(`[YouTube] 💬 Auto-posted first comment: "${questionHook}"`);
        } catch (commentErr) {
          console.warn(`[YouTube] ⚠️ Could not auto-post first comment (${commentErr.message}), continuing.`);
        }
      }

      return {
        videoId: res.data.id,
        url: `https://www.youtube.com/watch?v=${res.data.id}`,
        title: res.data.snippet?.title,
        publishAt: statusObj.publishAt || null,
        privacy: statusObj.privacyStatus
      };
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      const errors = err.errors || [];
      const reasons = errors.map(e => (e.reason || '').toLowerCase());
      const isQuota = (
        reasons.includes('quotaexceeded') ||
        reasons.includes('uploadlimitexceeded') ||
        reasons.includes('dailyuploadlimitexceeded') ||
        msg.includes('quotaexceeded') ||
        msg.includes('upload limit exceeded') ||
        msg.includes('daily upload limit exceeded') ||
        (err.code === 403 && msg.includes('quota'))
      );
      if (isQuota) {
        const quotaErr = new Error('Daily YouTube API upload quota reached (10,000 units / ~6 uploads per day). YouTube resets daily quota at midnight Pacific Time (PT).');
        quotaErr.isQuotaExceeded = true;
        quotaErr.code = 403;
        throw quotaErr;
      }
      throw err;
    }
}

// ── API Routes ───────────────────────────────────────────────────────────

// SSE endpoint for upload with progress
// IMPORTANT: Always respond with SSE so EventSource on the frontend can read it
app.get('/api/upload', async (req, res) => {
  // Set up SSE headers FIRST — before any validation — so EventSource can read errors
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const sendEvent = (type, data) => {
    try {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    } catch { /* client disconnected */ }
  };

  const url = req.query.url;
  const title = req.query.title;
  const description = req.query.description;
  const privacy = req.query.privacy || 'scheduled';
  const publishAt = req.query.publishAt || null;

  // Validate — send errors as SSE events
  if (!url) {
    sendEvent('error', { message: 'Missing URL. Please paste a video URL.' });
    return res.end();
  }
  if (!validateUrl(url)) {
    sendEvent('error', { message: 'Unsupported URL. Please provide a YouTube Shorts or Instagram Reels URL.' });
    return res.end();
  }
  if (!oauth2Client.credentials?.access_token) {
    sendEvent('error', { message: 'Not authenticated. Please connect your YouTube account first.' });
    return res.end();
  }

  // Duplicate upload check
  if (isAlreadyUploaded(url)) {
    sendEvent('error', { message: 'This video has already been uploaded previously. Skipping duplicate upload.' });
    return res.end();
  }

  // Daily API Quota Budget Guard
  const quotaStatus = isDailyQuotaReached();
  if (quotaStatus.reached) {
    sendEvent('error', { message: `🛑 Daily YouTube API upload quota limit reached (${quotaStatus.count}/${quotaStatus.limit} uploads today). Uploads will resume after midnight Pacific Time (PT).` });
    return res.end();
  }

  let downloadedFile = null;

  try {
    // Step 1: Download
    sendEvent('progress', { message: 'Starting download...' });
    const { filePath, metadata } = await downloadVideo(url, (msg) => {
      sendEvent('progress', { message: msg });
    });
    downloadedFile = filePath;

    let finalTitle = title ? title.trim() : '';
    let finalDescription = description ? description.trim() : '';
    const config = getConfig();

    // Step 2: Run AI Metadata Generation & AI Quality Check concurrently
    sendEvent('progress', { message: '⚡ Running AI Title/Description Optimization & AI Quality Check in parallel...' });

    const metadataPromise = (async () => {
      if (finalTitle && finalDescription) {
        return { title: finalTitle, description: finalDescription };
      }
      try {
        const aiEnhanced = await rewriteSingleVideoMetadata(
          metadata,
          null, // gateway needs no API key; free-model chain includes automatic fallbacks
          normalizeModelName(config.geminiModel || 'opencode/glm-5.3-flash-free')
        );
        return {
          title: finalTitle || aiEnhanced.optimizedTitle,
          description: finalDescription || aiEnhanced.optimizedDescription,
          questionHook: aiEnhanced.questionHook || ''
        };
      } catch (err) {
        console.warn('AI enhancement fallback:', err.message);
        throw err; // Never upload fallback strings when AI enhancement fails
      }
    })();

    const qualityPromise = (async () => {
      const modelToUse = normalizeModelName(config.geminiModel || 'opencode/nemotron-3.5-super-vl-free');
      return await checkVideoQuality({
        videoPath: filePath,
        metadata: {
          title: finalTitle || metadata.title,
          originalTitle: metadata.title,
          description: finalDescription || metadata.description,
          originalDescription: metadata.description,
          uploader: metadata.uploader
        },
        model: modelToUse,
        onProgress: (qcMsg) => sendEvent('progress', { message: qcMsg })
      });
    })();

    const [enhancedMeta, qualityResult] = await Promise.all([metadataPromise, qualityPromise]);
    finalTitle = enhancedMeta.title;
    finalDescription = enhancedMeta.description;

    const uploadMetadata = {
      title: finalTitle.substring(0, 100),
      description: finalDescription,
      questionHook: enhancedMeta.questionHook,
      privacy,
      publishAt,
    };

    sendEvent('progress', { message: `Optimized Title: "${uploadMetadata.title}"` });

    if (qualityResult.decision === 'REJECT') {
      console.warn('[Server] Manual upload rejected by AI Quality Check:', qualityResult.reason);
      sendEvent('error', {
        message: `Upload rejected by AI Quality Check: ${qualityResult.reason}`,
        qualityCheck: qualityResult
      });
      return;
    }

    sendEvent('progress', { message: `✅ AI Quality Check passed: ${qualityResult.reason}` });

    let intermediateFile = filePath;

    // Step 2b: Beat-Sync Phonk Audio Mixing (if enabled or default)
    if (config.enableBeatSync !== false) {
      try {
        sendEvent('progress', { message: '🎵 Applying beat-sync Phonk mixing (100% music + 18% dialogue ducking)...' });
        const beatResult = await createBeatSyncedShort(intermediateFile, {}, (msg) => sendEvent('progress', { message: msg }));
        if (beatResult?.outputPath && fs.existsSync(beatResult.outputPath)) {
          intermediateFile = beatResult.outputPath;
          downloadedFile = intermediateFile;
          sendEvent('progress', { message: `✅ Beat-sync complete with track: "${beatResult.songName}"` });
        }
      } catch (beatErr) {
        console.warn('[Server] ⚠️ Beat sync error, continuing with original audio:', beatErr.message);
        sendEvent('progress', { message: `⚠️ Beat-sync skipped: ${beatErr.message}` });
      }
    }

    // Step 2c: Ensure Strict 9:16 Vertical Shorts Format (Duration <= 59.5s, -14 LUFS, Seamless Loop)
    sendEvent('progress', { message: '🎨 Verifying video format for YouTube Shorts (9:16 vertical, <= 59.5s, -14 LUFS)...' });
    const finalShortPath = await ensureShortsFormat(intermediateFile, (fmtMsg) => {
      sendEvent('progress', { message: fmtMsg });
    }, { enableEndCard: config.enableEndCard === true });
    downloadedFile = finalShortPath;

    // Step 2d: Apply the selected cinematic grade before overlays are composited.
    try {
      await applyVisualGradeInPlace(finalShortPath, (identityMsg) => {
        sendEvent('progress', { message: identityMsg });
      });
      sendEvent('progress', { message: '✅ Cinematic color grade applied.' });
    } catch (gradeErr) {
      console.warn('[Server] ⚠️ Color grade failed (continuing with formatted video):', gradeErr.message);
      sendEvent('progress', { message: `⚠️ Color grade could not be applied: ${gradeErr.message}` });
    }

    // Step 2e: Apply 0-2.5s Dynamic Visual Hook Banner (Upper-third safe zone)
    if (config.enableVisualHook !== false) {
      try {
        const hookText = enhancedMeta.visualHook || generateHookText({
          title: uploadMetadata.title,
          character: enhancedMeta.character,
          franchise: enhancedMeta.franchise
        });
        sendEvent('progress', { message: `⚡ Applying 0-2.5s visual hook banner: "${hookText}"...` });
        await applyVisualHookInPlace(finalShortPath, {
          text: hookText,
          duration: 2.5,
          yPosition: 0.16
        }, (hkMsg) => sendEvent('progress', { message: hkMsg }));
        sendEvent('progress', { message: `✅ Visual hook applied: "${hookText}"` });
      } catch (hookErr) {
        console.warn('[Server] ⚠️ Visual hook failed (continuing without):', hookErr.message);
      }
    }

    // Step 2f: Apply reusable DITCH_67 channel branding after the hook.
    try {
      await applyVisualBrandingInPlace(finalShortPath, (identityMsg) => {
        sendEvent('progress', { message: identityMsg });
      });
      sendEvent('progress', { message: '✅ Visual Identity Studio branding applied.' });
    } catch (identityErr) {
      console.warn('[Server] ⚠️ Branding failed (continuing without):', identityErr.message);
      sendEvent('progress', { message: `⚠️ Branding could not be applied: ${identityErr.message}` });
    }

    // Final local, Topaz-style finishing pass. This is intentionally last so
    // overlays remain crisp and YouTube receives one high-bitrate 1440p Short.
    if (config.enableLocalEnhancement !== false) {
      try {
        await enhanceForYouTubeShortsInPlace(finalShortPath, (enhanceMsg) => {
          sendEvent('progress', { message: enhanceMsg });
        });
        sendEvent('progress', { message: '✅ Local high-quality Shorts enhancement applied.' });
      } catch (enhanceErr) {
        console.warn('[Server] ⚠️ Local enhancement failed (uploading existing render):', enhanceErr.message);
        sendEvent('progress', { message: `⚠️ Local enhancement skipped: ${enhanceErr.message}` });
      }
    }

    // Step 3: Upload to YouTube
    const result = await uploadToYouTube(finalShortPath, uploadMetadata, (msg) => {
      sendEvent('progress', { message: msg });
    });

    // Record manual upload in history to prevent duplicates
    addToHistory({
      id: metadata.id || url,
      sourceUrl: url,
      sourceTitle: metadata.title,
      uploader: metadata.uploader,
      newVideoId: result.videoId,
      newVideoUrl: result.url,
      newTitle: result.title,
      status: 'uploaded',
      privacy: result.privacy || privacy,
      publishAt: result.publishAt || null,
      qualityCheck: qualityResult
    });

    const completionMsg = result.publishAt
      ? `🎉 Upload complete! Held as Private on YouTube, auto-scheduled to go Public at ${new Date(result.publishAt).toLocaleString()}`
      : '🎉 Upload complete!';

    sendEvent('done', {
      message: completionMsg,
      videoUrl: result.url,
      videoId: result.videoId,
      title: result.title,
      publishAt: result.publishAt || null,
      privacy: result.privacy || privacy
    });
  } catch (err) {
    console.error('Upload pipeline error:', err);
    if (err.isQuotaExceeded || String(err.message).includes('quota')) {
      sendEvent('error', {
        message: '🛑 YouTube Daily Upload Quota Exceeded (10,000 units / ~6 uploads per day). YouTube quota resets daily at midnight Pacific Time (PT).'
      });
    } else {
      sendEvent('error', { message: err.message || 'An unexpected error occurred.' });
    }
  } finally {
    // Clean up downloaded file
    if (downloadedFile && fs.existsSync(downloadedFile)) {
      try {
        fs.unlinkSync(downloadedFile);
        console.log('🗑️  Cleaned up:', downloadedFile);
      } catch { /* ignore */ }
    }
    res.end();
  }
});

// ── Auto-Pilot API Routes ────────────────────────────────────────────────

// List available OpenCode free models (dynamic discovery + health status) for the UI
app.get('/api/ai/models', async (req, res) => {
  try {
    const models = await listFreeModels('metadata');
    const config = getConfig();
    res.json({
      ok: true,
      models,
      configured: normalizeModelName(config.geminiModel)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get Auto-Pilot configuration & status
app.get('/api/autopilot/config', (req, res) => {
  // Reload .env so manual edits in .env are picked up immediately
  require('dotenv').config({ override: true });
  invalidateConfigCache();
  resetAuthArgsCache();
  const config = getConfig();
  const scheduleInfo = getScheduleInfo(config.schedule, config);
  res.json({
    config,
    scheduleInfo,
    isBusy: isBusy()
  });
});

// Live Preview & Validate Cadence
app.post('/api/autopilot/cadence-preview', (req, res) => {
  try {
    const { cron, label, error } = buildCronFromCadence(req.body);
    const scheduleInfo = getScheduleInfo(cron, { scheduleLabel: label });
    res.json({ ok: !error, cron, label, error, scheduleInfo });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Update Auto-Pilot configuration
app.post('/api/autopilot/config', (req, res) => {
  try {
    clearCandidatePool();
    const updated = saveConfig(req.body);
    setupScheduler({
      ytDlpPath: YT_DLP,
      downloadFn: downloadVideo,
      uploadFn: uploadToYouTube,
      oauth2Client
    });
    const scheduleInfo = getScheduleInfo(updated.schedule, updated);
    res.json({ ok: true, config: updated, scheduleInfo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get upload history
app.get('/api/autopilot/history', (req, res) => {
  res.json(getHistory());
});

// Get recent logs
app.get('/api/autopilot/logs', (req, res) => {
  res.json(getRecentLogs());
});

// Run Auto-Pilot cycle on demand with live SSE streaming
app.get('/api/autopilot/run', (req, res) => {
  require('dotenv').config({ override: true });
  invalidateConfigCache();
  resetAuthArgsCache();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const sendEvent = (type, data) => {
    try {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    } catch { /* disconnected */ }
  };

  runAutoPilotCycle({
    ytDlpPath: YT_DLP,
    downloadFn: downloadVideo,
    uploadFn: uploadToYouTube,
    oauth2Client,
    onEvent: (type, payload) => {
      sendEvent(type, payload);
    }
  }).then((result) => {
    sendEvent('completed', result);
    res.end();
  }).catch((err) => {
    sendEvent('error', { message: err.message });
    res.end();
  });
});

// Preview AI title rewriting & 25-30 hashtags generation for a URL
app.post('/api/ai/preview-metadata', async (req, res) => {
  const { url } = req.body;
  if (!url || !validateUrl(url)) {
    return res.status(400).json({ error: 'A valid YouTube Shorts or Instagram Reels URL is required' });
  }

  require('dotenv').config({ override: true });
  invalidateConfigCache();
  resetAuthArgsCache();

  const metaArgs = [
    '--no-warnings',
    '--skip-download',
    ...authArgs(),
    '--print', '%(title)s',
    '--print', '%(uploader)s',
    '--print', '%(description).300s',
    '--no-playlist',
    url
  ];

  execFile(YT_DLP, metaArgs, { timeout: 35000 }, async (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to extract video details: ' + describeError(stderr || err.message) });
    }

    const lines = stdout.trim().split('\n');
    const originalTitle = lines[0] || 'Viral Video';
    const uploader = lines[1] || 'Creator';
    const originalDesc = lines.slice(2).join('\n') || '';

    const config = getConfig();
    try {
      const enhanced = await rewriteSingleVideoMetadata(
        { title: originalTitle, uploader, description: originalDesc },
        null, // gateway needs no API key; free-model chain includes automatic fallbacks
        normalizeModelName(config.geminiModel || 'opencode/glm-5.3-flash-free')
      );

      res.json({
        ok: true,
        originalTitle,
        optimizedTitle: enhanced.optimizedTitle,
        optimizedDescription: enhanced.optimizedDescription
      });
    } catch (aiErr) {
      res.status(500).json({ error: 'AI generation error: ' + aiErr.message });
    }
  });
});

// Quality Check Preview endpoint
app.post('/api/quality/check', async (req, res) => {
  const { url, title, description, uploader } = req.body;
  const config = getConfig();
  const modelToUse = normalizeModelName(config.geminiModel || 'opencode/nemotron-3.5-super-vl-free');

  if (!url && !title) {
    return res.status(400).json({ error: 'Either url or title is required for quality check' });
  }

  try {
    let checkTitle = title || '';
    let checkDesc = description || '';
    let checkUploader = uploader || '';
    let videoFilePath = null;

    if (url && validateUrl(url)) {
      // Extract metadata via yt-dlp
      const meta = await new Promise((resolve) => {
        execFile(YT_DLP, [
          '--no-warnings',
          '--skip-download',
          ...authArgs(),
          '--print', '%(title)s',
          '--print', '%(uploader)s',
          '--print', '%(description).300s',
          '--no-playlist',
          url
        ], { timeout: 30000 }, (err, stdout) => {
          if (err || !stdout) return resolve(null);
          const lines = stdout.trim().split('\n');
          resolve({
            title: lines[0] || '',
            uploader: lines[1] || '',
            description: lines.slice(2).join('\n') || ''
          });
        });
      });

      if (meta) {
        if (!checkTitle) checkTitle = meta.title;
        if (!checkUploader) checkUploader = meta.uploader;
        if (!checkDesc) checkDesc = meta.description;
      }
    }

    const checkResult = await checkVideoQuality({
      videoPath: videoFilePath || '',
      metadata: {
        title: checkTitle,
        description: checkDesc,
        uploader: checkUploader,
        sourceUrl: url || ''
      },
      model: modelToUse
    });

    res.json({
      ok: true,
      decision: checkResult.decision,
      isAiSlop: checkResult.isAiSlop,
      hasPersonName: checkResult.hasPersonName,
      detectedNames: checkResult.detectedNames,
      reason: checkResult.reason,
      usedModel: checkResult.usedModel
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Start Server ─────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════╗
║   YouTube Shorts Uploader                      ║
║   Running at: http://localhost:${PORT}            ║
╚════════════════════════════════════════════════╝
  `);

    if (!process.env.CLIENT_ID || process.env.CLIENT_ID === 'your_client_id_here') {
      console.log('⚠️  No OAuth credentials found!');
      console.log('   Copy .env.example to .env and fill in your CLIENT_ID and CLIENT_SECRET');
      console.log('   Get them from: https://console.cloud.google.com/apis/credentials\n');
    }

    // Initialize Auto-Pilot scheduler
    setupScheduler({
      ytDlpPath: YT_DLP,
      downloadFn: downloadVideo,
      uploadFn: uploadToYouTube,
      oauth2Client
    });
  });
}

module.exports = { app, oauth2Client };

