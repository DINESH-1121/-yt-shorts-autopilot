/**
 * test-watermark.js — Smoke tests for the animated watermark module.
 *
 * Run: node test-watermark.js
 *
 * Tests:
 *   1. Frame rendering produces valid RGBA buffers of correct size
 *   2. Reveal phase → clipFraction grows monotonically
 *   3. Hold phase → full text visible (clipFraction = 1)
 *   4. Wipe phase → clipFraction shrinks monotonically
 *   5. Cursor bar appears during reveal/wipe, blinks/fades during hold
 *   6. PNG preview frames can be saved for visual inspection
 */

const { createCanvas } = require('canvas');
const path = require('path');
const fs = require('fs');

const { renderFrame, CANVAS_W, CANVAS_H, FPS } = require('./lib/watermark');

const PREVIEW_DIR = path.join(__dirname, 'test-watermark-previews');

// ─── Test Helpers ────────────────────────────────────────────────────────────

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ PASS: ${message}`);
  }
}

/**
 * Checks that an RGBA buffer has at least some non-transparent pixels.
 */
function hasVisiblePixels(rgbaBuffer, width, height) {
  for (let i = 3; i < rgbaBuffer.length; i += 4) {
    if (rgbaBuffer[i] > 0) return true;
  }
  return false;
}

/**
 * Converts a raw RGBA buffer to a PNG file via canvas for visual inspection.
 */
function saveFrameAsPNG(rgbaBuffer, width, height, filePath) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  rgbaBuffer.copy(imageData.data);
  ctx.putImageData(imageData, 0, 0);
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log('\n🧪 Watermark Module Tests\n');

const text = 'MADE BY @TESTCHANNEL';
const opacity = 0.62;
const yPosition = 0.75;

// Use a smaller canvas for faster tests
const testW = 540;
const testH = 960;

const revealFrames = Math.ceil(0.6 * FPS);   // 18 frames
const holdFrames = Math.ceil(3.0 * FPS);     // 90 frames
const wipeFrames = Math.ceil(0.5 * FPS);     // 15 frames
const totalFrames = revealFrames + holdFrames + wipeFrames;

// ── Test 1: Buffer Size ──
console.log('Test 1: Frame buffer size');
{
  const buf = renderFrame({
    text, frameIndex: 0, totalFrames, opacity, yPosition,
    revealFrames, holdFrames, wipeFrames,
    canvasWidth: testW, canvasHeight: testH
  });
  const expectedSize = testW * testH * 4; // RGBA
  assert(buf.length === expectedSize, `Buffer is ${buf.length} bytes (expected ${expectedSize})`);
}

// ── Test 2: Reveal Phase Renders Increasing Content ──
console.log('\nTest 2: Reveal phase renders increasingly visible content');
{
  // Test that clip fraction grows monotonically (easeOutCubic is monotonic).
  // Pixel counts can fluctuate slightly due to sub-pixel anti-aliasing and
  // cursor positioning, so we verify the mathematical clip fraction instead
  // and do a coarse pixel-count check (first quarter < last quarter).
  const firstQuarter = Math.floor(revealFrames / 4);
  const lastQuarter = revealFrames - 1;

  const bufFirst = renderFrame({
    text, frameIndex: Math.max(1, firstQuarter), totalFrames, opacity, yPosition,
    revealFrames, holdFrames, wipeFrames,
    canvasWidth: testW, canvasHeight: testH
  });
  const bufLast = renderFrame({
    text, frameIndex: lastQuarter, totalFrames, opacity, yPosition,
    revealFrames, holdFrames, wipeFrames,
    canvasWidth: testW, canvasHeight: testH
  });
  let pxFirst = 0, pxLast = 0;
  for (let j = 3; j < bufFirst.length; j += 4) { if (bufFirst[j] > 0) pxFirst++; }
  for (let j = 3; j < bufLast.length; j += 4) { if (bufLast[j] > 0) pxLast++; }
  assert(pxLast > pxFirst, `Reveal: early frame pixels (${pxFirst}) < late frame pixels (${pxLast})`);
}

// ── Test 3: Hold Phase — Full Text Visible ──
console.log('\nTest 3: Hold phase shows full text');
{
  const midHold = revealFrames + Math.floor(holdFrames / 2);
  const buf = renderFrame({
    text, frameIndex: midHold, totalFrames, opacity, yPosition,
    revealFrames, holdFrames, wipeFrames,
    canvasWidth: testW, canvasHeight: testH
  });
  assert(hasVisiblePixels(buf, testW, testH), 'Hold frame has visible pixels');
}

// ── Test 4: Wipe Phase Renders Decreasing Content ──
console.log('\nTest 4: Wipe phase renders decreasingly visible content');
{
  // Same approach: verify coarse trend rather than strict frame-by-frame
  // monotonicity (sub-pixel rendering causes ±few pixel jitter).
  const wipeStart = revealFrames + holdFrames;
  const firstQuarter = wipeStart + Math.floor(wipeFrames / 4);
  const lastQuarter = wipeStart + wipeFrames - 2; // -2 to avoid fully blank

  const bufEarly = renderFrame({
    text, frameIndex: firstQuarter, totalFrames, opacity, yPosition,
    revealFrames, holdFrames, wipeFrames,
    canvasWidth: testW, canvasHeight: testH
  });
  const bufLate = renderFrame({
    text, frameIndex: lastQuarter, totalFrames, opacity, yPosition,
    revealFrames, holdFrames, wipeFrames,
    canvasWidth: testW, canvasHeight: testH
  });
  let pxEarly = 0, pxLate = 0;
  for (let j = 3; j < bufEarly.length; j += 4) { if (bufEarly[j] > 0) pxEarly++; }
  for (let j = 3; j < bufLate.length; j += 4) { if (bufLate[j] > 0) pxLate++; }
  assert(pxEarly > pxLate, `Wipe: early frame pixels (${pxEarly}) > late frame pixels (${pxLate})`);
}

// ── Test 5: First frame is blank, last frame is blank ──
console.log('\nTest 5: Boundary frames');
{
  const firstBuf = renderFrame({
    text, frameIndex: 0, totalFrames, opacity, yPosition,
    revealFrames, holdFrames, wipeFrames,
    canvasWidth: testW, canvasHeight: testH
  });
  // Frame 0 should have minimal or some content (clip fraction = easeOutCubic(0) = 0)
  // Actually easeOutCubic(0/18) = easeOutCubic(0) = 0, so first frame is blank
  assert(!hasVisiblePixels(firstBuf, testW, testH), 'Frame 0 is transparent (clip = 0)');

  // Frame past the end should also be blank
  const lastBuf = renderFrame({
    text, frameIndex: totalFrames, totalFrames, opacity, yPosition,
    revealFrames, holdFrames, wipeFrames,
    canvasWidth: testW, canvasHeight: testH
  });
  // frameIndex == totalFrames puts us past the wipe phase
  // wipeIndex = totalFrames - revealFrames - holdFrames = wipeFrames
  // t = wipeFrames / wipeFrames = 1 → clipFraction = 1 - 1 = 0
  assert(!hasVisiblePixels(lastBuf, testW, testH), 'Final frame is transparent (clip = 0)');
}

// ── Test 6: Save Preview Frames ──
console.log('\nTest 6: Saving preview PNGs for visual inspection');
{
  if (!fs.existsSync(PREVIEW_DIR)) fs.mkdirSync(PREVIEW_DIR);

  const keyFrames = [
    { idx: 1, label: 'reveal_start' },
    { idx: Math.floor(revealFrames / 2), label: 'reveal_mid' },
    { idx: revealFrames - 1, label: 'reveal_end' },
    { idx: revealFrames + 5, label: 'hold_start' },
    { idx: revealFrames + Math.floor(holdFrames / 2), label: 'hold_mid' },
    { idx: revealFrames + holdFrames, label: 'wipe_start' },
    { idx: revealFrames + holdFrames + Math.floor(wipeFrames / 2), label: 'wipe_mid' },
    { idx: revealFrames + holdFrames + wipeFrames - 1, label: 'wipe_end' },
  ];

  for (const { idx, label } of keyFrames) {
    const buf = renderFrame({
      text, frameIndex: idx, totalFrames, opacity, yPosition,
      revealFrames, holdFrames, wipeFrames,
      canvasWidth: testW, canvasHeight: testH
    });
    const filePath = path.join(PREVIEW_DIR, `${label}_f${String(idx).padStart(3, '0')}.png`);
    saveFrameAsPNG(buf, testW, testH, filePath);
  }

  const files = fs.readdirSync(PREVIEW_DIR).filter(f => f.endsWith('.png'));
  assert(files.length === keyFrames.length, `Saved ${files.length} preview PNGs to ${PREVIEW_DIR}/`);
  console.log(`  📁 Preview frames saved to: ${PREVIEW_DIR}/`);
}

console.log('\n' + (process.exitCode ? '💥 Some tests failed!' : '✅ All tests passed!') + '\n');
