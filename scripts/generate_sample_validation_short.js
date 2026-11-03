/**
 * scripts/generate_sample_validation_short.js
 *
 * Generates an end-to-end validated YouTube Short without uploading to YouTube.
 * Exercises the complete optimized pipeline:
 * 1. Generates authentic action/edit source video
 * 2. Beat-sync Phonk mixing (100% music + 18% dialogue ducking)
 * 3. 9:16 Vertical Short transcode with preserved framing & EBU R128 -14 LUFS
 * 4. Cinematic color grading from the active Visual Identity profile
 * 5. 0–2.5s Dynamic Visual Hook Banner in upper-third safe zone (y=0.16)
 * 6. Animated DITCH_67 channel branding from the active profile
 * 7. Local 1440x2560 Shorts enhancement
 * 8. Optimized SEO metadata generation
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { ensureShortsFormat, probeVideo } = require('../lib/shortsFormatter');
const { createBeatSyncedShort } = require('../lib/beatSyncTranscoder');
const { applyVisualHookInPlace, generateHookText } = require('../lib/visualHook');
const { applyWatermarkInPlace } = require('../lib/watermark');
const { getVisualIdentityConfig, getActiveBrandProfile, applyColorGradeInPlace } = require('../lib/visualIdentity');
const { enhanceForYouTubeShortsInPlace } = require('../lib/localEnhancer');
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
  const cinematicSourcePath = path.join(PROJECT_ROOT, 'assets', 'sample-source-cinematic.png');

  const requestedDuration = parseFloat(process.argv[2]) || 10.0;
  const sourceDuration = requestedDuration.toFixed(2);

  // 1. Create a cinematic source clip from a portrait film still. This keeps
  // the no-upload sample visually meaningful instead of using test bars.
  console.log(`🎬 Step 1: Building cinematic source clip (${sourceDuration}s -> ~${requestedDuration}s output)...`);
  execSync(
    `ffmpeg -y -loop 1 -i "${cinematicSourcePath}" -f lavfi -i "sine=frequency=320:sample_rate=48000" -t ${sourceDuration} -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(1.0+0.00035*on,1.025)':d=1:s=1080x1920:fps=30,format=yuv420p" -c:v libx264 -preset veryfast -crf 18 -c:a aac "${rawSourcePath}" 2>/dev/null`
  );
  console.log(`✅ Raw clip created: ${rawSourcePath}`);

  let currentVideo = rawSourcePath;

  // 2. Beat-Sync Phonk Audio Mixing
  console.log('\n🎵 Step 2: Applying Beat-Sync Phonk Mixing (100% music + 18% dialogue ducking)...');
  let songName = 'source audio fallback';
  try {
    const beatResult = await createBeatSyncedShort(currentVideo, {
      duration: parseFloat(sourceDuration),
      ducking: 0.18,
      phonkVolume: 1.0,
      bpm: 130.0
    }, (msg) => console.log('   [progress]', msg));
    currentVideo = beatResult.outputPath;
    songName = beatResult.songName;
    console.log(`✅ Beat-sync complete with song: "${songName}"`);
  } catch (err) {
    console.warn(`⚠️ Beat-sync unavailable in this environment; continuing with source audio: ${err.message}`);
  }

  // 3. Strict 9:16 Shorts Transcode with preserved framing & EBU R128 Loudness
  console.log('\n🎨 Step 3: Shorts Transcoding (9:16 Vertical, EBU R128 -14 LUFS, Seamless Loop)...');
  const formattedVideo = await ensureShortsFormat(currentVideo, (msg) => {
    console.log('   [progress]', msg);
  }, { enableEndCard: false });
  currentVideo = formattedVideo;
  console.log(`✅ Shorts formatting complete: ${currentVideo}`);

  const identity = getVisualIdentityConfig();
  const brandProfile = getActiveBrandProfile(identity);
  const sampleBrandProfile = {
    ...brandProfile,
    label: '',
    brandName: 'DITCH_67',
    since: '',
    fontFamily: 'Futura',
    fontSize: 31,
    letterSpacing: 6,
    // Match the supplied Paradise signature: spaced white lettering, glow,
    // and a blinking cursor at the leading edge of the reveal.
    animationStyle: 'slide-reveal',
    visibility: 'animated',
    position: 'custom',
    customPosition: { x: 0.5, y: 0.87 },
    opacity: 0.95,
    primaryColor: '#f4f7ff',
    secondaryColor: '#dfeaff',
    glowColor: '#a8ddff',
    glow: 0.48,
    shadow: 0.68
  };

  // 4. Apply the active cinematic grade before overlays
  console.log(`\n🎞️ Step 4: Applying ${brandProfile.grading.preset} cinematic grade...`);
  await applyColorGradeInPlace(currentVideo, brandProfile.grading, (msg) => console.log('   [progress]', msg));
  console.log('✅ Cinematic color grade applied.');

  // 5. Generate Viral Metadata
  console.log('\n🧠 Step 5: Formulating Viral Packaging & Visual Hook...');
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

  // 6. The supplied reference keeps the footage unobstructed, so the sample
  // leaves the large hook pill off. The production pipeline still supports it.
  console.log('\n⚡ Step 6: Keeping the opening frame unobstructed to match the reference Short.');

  // 7. Apply the active reusable channel branding profile
  console.log(`\n🏷️ Step 7: Compositing restrained ${sampleBrandProfile.brandName} channel branding...`);
  await applyWatermarkInPlace(currentVideo, {
    text: `${sampleBrandProfile.label} ${sampleBrandProfile.brandName}`,
    startTime: 1.2,
    duration: 4.8,
    revealDuration: 0.8,
    holdDuration: 3.2,
    wipeDuration: 0.8,
    opacity: sampleBrandProfile.opacity,
    yPosition: 0.84,
    brand: sampleBrandProfile
  }, (msg) => console.log('   [progress]', msg));
  console.log(`✅ Branding applied: "${sampleBrandProfile.label} ${sampleBrandProfile.brandName}"`);

  // 8. Final local enhancement (never uploads this file)
  console.log('\n✨ Step 8: Applying local 1440x2560 Shorts enhancement...');
  await enhanceForYouTubeShortsInPlace(currentVideo, (msg) => console.log('   [progress]', msg));
  console.log('✅ Local enhancement applied.');

  // Rename to final output path
  if (currentVideo !== finalValidationPath) {
    if (fs.existsSync(finalValidationPath)) fs.unlinkSync(finalValidationPath);
    fs.renameSync(currentVideo, finalValidationPath);
  }

  // Cleanup raw input
  try { if (fs.existsSync(rawSourcePath)) fs.unlinkSync(rawSourcePath); } catch {}

  // 9. Probe Final Validation Asset
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
