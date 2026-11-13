// test-smart-crop-framing.js — Verification of Smart Black-Bar Removal + Safe Aspect-Aware Framing
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const {
  probeVideo,
  runCropDetect,
  buildAspectAwareVideoFilter,
  convertToShortsFormat,
  ensureShortsFormat
} = require('./lib/shortsFormatter');

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  SMART BLACK-BAR REMOVAL & SAFE ASPECT-AWARE FRAMING TEST SUITE  ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, detail = '') {
    if (condition) {
      console.log(`✅ PASS: ${testName} ${detail ? `(${detail})` : ''}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  const tempDir = '/tmp/smart_crop_tests';
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // ── Test 1: cropdetect Pre-Pass on Baked-in Letterbox (2.39:1 Cinema in 1920x1080) ──
  console.log('── Test 1: Active Picture Area Detection on 2.39:1 Letterbox ──');
  const cinemaPath = path.join(tempDir, 'cinema_letterbox.mp4');
  execSync(`ffmpeg -y -f lavfi -i testsrc=size=1920x804:rate=30 -vf "pad=1920:1080:0:138:black" -t 4 -c:v libx264 -pix_fmt yuv420p "${cinemaPath}" 2>/dev/null`);

  const cinemaCrop = await runCropDetect(cinemaPath, 4);
  assert(!!cinemaCrop, 'cropdetect succeeded on cinema letterbox');
  assert(cinemaCrop.active_w === 1920, 'Detected active width is 1920', `${cinemaCrop.active_w}px`);
  assert(Math.abs(cinemaCrop.active_h - 804) <= 4, 'Detected active height is ~804', `${cinemaCrop.active_h}px`);
  assert(Math.abs(cinemaCrop.active_y - 138) <= 4, 'Detected top bar offset is ~138', `y=${cinemaCrop.active_y}`);

  // ── Test 2: cropdetect Pre-Pass on Baked-in Pillarbox (1:1 Square in 1920x1080) ──
  console.log('\n── Test 2: Active Picture Area Detection on 1:1 Pillarbox ──');
  const squarePillarPath = path.join(tempDir, 'square_pillarbox.mp4');
  execSync(`ffmpeg -y -f lavfi -i testsrc=size=1080x1080:rate=30 -vf "pad=1920:1080:420:0:black" -t 4 -c:v libx264 -pix_fmt yuv420p "${squarePillarPath}" 2>/dev/null`);

  const squarePillarCrop = await runCropDetect(squarePillarPath, 4);
  assert(!!squarePillarCrop, 'cropdetect succeeded on square pillarbox');
  assert(Math.abs(squarePillarCrop.active_w - 1080) <= 4, 'Detected active width is ~1080', `${squarePillarCrop.active_w}px`);
  assert(Math.abs(squarePillarCrop.active_h - 1080) <= 4, 'Detected active height is ~1080', `${squarePillarCrop.active_h}px`);
  assert(Math.abs(squarePillarCrop.active_x - 420) <= 4, 'Detected left bar offset is ~420', `x=${squarePillarCrop.active_x}`);

  // ── Test 3: Case A — Square Trapped in 1080x1920 (aspect <= 1.25) ──
  console.log('\n── Test 3: Case A — 1:1 Trapped in 1080x1920 Frame (No Side Crop) ──');
  const squareInVertical = path.join(tempDir, 'square_in_9x16.mp4');
  execSync(`ffmpeg -y -f lavfi -i testsrc=size=1080x1080:rate=30 -vf "pad=1080:1920:0:420:black" -t 3 -c:v libx264 -pix_fmt yuv420p "${squareInVertical}" 2>/dev/null`);

  const squareOut = path.join(tempDir, 'square_restored_9x16.mp4');
  await convertToShortsFormat(squareInVertical, squareOut);
  assert(fs.existsSync(squareOut), 'Square restored output exists');
  const squareInfo = await probeVideo(squareOut);
  assert(squareInfo.width === 1080 && squareInfo.height === 1920, 'Output dimensions 1080x1920', `${squareInfo.width}x${squareInfo.height}`);

  // ── Test 4: Case B — 16:9 Widescreen (aspect > 1.25, max 10% side crop + shadow) ──
  console.log('\n── Test 4: Case B — 16:9 Widescreen (Safe 10% Crop + Blurred Background) ──');
  const wide16x9Path = path.join(tempDir, 'widescreen_16x9.mp4');
  execSync(`ffmpeg -y -f lavfi -i testsrc=size=1920x1080:rate=30 -t 3 -c:v libx264 -pix_fmt yuv420p "${wide16x9Path}" 2>/dev/null`);

  const wideOut = path.join(tempDir, 'widescreen_shorts.mp4');
  await convertToShortsFormat(wide16x9Path, wideOut);
  assert(fs.existsSync(wideOut), 'Widescreen formatted output exists');
  const wideInfo = await probeVideo(wideOut);
  assert(wideInfo.width === 1080 && wideInfo.height === 1920, 'Output dimensions 1080x1920', `${wideInfo.width}x${wideInfo.height}`);

  // ── Test 5: ensureShortsFormat Detects Black Bars Inside 9:16 Container ──
  console.log('\n── Test 5: ensureShortsFormat Strips Black Bars Trapped in 9:16 Container ──');
  const trappedInput = path.join(tempDir, 'trapped_test.mp4');
  execSync(`ffmpeg -y -f lavfi -i testsrc=size=1080x1080:rate=30 -vf "pad=1080:1920:0:420:black" -t 3 -c:v libx264 -pix_fmt yuv420p "${trappedInput}" 2>/dev/null`);

  const processedPath = await ensureShortsFormat(trappedInput);
  // It must NOT bypass conversion; it must produce a newly formatted file without the baked bars
  assert(processedPath !== trappedInput, 'ensureShortsFormat recognized baked-in black bars and processed the file', processedPath);
  assert(fs.existsSync(processedPath), 'Processed file exists');
  const processedInfo = await probeVideo(processedPath);
  assert(processedInfo.width === 1080 && processedInfo.height === 1920, 'Processed file is 1080x1920', `${processedInfo.width}x${processedInfo.height}`);

  // ── Test 6: Filter Construction Verification ──
  console.log('\n── Test 6: buildAspectAwareVideoFilter Filter String Inspection ──');
  // Case A (aspect <= 1.25)
  const filterA = buildAspectAwareVideoFilter({ active_w: 1080, active_h: 1080, active_x: 0, active_y: 420 }, 1080, 1920, 30, '[outv]', '[0:v]');
  assert(filterA.includes('crop=1080:1080:0:420'), 'Case A crops active box directly');
  assert(filterA.includes('scale=1080:-2'), 'Case A scales width to 1080');
  assert(filterA.includes('boxblur=20:4,eq=saturation=1.25:brightness=-0.08'), 'Case A applies vibrant blurred background');
  assert(!filterA.includes('crop=trunc(iw*0.82'), 'Case A does NOT crop sides');

  // Case B (aspect > 1.25)
  const filterB = buildAspectAwareVideoFilter({ active_w: 1920, active_h: 1080, active_x: 0, active_y: 0 }, 1920, 1080, 30, '[outv]', '[0:v]');
  assert(filterB.includes('crop=trunc(iw*0.82/2)*2:ih'), 'Case B applies safe 10% per side crop (iw*0.82)');
  assert(filterB.includes('scale=1080:-2'), 'Case B scales width to 1080');
  assert(filterB.includes('boxblur=20:4,eq=saturation=1.25:brightness=-0.08'), 'Case B applies vibrant blurred background');
  assert(filterB.includes('drawbox=c=black:t=fill') && filterB.includes('boxblur=14:2'), 'Case B applies smooth drop-shadow / feather border');

  // Cleanup temporary directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (fs.existsSync(processedPath)) fs.unlinkSync(processedPath);
  } catch {}

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════════');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test suite failed with unexpected error:', err);
  process.exit(1);
});
