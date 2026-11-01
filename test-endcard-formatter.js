// test-endcard-formatter.js — Comprehensive verification of End Card & Shorts Formatter
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const {
  probeVideo,
  resolveEndCardPath,
  formatAndAttachEndCard,
  ensureShortsFormat
} = require('./lib/shortsFormatter');

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('      END CARD & SHORTS FORMATTER TEST SUITE               ');
  console.log('═══════════════════════════════════════════════════════════\n');

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

  // Test 1: Resolve End Card Path
  console.log('── Test 1: Resolve End Card Path ──');
  const endCardPath = resolveEndCardPath();
  assert(!!endCardPath, 'End card path resolved', endCardPath);
  assert(fs.existsSync(endCardPath), 'End card file exists on disk', endCardPath);

  // Test 2: Probe End Card
  console.log('\n── Test 2: Probe End Card ──');
  const endCardInfo = await probeVideo(endCardPath);
  assert(!!endCardInfo, 'End card probed successfully');
  assert(endCardInfo.width > 0 && endCardInfo.height > 0, 'End card has valid dimensions', `${endCardInfo.width}x${endCardInfo.height}`);
  assert(endCardInfo.isVertical, 'End card is vertical 9:16');
  assert(endCardInfo.duration > 0, 'End card has positive duration', `${endCardInfo.duration.toFixed(2)}s`);
  assert(endCardInfo.hasAudio, 'End card contains audio stream');

  // Create temporary test videos
  const tempDir = '/tmp/endcard_tests';
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const testH = path.join(tempDir, 'test_horizontal.mp4');
  const testV = path.join(tempDir, 'test_vertical.mp4');
  const testNoAudio = path.join(tempDir, 'test_noaudio.mp4');

  console.log('\n── Preparing test input videos ──');
  execSync(`ffmpeg -y -f lavfi -i testsrc=size=1920x1080:rate=30 -f lavfi -i sine=frequency=440:sample_rate=44100 -t 3 -c:v libx264 -c:a aac "${testH}" 2>/dev/null`);
  execSync(`ffmpeg -y -f lavfi -i testsrc=size=720x1280:rate=25 -f lavfi -i sine=frequency=880:sample_rate=48000 -t 3 -c:v libx264 -c:a aac "${testV}" 2>/dev/null`);
  execSync(`ffmpeg -y -f lavfi -i testsrc=size=1280x720:rate=30 -t 2 -c:v libx264 -an "${testNoAudio}" 2>/dev/null`);

  // Test 3: Horizontal video with audio
  console.log('\n── Test 3: Process Horizontal Video with End Card ──');
  const outH = await ensureShortsFormat(testH, (msg) => console.log('   [progress]', msg));
  assert(fs.existsSync(outH), 'Output file exists', outH);
  const infoH = await probeVideo(outH);
  assert(infoH.width === 1080 && infoH.height === 1920, 'Output is 1080x1920 9:16', `${infoH.width}x${infoH.height}`);
  assert(infoH.hasAudio, 'Output has audio');
  assert(infoH.duration >= 5.5 && infoH.duration <= 7.0, 'Duration is combined (~6.14s)', `${infoH.duration.toFixed(2)}s`);

  // Test 4: Vertical video with audio
  console.log('\n── Test 4: Process Vertical Video with End Card ──');
  const outV = await ensureShortsFormat(testV, (msg) => console.log('   [progress]', msg));
  assert(fs.existsSync(outV), 'Output file exists', outV);
  const infoV = await probeVideo(outV);
  assert(infoV.width === 1080 && infoV.height === 1920, 'Output is 1080x1920 9:16', `${infoV.width}x${infoV.height}`);
  assert(infoV.hasAudio, 'Output has audio');
  assert(infoV.duration >= 5.5 && infoV.duration <= 7.0, 'Duration is combined (~6.14s)', `${infoV.duration.toFixed(2)}s`);

  // Test 5: Video with NO audio
  console.log('\n── Test 5: Process Video without Audio Stream ──');
  const outNoA = await ensureShortsFormat(testNoAudio, (msg) => console.log('   [progress]', msg));
  assert(fs.existsSync(outNoA), 'Output file exists', outNoA);
  const infoNoA = await probeVideo(outNoA);
  assert(infoNoA.width === 1080 && infoNoA.height === 1920, 'Output is 1080x1920 9:16', `${infoNoA.width}x${infoNoA.height}`);
  assert(infoNoA.hasAudio, 'Output has audio from endcard');
  assert(infoNoA.duration >= 4.5 && infoNoA.duration <= 6.0, 'Duration is combined (~5.14s)', `${infoNoA.duration.toFixed(2)}s`);

  // Cleanup test outputs
  [outH, outV, outNoA].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  });

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════');

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
