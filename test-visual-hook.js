// test-visual-hook.js — Verification test for 0-2.5s Visual Hook Banner Engine
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const {
  generateHookText,
  renderHookFrame,
  applyVisualHook
} = require('./lib/visualHook');

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('      VISUAL HOOK BANNER ENGINE TEST SUITE                 ');
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

  // Test 1: Fallback Hook Generator
  console.log('── Test 1: Hook Text Generator ──');
  const h1 = generateHookText({ franchise: 'Solo Leveling' });
  assert(h1.includes('Shadow Monarch') || h1.includes('cold aura'), 'Generates Solo Leveling specific hook', h1);

  const h2 = generateHookText({ character: 'Gojo' });
  assert(h2.includes('Gojo'), 'Generates character specific hook', h2);

  const h3 = generateHookText({ visualHook: 'Custom AI Hook 🔥' });
  assert(h3 === 'Custom AI Hook 🔥', 'Preserves AI generated hook', h3);

  // Test 2: Frame Rendering
  console.log('\n── Test 2: Frame Buffer Rendering ──');
  const buf0 = renderHookFrame({
    text: 'Wait for his cold aura 💀',
    frameIndex: 0,
    totalFrames: 75,
    popFrames: 8,
    fadeFrames: 10,
    yPosition: 0.16,
    canvasWidth: 1080,
    canvasHeight: 1920
  });
  assert(Buffer.isBuffer(buf0) && buf0.length === 1080 * 1920 * 4, 'Renders raw RGBA frame buffer', `size: ${buf0.length} bytes`);

  // Test 3: Overlay on 3-second test video
  console.log('\n── Test 3: Video Overlay Compositing ──');
  const tempDir = '/tmp/hook_tests';
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const testVideo = path.join(tempDir, 'test_source.mp4');
  const outputVideo = path.join(tempDir, 'test_output_hooked.mp4');

  // Generate 3s synthetic vertical video
  execSync(
    `ffmpeg -y -f lavfi -i testsrc=size=1080x1920:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 3 -c:v libx264 -pix_fmt yuv420p -c:a aac "${testVideo}"`,
    { stdio: 'pipe' }
  );
  assert(fs.existsSync(testVideo), 'Created test video asset');

  await applyVisualHook(testVideo, outputVideo, {
    text: 'The scene that broke the internet 🤯',
    duration: 2.0,
    yPosition: 0.16
  });

  assert(fs.existsSync(outputVideo), 'Hooked output video generated successfully');
  const outStat = fs.statSync(outputVideo);
  assert(outStat.size > 10000, 'Output video has valid size', `${outStat.size} bytes`);

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`═══════════════════════════════════════════════════════════`);

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
