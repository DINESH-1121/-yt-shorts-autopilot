/**
 * Local-only verification renderer for a downloaded YouTube Short.
 * This file intentionally contains no YouTube upload/API calls.
 */
const fs = require('fs');
const path = require('path');

const { ensureShortsFormat, probeVideo } = require('../lib/shortsFormatter');
const { createBeatSyncedShort } = require('../lib/beatSyncTranscoder');
const { applyVisualHookInPlace } = require('../lib/visualHook');
const { applyWatermarkInPlace } = require('../lib/watermark');
const { getVisualIdentityConfig, getActiveBrandProfile, applyColorGradeInPlace } = require('../lib/visualIdentity');
const { enhanceForYouTubeShortsInPlace } = require('../lib/localEnhancer');

const projectRoot = path.join(__dirname, '..');
const downloads = path.join(projectRoot, 'downloads');
const source = path.join(downloads, 'verification_WOvcpQMXpvQ_source.mp4');
const finalOutput = path.join(downloads, 'verification_WOvcpQMXpvQ_final.mp4');

async function main() {
  if (!fs.existsSync(source)) throw new Error(`Missing downloaded source: ${source}`);
  if (fs.existsSync(finalOutput)) fs.unlinkSync(finalOutput);

  let current = source;
  const sourceInfo = await probeVideo(current);
  console.log(`Source: ${sourceInfo.width}x${sourceInfo.height}, ${sourceInfo.fps} fps, ${sourceInfo.duration.toFixed(2)}s`);

  const beat = await createBeatSyncedShort(current, {
    duration: Math.min(sourceInfo.duration, 59.5),
    ducking: 0.18,
    phonkVolume: 1.0,
    bpm: 130.0
  }, msg => console.log('[beat-sync]', msg));
  current = beat.outputPath;

  current = await ensureShortsFormat(current, msg => console.log('[formatter]', msg), { enableEndCard: false });

  const identity = getVisualIdentityConfig();
  const profile = getActiveBrandProfile(identity);
  await applyColorGradeInPlace(current, profile.grading, msg => console.log('[grade]', msg));

  await applyVisualHookInPlace(current, {
    text: 'Doom Claims Victory 🔥💀',
    duration: 2.5,
    yPosition: 0.16
  });

  if (profile && profile.enabled !== false) {
    await applyWatermarkInPlace(current, {
      text: `${profile.label || ''} ${profile.brandName || ''}`.trim(),
      startTime: profile.startTime,
      duration: profile.revealDuration + profile.holdDuration + profile.exitDuration,
      revealDuration: profile.revealDuration,
      holdDuration: profile.holdDuration,
      wipeDuration: profile.exitDuration,
      opacity: profile.opacity,
      yPosition: profile.customPosition?.y || 0.82,
      brand: profile
    }, msg => console.log('[branding]', msg));
  }

  await enhanceForYouTubeShortsInPlace(current, msg => console.log('[enhancer]', msg));
  fs.renameSync(current, finalOutput);

  const info = await probeVideo(finalOutput);
  const stat = fs.statSync(finalOutput);
  console.log(`\nFINAL OUTPUT (NO UPLOAD): ${finalOutput}`);
  console.log(`Video: ${info.width}x${info.height}, ${info.fps} fps, ${info.duration.toFixed(2)}s`);
  console.log(`Audio: ${info.hasAudio ? 'present' : 'missing'}`);
  console.log(`Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(err => {
  console.error('Local verification render failed:', err);
  process.exit(1);
});
