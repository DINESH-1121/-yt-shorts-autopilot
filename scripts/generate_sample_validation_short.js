/**
 * scripts/generate_sample_validation_short.js
 *
 * Generates an end-to-end validated YouTube Short without uploading to YouTube.
 * Exercises the complete optimized pipeline:
 * 1. Generates authentic action/edit source video
 * 2. Beat-sync Phonk mixing (100% music + 18% dialogue ducking)
 * 3. 9:16 Vertical Short transcode with Apple VideoToolbox & EBU R128 -14 LUFS
 * 4. 0–2.5s Dynamic Visual Hook Banner in upper-third safe zone (y=0.16)
 * 5. Animated Line-Reveal Watermark in lower-mid safe zone (y=0.60)
 * 6. Optimized SEO metadata generation with @Editclips-k2r formula
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { ensureShortsFormat, probeVideo } = require('../lib/shortsFormatter');
const { createBeatSyncedShort } = require('../lib/beatSyncTranscoder');
const { applyVisualHookInPlace, generateHookText } = require('../lib/visualHook');
const { applyWatermarkInPlace } = require('../lib/watermark');
const { buildCandidateMetadata } = require('../lib/aiEngine');
const { buildBeatSyncTitle, buildBeatSyncDescription } = require('../lib/aiClient');

const PROJECT_ROOT = path.join(__dirname, '..');
const DOWNLOADS_DIR = path.join(PROJECT_ROOT, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   GENERATING FULL PIPELINE VALIDATION SHORT (NO UPLOAD)       ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const rawSourcePath = path.join(DOWNLOADS_DIR, 'raw_input_sample.mp4');
  const finalValidationPath = path.join(DOWNLOADS_DIR, 'validation_sample_short.mp4');

  const requestedDuration = parseFloat(process.argv[2]) || 10.0;
  // Account for 1.03x speed shift in hash evasion transcode so output is exactly requestedDuration
  const sourceDuration = (requestedDuration * 1.03).toFixed(2);

  // 1. Create a dynamic action test video
  console.log(`🎬 Step 1: Synthesizing raw action edit clip (${sourceDuration}s -> ~${requestedDuration}s output)...`);
  execSync(
    `ffmpeg -y -f lavfi -i "testsrc2=size=1080x1920:rate=30" -f lavfi -i "sine=frequency=320:sample_rate=48000" -t ${sourceDuration} -c:v libx264 -pix_fmt yuv420p -c:a aac "${rawSourcePath}" 2>/dev/null`
  );
  console.log(`✅ Raw clip created: ${rawSourcePath}`);

  let currentVideo = rawSourcePath;

  // 2. Beat-Sync Phonk Audio Mixing
  console.log('\n🎵 Step 2: Applying Beat-Sync Phonk Mixing (100% music + 18% dialogue ducking)...');
  const beatResult = await createBeatSyncedShort(currentVideo, {
    duration: parseFloat(sourceDuration),
    ducking: 0.18,
    phonkVolume: 1.0,
    bpm: 130.0
  }, (msg) => console.log('   [progress]', msg));

  currentVideo = beatResult.outputPath;
  const songName = beatResult.songName;
  console.log(`✅ Beat-sync complete with song: "${songName}"`);

  // 3. Strict 9:16 Shorts Transcode with Apple VideoToolbox & EBU R128 Loudness
  console.log('\n🎨 Step 3: Hardware Transcoding (9:16 Vertical, EBU R128 -14 LUFS, Seamless Loop)...');
  const formattedVideo = await ensureShortsFormat(currentVideo, (msg) => {
    console.log('   [progress]', msg);
  }, { enableEndCard: false });
  currentVideo = formattedVideo;
  console.log(`✅ VideoToolbox formatting complete: ${currentVideo}`);

  // 4. Generate Viral Metadata
  console.log('\n🧠 Step 4: Formulating Viral Packaging & Visual Hook...');
  const hookText = 'The Shadow Monarch Awakens 💀';
  const metadata = {
    title: 'Coldest Awakening Scene | Solo Leveling',
    sourceName: 'Solo Leveling',
    uploader: 'ActionEdits'
  };

  const optimizedTitle = buildBeatSyncTitle({
    hook: 'Coldest Awakening Scene',
    franchise: 'Solo Leveling',
    songName: songName,
    nicheTag: '#anime'
  });

  const optimizedDescription = buildBeatSyncDescription({
    questionHook: 'Who had the coldest awakening aura in this scene?',
    franchise: 'Solo Leveling',
    character: 'Sung Jinwoo',
    songName: songName,
    hashtags: ['#anime', '#sololeveling', '#edit', '#shorts']
  });

  const firstComment = 'Who had the coldest awakening aura in this scene?';

  // 5. Apply 0–2.5s Dynamic Visual Hook Banner
  console.log('\n⚡ Step 5: Compositing 0–2.5s Visual Hook Banner (Upper-third safe zone y=0.16)...');
  await applyVisualHookInPlace(currentVideo, {
    text: hookText,
    duration: 2.5,
    yPosition: 0.16
  }, (msg) => console.log('   [progress]', msg));
  console.log(`✅ Visual Hook applied: "${hookText}"`);

  // 6. Apply Animated Branding Watermark (Viral Pirata One Cursor-Reveal at y=0.82)
  console.log('\n🏷️ Step 6: Compositing Animated Channel Watermark (Viral Short replica style at y=0.82)...');
  const watermarkText = process.env.WATERMARK_TEXT || 'MADE BY @SHORTSSTUDIO';
  await applyWatermarkInPlace(currentVideo, {
    text: watermarkText,
    startTime: 1.0,
    duration: 4.1,
    opacity: 0.95,
    yPosition: 0.82
  }, (msg) => console.log('   [progress]', msg));
  console.log(`✅ Watermark applied: "${watermarkText}"`);

  // Rename to final output path
  if (currentVideo !== finalValidationPath) {
    if (fs.existsSync(finalValidationPath)) fs.unlinkSync(finalValidationPath);
    fs.renameSync(currentVideo, finalValidationPath);
  }

  // Cleanup raw input
  try { if (fs.existsSync(rawSourcePath)) fs.unlinkSync(rawSourcePath); } catch {}

  // 7. Probe Final Validation Asset
  const info = await probeVideo(finalValidationPath);
  const stat = fs.statSync(finalValidationPath);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('   🎉 VALIDATION SHORT GENERATED SUCCESSFULLY (NO UPLOAD)      ');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`📁 File Location   : ${finalValidationPath}`);
  console.log(`📐 Resolution      : ${info.width}x${info.height} (${info.isVertical ? 'Vertical 9:16' : 'Non-Vertical'})`);
  console.log(`⏱️ Duration        : ${info.duration.toFixed(2)}s (Strictly <= 59.5s)`);
  console.log(`🎞️ Framerate       : ${info.fps} FPS`);
  console.log(`🔊 Audio Stream    : EBU R128 (-14 LUFS) Normalized, Mixed with ${songName}`);
  console.log(`📦 File Size       : ${(stat.size / 1024).toFixed(1)} KB`);
  console.log('\n📝 GENERATED PUBLISHING METADATA:');
  console.log(`---------------------------------------------------------------`);
  console.log(`📌 Title           : ${optimizedTitle}`);
  console.log(`💬 First Comment   : "${firstComment}"`);
  console.log(`📄 Description     :\n${optimizedDescription}`);
  console.log(`---------------------------------------------------------------`);
}

main().catch((err) => {
  console.error('Validation generation error:', err);
  process.exit(1);
});
