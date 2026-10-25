const cron = require('node-cron');
const fs = require('fs');
const { getConfig, saveConfig, addToHistory, getHistory, isAlreadyUploaded } = require('./store');
const { scanAllSources } = require('./scanner');
const { selectAndOptimizeVideo, normalizeModelName } = require('./aiEngine');
const { getDynamicSearchQueries, clearTrendCache } = require('./trendEngine');
const { buildCronFromCadence } = require('./cadence');
const { hasAuthConfigError, describeError } = require('./ytdlp');
const { ensureShortsFormat } = require('./shortsFormatter');
const { checkVideoQuality } = require('./qualityChecker');

let activeCronTask = null;
let isCycleRunning = false;
let cycleStartedAt = 0;
const MAX_CYCLE_DURATION_MS = 4 * 60 * 1000;
let lastBusyNoticeAt = 0;
const liveLogs = [];

function addLog(msg, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const entry = { timestamp, message: msg, type };
  liveLogs.push(entry);
  if (liveLogs.length > 200) liveLogs.shift();
  console.log(`[AutoPilot ${timestamp}] ${msg}`);
  return entry;
}

function getRecentLogs() {
  return [...liveLogs];
}

/**
 * Executes a single complete Auto-Pilot curation & upload cycle
 */
async function runAutoPilotCycle({ ytDlpPath, downloadFn, uploadFn, oauth2Client, onEvent }) {
  if (isCycleRunning) {
    if (Date.now() - cycleStartedAt > MAX_CYCLE_DURATION_MS) {
      console.warn('[AutoPilot] Previous cycle exceeded timeout (4m); resetting lock.');
      addLog('⚠️ Previous cycle timed out; resetting lock for new run.', 'warning');
      isCycleRunning = false;
    } else {
      const msg = 'Auto-Pilot cycle is already in progress. Please wait.';
      // With a short cadence this repeats every tick; surface it at most once a minute.
      if (Date.now() - lastBusyNoticeAt > 60 * 1000) {
        lastBusyNoticeAt = Date.now();
        addLog(msg, 'warning');
        onEvent?.('warning', { message: msg });
      } else {
        console.log('[AutoPilot] Cycle still running; skipping this tick.');
      }
      return { ok: false, message: msg };
    }
  }

  isCycleRunning = true;
  cycleStartedAt = Date.now();
  let downloadedFile = null;

  try {
    const notify = (type, message, extra = {}) => {
      addLog(message, type);
      onEvent?.(type, { message, ...extra });
    };

    notify('info', '🚀 Starting AI Auto-Pilot cycle...');

    // 1. Verify YouTube authentication
    if (!oauth2Client?.credentials?.access_token) {
      throw new Error('YouTube is not authenticated. Please click "Connect YouTube" in the UI first.');
    }

    const config = getConfig();
    const maxCandidates = config.maxCandidates || 12;
    const staticSources = [...(config.sources || [])];

    if (staticSources.length === 0 && config.autoTrending === false) {
      throw new Error('No sources available. Enable Auto-Trending or add custom channels/keywords.');
    }

    // ── Calculate Target Percentage & Under-representation Deficit ──────────
    let totalAssignedPct = 0;
    staticSources.forEach(s => {
      s.percentage = Number(s.percentage || s.weight || 0);
      totalAssignedPct += s.percentage;
    });
    if (totalAssignedPct <= 0 && staticSources.length > 0) {
      const equalShare = Math.round(100 / staticSources.length);
      staticSources.forEach(s => { s.percentage = equalShare; });
      totalAssignedPct = 100;
    }

    const pastUploads = getHistory().filter(h => h.status === 'uploaded');
    const recentUploads = pastUploads.slice(0, 20);
    const sourceUploadCounts = {};
    for (const h of recentUploads) {
      const srcName = h.sourceName || h.sourceTitle || '';
      const matched = staticSources.find(s => s.name === srcName || s.url === srcName || (h.sourceUrl && h.sourceUrl.includes(s.url)));
      const key = matched ? matched.name : (srcName || 'Unknown');
      sourceUploadCounts[key] = (sourceUploadCounts[key] || 0) + 1;
    }

    const totalRecent = Math.max(1, recentUploads.length);
    const sourcePriorityBoost = {};
    const underrepresentedSources = [];

    staticSources.forEach(s => {
      const count = sourceUploadCounts[s.name] || 0;
      const actualPct = (count / totalRecent) * 100;
      const targetPct = totalAssignedPct > 0 ? (s.percentage / totalAssignedPct) * 100 : 25;
      const deficit = targetPct - actualPct; // positive means under-represented!
      sourcePriorityBoost[s.name] = deficit;
      if (deficit > 3) {
        underrepresentedSources.push(`"${s.name}" (Target: ${Math.round(targetPct)}%, Recent: ${Math.round(actualPct)}%)`);
      }
    });

    if (underrepresentedSources.length > 0) {
      notify('info', `⚖️ Target Content Balancing: Prioritizing under-represented source(s): ${underrepresentedSources.join(', ')}`);
    }

    // 2. Discover trending topics AND scan configured sources concurrently
    notify('info', `🔥 Scanning ${staticSources.length} configured source(s) with custom percentage targets...`);

    const trendPromise = config.autoTrending !== false
      ? getDynamicSearchQueries({
          model: normalizeModelName(config.geminiModel || 'opencode/glm-5.3-flash-free'),
          count: 3,
          nicheFocus: config.nicheFocus,
          sources: staticSources
        })
      : Promise.resolve([]);

    const staticScanPromise = staticSources.length
      ? scanAllSources(staticSources, ytDlpPath, 20)
      : Promise.resolve({ candidates: [], errors: [] });

    const [dynamicQueries, staticScan] = await Promise.all([trendPromise, staticScanPromise]);

    // Apply priority boost and percentage weights to static candidates
    staticScan.candidates.forEach(c => {
      const boost = sourcePriorityBoost[c.sourceName] || 0;
      c.priorityBoost = boost * 3; // Boost under-represented categories
      const matched = staticSources.find(s => s.name === c.sourceName || s.url === c.sourceName);
      if (matched) {
        c.sourcePercentage = matched.percentage;
      }
    });

    // 3. Scan the discovered trending topics if auto-trending enabled
    const scanErrors = [...staticScan.errors];
    let trendCandidates = [];

    if (dynamicQueries.length > 0) {
      const dynamicSources = dynamicQueries.map(q => ({
        type: 'keyword',
        url: q,
        name: `🔥 Trend: ${q}`,
        percentage: 15
      }));

      notify('info', `🔍 Scanning ${dynamicSources.length} complementary trending topic(s)...`);
      const trendScan = await scanAllSources(dynamicSources, ytDlpPath, 8);
      scanErrors.push(...trendScan.errors);
      trendCandidates = trendScan.candidates;
    }

    // Rank candidates: Prioritize custom sources with highest deficit / weight
    const seenIds = new Set();
    const rankedStatic = [...staticScan.candidates].sort((a, b) => (b.priorityBoost || 0) - (a.priorityBoost || 0));
    const mergedCandidates = [];

    // Add static candidates first (respecting target source percentages)
    for (const c of rankedStatic) {
      if (!seenIds.has(c.id)) {
        seenIds.add(c.id);
        mergedCandidates.push(c);
      }
    }

    // Complement with trending candidates (up to maxCandidates pool)
    for (const c of trendCandidates) {
      if (!seenIds.has(c.id) && mergedCandidates.length < maxCandidates + 4) {
        seenIds.add(c.id);
        mergedCandidates.push(c);
      }
    }

    let candidates = mergedCandidates.slice(0, Math.max(maxCandidates, 12));

    if (candidates.length === 0) {
      // Invalidate the trend cache so old queries don't keep repeating in a loop
      clearTrendCache();

      // If auto-trending is enabled, immediately fetch fresh trending topics and retry scan
      if (config.autoTrending !== false) {
        notify('info', '🔄 Sources exhausted: clearing trend cache and fetching brand-new trending topics...');
        try {
          const freshQueries = await getDynamicSearchQueries({
            model: normalizeModelName(config.geminiModel || 'opencode/glm-5.3-flash-free'),
            count: 5,
            forceRefresh: true,
            nicheFocus: config.nicheFocus,
            sources: staticSources
          });

          if (freshQueries && freshQueries.length > 0) {
            const freshSources = freshQueries.map(q => ({
              type: 'keyword',
              url: q,
              name: `🔥 Trend: ${q}`
            }));
            notify('info', `🔍 Scanning ${freshSources.length} fresh trending topic(s)...`);
            const freshScan = await scanAllSources(freshSources, ytDlpPath, maxCandidates);
            candidates = freshScan.candidates;
            scanErrors.push(...freshScan.errors);
          }
        } catch (freshErr) {
          console.warn('[AutoPilot] Fresh trend retry error:', freshErr.message);
        }
      }

      if (candidates.length === 0) {
        if (scanErrors.length > 0) {
          const actionable = scanErrors.find(e => hasAuthConfigError(e.error));
          const detail = actionable
            ? describeError(actionable.error)
            : `${scanErrors.length} source(s) failed. First error: ${String(scanErrors[0].error).slice(0, 200)}`;
          notify('error', `❌ No candidates: all ${scanErrors.length} source scan(s) failed. ${detail}`);
          return { ok: false, error: detail };
        }
        notify('warning', '⚠️ No new, un-uploaded candidate shorts found. Trend cache cleared for next cycle.');
        return { ok: true, message: 'No new candidate videos found' };
      }
    }

    if (scanErrors.length > 0) {
      const actionable = scanErrors.some(e => hasAuthConfigError(e.error));
      notify('warning', `⚠️ ${scanErrors.length} source(s) failed to scan${actionable ? ' (yt-dlp authentication/cookie problem — check the .env settings)' : ''}.`);
    }

    // Strictly filter out any candidates that have already been uploaded or processed
    const freshCandidates = candidates.filter(c => !isAlreadyUploaded(c.id) && !isAlreadyUploaded(c.url));
    if (freshCandidates.length === 0 && candidates.length > 0) {
      notify('info', 'All scanned candidate shorts have already been uploaded previously. Waiting for next cycle.');
      return { ok: true, message: 'All candidate videos already uploaded' };
    }

    notify('info', `📋 Found ${freshCandidates.length} candidate shorts for evaluation.`);

    // 3. AI Evaluation & Quality Validation Loop
    const modelToUse = normalizeModelName(config.geminiModel || 'opencode/nemotron-3.5-super-vl-free');
    let remainingCandidates = [...freshCandidates];
    let uploadSuccess = false;
    let cycleResult = null;
    let attempts = 0;
    let downloadFailures = 0;
    let qualityRejections = 0;
    let lastDownloadError = '';
    const maxAttempts = Math.min(3, remainingCandidates.length);

    while (remainingCandidates.length > 0 && attempts < maxAttempts) {
      attempts++;
      notify('info', `🧠 Asking AI (${modelToUse}) to evaluate candidates & craft viral title (attempt ${attempts}/${maxAttempts})...`);
      const aiDecision = await selectAndOptimizeVideo(remainingCandidates, null, modelToUse, {
        sources: staticSources,
        underrepresented: underrepresentedSources,
        nicheFocus: config.nicheFocus
      });
      const winner = aiDecision.selectedCandidate;

      // Remove winner from remaining pool so we don't pick it again this cycle
      remainingCandidates = remainingCandidates.filter(c => c.id !== winner.id);

      // Verify winner is not already uploaded before proceeding to download
      if (isAlreadyUploaded(winner.id) || isAlreadyUploaded(winner.url)) {
        notify('warning', `⚠️ "${winner.title}" was already uploaded previously. Skipping duplicate.`);
        continue;
      }

      notify('info', `🎯 Selected candidate: "${winner.title}" [Source: ${winner.sourceName || 'Trending'}] by ${winner.uploader}`);
      notify('info', `💡 AI Reason: ${aiDecision.aiReasoning}`);
      notify('info', `✨ Optimized Title: "${aiDecision.optimizedTitle}"`);

      // 4. Download Video (Fast single pass using cached winner metadata, 100% highest resolution stream)
      notify('progress', `📥 Downloading selected video (${winner.url})...`);
      let downloadedResult = null;
      try {
        downloadedResult = await downloadFn(winner.url, (dlMsg) => {
          notify('progress', dlMsg);
        }, winner);
      } catch (dlErr) {
        downloadFailures++;
        lastDownloadError = dlErr.message;
        notify('warning', `⚠️ Download failed for "${winner.title}": ${dlErr.message}. Skipping to next candidate.`);
        addToHistory({
          id: winner.id,
          sourceUrl: winner.url,
          sourceTitle: winner.title,
          sourceName: winner.sourceName || winner.uploader,
          uploader: winner.uploader,
          status: 'failed',
          rejectReason: `Download failed: ${dlErr.message}`,
          privacy: config.privacy || 'private'
        });
        if (remainingCandidates.length > 0 && attempts < maxAttempts) {
          continue;
        } else {
          break;
        }
      }

      const { filePath } = downloadedResult;
      downloadedFile = filePath;

      // 4b. Strict AI Quality Check (Evaluated directly on downloaded video BEFORE transcoding!)
      notify('progress', `🛡️ Running AI Quality Check on "${winner.title}" (detecting AI slop & on-screen channel watermarks)...`);
      const qualityResult = await checkVideoQuality({
        videoPath: filePath,
        metadata: {
          title: aiDecision.optimizedTitle,
          originalTitle: winner.title,
          description: aiDecision.optimizedDescription,
          uploader: winner.uploader,
          sourceUrl: winner.url
        },
        model: modelToUse,
        onProgress: (qcMsg) => notify('progress', qcMsg)
      });

      if (qualityResult.decision === 'REJECT') {
        qualityRejections++;
        const rejectMsg = `🛑 Video REJECTED by AI Quality Check: ${qualityResult.reason}`;
        notify('warning', rejectMsg);

        // Record in history so it is permanently excluded from future scans
        addToHistory({
          id: winner.id,
          sourceUrl: winner.url,
          sourceTitle: winner.title,
          sourceName: winner.sourceName || winner.uploader,
          uploader: winner.uploader,
          status: 'rejected',
          rejectReason: qualityResult.reason,
          qualityCheck: qualityResult,
          privacy: config.privacy || 'private'
        });

        // Clean up rejected video file before trying next candidate (transcoding was never even started)
        if (downloadedFile && fs.existsSync(downloadedFile)) {
          try {
            fs.unlinkSync(downloadedFile);
            downloadedFile = null;
          } catch { /* ignore */ }
        }

        if (remainingCandidates.length > 0 && attempts < maxAttempts) {
          notify('info', `🔄 Evaluating next best candidate from queue...`);
          continue;
        } else {
          break;
        }
      }

      notify('info', `✅ AI Quality Check passed: ${qualityResult.reason}`);

      // 4c. Enforce Strict YouTube Shorts Format (9:16 Vertical, <= 60s) via Apple Silicon Hardware Encoder
      notify('progress', '🎨 Verifying video format for YouTube Shorts (9:16 vertical, <= 60s)...');
      const finalShortPath = await ensureShortsFormat(filePath, (fmtMsg) => {
        notify('progress', fmtMsg);
      });
      downloadedFile = finalShortPath;

      // 5. Upload to YouTube
      notify('progress', `📤 Uploading to your YouTube channel (${config.privacy || 'private'})...`);
      const uploadResult = await uploadFn(
        finalShortPath,
        {
          title: aiDecision.optimizedTitle,
          description: aiDecision.optimizedDescription,
          privacy: config.privacy || 'private'
        },
        (upMsg) => {
          notify('progress', upMsg);
        }
      );

      // 6. Record in History
      const historyEntry = {
        id: winner.id,
        sourceUrl: winner.url,
        sourceTitle: winner.title,
        sourceName: winner.sourceName || winner.uploader,
        uploader: winner.uploader,
        newVideoId: uploadResult.videoId,
        newVideoUrl: uploadResult.url,
        newTitle: aiDecision.optimizedTitle,
        aiReasoning: aiDecision.aiReasoning,
        qualityCheck: qualityResult,
        status: 'uploaded',
        privacy: config.privacy || 'private'
      };
      addToHistory(historyEntry);

      notify('done', `🎉 Successfully curated, validated & uploaded! Link: ${uploadResult.url}`, {
        videoUrl: uploadResult.url,
        videoId: uploadResult.videoId,
        title: aiDecision.optimizedTitle,
        aiReasoning: aiDecision.aiReasoning
      });

      uploadSuccess = true;
      cycleResult = {
        ok: true,
        result: uploadResult,
        decision: aiDecision,
        qualityCheck: qualityResult
      };
      break;
    }

    if (!uploadSuccess) {
      let failMsg = `⚠️ No videos uploaded in this cycle.`;
      if (downloadFailures > 0 && qualityRejections === 0) {
        failMsg = `⚠️ Video download failed for all candidates (${downloadFailures} failed). ${lastDownloadError ? `Last error: ${lastDownloadError}` : 'Check cookies/connection.'}`;
      } else if (qualityRejections > 0) {
        failMsg = `⚠️ No candidate video passed the AI Quality Check (${qualityRejections} candidate(s) rejected). No videos uploaded.`;
      }
      notify('warning', failMsg);
      return { ok: false, message: failMsg };
    }

    return cycleResult;
  } catch (err) {
    const errorMsg = `❌ Auto-Pilot error: ${err.message}`;
    addLog(errorMsg, 'error');
    onEvent?.('error', { message: errorMsg });
    return { ok: false, error: err.message };
  } finally {
    isCycleRunning = false;
    if (downloadedFile && fs.existsSync(downloadedFile)) {
      try {
        fs.unlinkSync(downloadedFile);
        console.log('[AutoPilot] Cleaned temporary download:', downloadedFile);
      } catch { /* ignore */ }
    }
  }
}

/**
 * Initializes or updates the node-cron scheduled job
 */
function setupScheduler(cronDeps) {
  if (activeCronTask) {
    activeCronTask.stop();
    activeCronTask = null;
    console.log('[AutoPilot] Stopped previous cron task.');
  }

  const config = getConfig();
  if (!config.enabled) {
    console.log('[AutoPilot] Auto-Pilot scheduler is currently DISABLED in config.');
    return;
  }

  // Recompute from cadence so saved schedule values stay in sync
  const derived = config.cadence
    ? buildCronFromCadence(config.cadence)
    : { cron: config.schedule || '0 */12 * * *', label: config.scheduleLabel || 'custom' };
  const expression = derived.cron;

  if (!cron.validate(expression)) {
    console.error(`[AutoPilot] Invalid cron expression: "${expression}"`);
    return;
  }

  console.log(`[AutoPilot] ⏰ Scheduler started with schedule: "${expression}" (${derived.label || 'custom'})`);
  addLog(`⏰ Scheduler active with schedule: "${expression}"`);

  activeCronTask = cron.schedule(expression, async () => {
    console.log('[AutoPilot] ⏰ Cron trigger fired! Running automated cycle...');
    await runAutoPilotCycle(cronDeps);
  });
}

module.exports = {
  runAutoPilotCycle,
  setupScheduler,
  getRecentLogs,
  addLog,
  isBusy: () => isCycleRunning
};
