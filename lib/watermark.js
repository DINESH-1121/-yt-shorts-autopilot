/**
 * watermark.js — Animated "Line Reveal" Video Watermark Overlay
 *
 * Replicates the viral YouTube Short watermark style (e.g. https://www.youtube.com/shorts/cBqrI_M4h6s):
 *   - Stacked typography:
 *       Line 1: Crisp sans-serif uppercase label (e.g. "MADE BY")
 *       Line 2: Viral gothic blackletter typography in Google Font "Pirata One" (e.g. "EDIT CLIPS" / channel handle)
 *   - Ambient dark drop shadow & glow floating organically over footage (no bulky boxes/pill backgrounds)
 *   - Sleek smooth line-reveal & wipe-out animation:
 *       Phase 1 (Reveal): Glowing vertical white cursor bar moves L→R unmasking text (easeOutCubic)
 *       Phase 2 (Hold):   Text stays visible, cursor blinks softly then fades out
 *       Phase 3 (Wipe):   Cursor bar slides back R→L wiping the text away cleanly (easeInCubic)
 */

const { createCanvas, registerFont } = require('canvas');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── Register Viral Font from Assets (Google Font "Pirata One") ───────────────
const PIRATA_FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'PirataOne-Regular.ttf');
if (fs.existsSync(PIRATA_FONT_PATH)) {
  try {
    registerFont(PIRATA_FONT_PATH, { family: 'Pirata One' });
  } catch (err) {
    console.warn('[Watermark] Could not register Pirata One font:', err.message);
  }
}

// Fallback fonts
const FONT_CANDIDATES = [
  { path: '/System/Library/Fonts/Supplemental/Impact.ttf', family: 'Impact' },
  { path: '/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf', family: 'DIN Alternate' },
  { path: '/System/Library/Fonts/Supplemental/Futura.ttc', family: 'Futura' },
  { path: '/System/Library/Fonts/Supplemental/Arial Black.ttf', family: 'Arial Black' }
];

for (const fc of FONT_CANDIDATES) {
  if (fs.existsSync(fc.path)) {
    try {
      registerFont(fc.path, { family: fc.family });
    } catch {}
  }
}

// ─── Binary Resolution (mirrors shortsFormatter.js) ──────────────────────────

function resolveBinary(envVar, name, fallbacks) {
  const fromEnv = process.env[envVar];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const candidate of fallbacks) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return name;
}

const FFMPEG_BIN = resolveBinary('FFMPEG_PATH', 'ffmpeg', [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg'
]);

const FFPROBE_BIN = resolveBinary('FFPROBE_PATH', 'ffprobe', [
  '/opt/homebrew/bin/ffprobe',
  '/usr/local/bin/ffprobe',
  '/usr/bin/ffprobe'
]);

// ─── Constants & Typography ──────────────────────────────────────────────────

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const FPS = 30;

// Animation timing defaults
const REVEAL_DURATION = 0.6;           // seconds
const HOLD_DURATION = 3.0;             // seconds
const WIPE_DURATION = 0.5;             // seconds
const DEFAULT_Y_POSITION = 0.82;        // Lower third (above YouTube title/controls safe zone)

// ─── Text Parsing Helper ─────────────────────────────────────────────────────

/**
 * Parses user watermark text into structured label + creator text.
 * E.g. "MADE BY @MYCHANNEL" -> { topText: "MADE BY", mainText: "@MYCHANNEL" }
 *      "EDIT CLIPS"         -> { topText: "MADE BY", mainText: "EDIT CLIPS" }
 */
function parseWatermarkText(rawText) {
  let str = String(rawText || '').trim();
  if (!str) return { topText: 'MADE BY', mainText: 'EDIT CLIPS' };

  let topText = 'MADE BY';
  let mainText = '';

  if (/^made\s+by\s+/i.test(str)) {
    mainText = str.replace(/^made\s+by\s+/i, '').trim();
  } else if (/^by\s+/i.test(str)) {
    mainText = str.replace(/^by\s+/i, '').trim();
  } else {
    mainText = str;
  }

  // Clean any leading symbols
  mainText = mainText.replace(/^[⚡✦]\s*/, '').trim().toUpperCase();
  if (!mainText) mainText = 'EDIT CLIPS';

  return { topText, mainText };
}

/**
 * Backwards compatibility helper for existing callers.
 */
function formatBrandText(text) {
  const { topText, mainText } = parseWatermarkText(text);
  return `${topText} ${mainText}`;
}

// ─── Easing Functions ────────────────────────────────────────────────────────

/** cubic-bezier(0.22, 1, 0.36, 1) approximation — easeOutCubic */
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/** easeInCubic */
function easeInCubic(t) {
  return t * t * t;
}

// ─── Frame Renderer ──────────────────────────────────────────────────────────

/**
 * Renders a single watermark overlay frame as a transparent RGBA buffer.
 */
function renderFrame(opts) {
  const {
    text: rawText, frameIndex, totalFrames,
    opacity = 1.0, yPosition = DEFAULT_Y_POSITION,
    revealFrames, holdFrames, wipeFrames,
    canvasWidth = CANVAS_W, canvasHeight = CANVAS_H
  } = opts;

  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const { topText, mainText } = parseWatermarkText(rawText);

  // Determine animation phase and progress
  let clipFraction = 0;   // 0 = fully hidden, 1 = fully revealed
  let showCursor = false;
  let cursorOpacity = 1.0;

  if (frameIndex < revealFrames) {
    // Phase 1: Reveal In (L -> R)
    const t = revealFrames > 0 ? frameIndex / revealFrames : 1;
    clipFraction = easeOutCubic(t);
    showCursor = true;
    cursorOpacity = 1.0;
  } else if (frameIndex < revealFrames + holdFrames) {
    // Phase 2: Hold
    clipFraction = 1;
    const holdProgress = (frameIndex - revealFrames) / holdFrames;

    // Cursor blinks softly for first 20% of hold, fades out over next 15%, then remains hidden
    if (holdProgress < 0.20) {
      const blinkCycle = Math.floor((frameIndex - revealFrames) / 5);
      showCursor = blinkCycle % 2 === 0;
      cursorOpacity = 1.0;
    } else if (holdProgress < 0.35) {
      showCursor = true;
      cursorOpacity = 1.0 - (holdProgress - 0.20) / 0.15;
    } else {
      showCursor = false;
    }
  } else {
    // Phase 3: Wipe Out (R -> L)
    const wipeIndex = frameIndex - revealFrames - holdFrames;
    const t = wipeFrames > 0 ? wipeIndex / wipeFrames : 1;
    clipFraction = 1 - easeInCubic(t);
    showCursor = true;
    cursorOpacity = 1.0;
  }

  // Skip rendering if fully clipped (e.g. frame 0 or end)
  if (clipFraction <= 0) return canvas.toBuffer('raw');

  // Resolution scaling (reference: 1080p)
  const scale = canvasWidth / 1080;
  const topFontSize = Math.max(10, Math.round(15 * scale));
  const mainFontSize = Math.max(20, Math.round(44 * scale));
  const centerX = canvasWidth / 2;
  const yCenter = canvasHeight * yPosition;

  // Measure widths
  ctx.font = `bold ${topFontSize}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
  const topW = topText ? ctx.measureText(topText).width : 0;

  ctx.font = `${mainFontSize}px "Pirata One", Impact, "Arial Black", cursive, sans-serif`;
  const mainW = ctx.measureText(mainText).width;

  const totalW = Math.max(topW, mainW);
  const startX = Math.round(centerX - totalW / 2);

  const topY = yCenter - 18 * scale;
  const mainY = yCenter + 12 * scale;
  const cursorH = Math.round(48 * scale);
  const cursorW = Math.max(2, Math.round(3 * scale));
  const cursorY = yCenter - 22 * scale;

  const revealedW = totalW * clipFraction;

  // ── Draw masked text ──
  ctx.save();
  ctx.beginPath();
  // Clipping rect unmasks text from startX to startX + revealedW
  ctx.rect(startX - 20, yCenter - 60 * scale, revealedW + 20, 120 * scale);
  ctx.clip();

  // Top line: crisp sans-serif uppercase
  if (topText) {
    ctx.font = `bold ${topFontSize}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * opacity})`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 6 * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(topText, centerX, topY);
  }

  // Main line: viral gothic blackletter in Pirata One
  ctx.font = `${mainFontSize}px "Pirata One", Impact, "Arial Black", cursive, sans-serif`;
  ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
  ctx.shadowBlur = 8 * scale;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(mainText, centerX, mainY);

  ctx.restore();

  // ── Glowing white cursor bar at leading edge ──
  if (showCursor && cursorOpacity > 0.01) {
    const cursorX = startX + revealedW;
    ctx.save();
    ctx.globalAlpha = cursorOpacity * opacity;
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = '#FFFFFF';
    ctx.shadowBlur = 10 * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillRect(cursorX, cursorY, cursorW, cursorH);
    ctx.restore();
  }

  return canvas.toBuffer('raw');
}

// ─── Animation Pipeline ──────────────────────────────────────────────────────

/**
 * Generates all watermark overlay frames as raw RGBA data and pipes them
 * to FFmpeg, which composites them onto the source video using the overlay
 * filter with alpha channel blending.
 *
 * @param {string}  inputPath  - Path to the source video file
 * @param {string}  outputPath - Path for the output video with watermark
 * @param {object}  [options]  - Configuration overrides
 * @param {string}  [options.text='MADE BY @CHANNEL']       - Watermark text
 * @param {number}  [options.startTime=1.0]                 - When watermark appears (seconds)
 * @param {number}  [options.duration=4.1]                  - Total animation duration (seconds)
 * @param {number}  [options.opacity=0.95]                  - Text opacity (0–1)
 * @param {number}  [options.yPosition=0.82]                - Vertical position (0–1 from top)
 * @param {number}  [options.revealDuration=0.6]            - Reveal phase (seconds)
 * @param {number}  [options.holdDuration=3.0]              - Hold phase (seconds)
 * @param {number}  [options.wipeDuration=0.5]              - Wipe phase (seconds)
 * @param {Function} [onProgress]                           - Progress callback
 * @returns {Promise<string>} Path to the output video
 */
function applyWatermark(inputPath, outputPath, options = {}, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      const rawText = options.text || '@SHORTSSTUDIO';
      const startTime = options.startTime ?? 1.0;
      const revealDur = options.revealDuration ?? REVEAL_DURATION;
      const holdDur = options.holdDuration ?? HOLD_DURATION;
      const wipeDur = options.wipeDuration ?? WIPE_DURATION;
      const totalDuration = options.duration ?? (revealDur + holdDur + wipeDur);
      const opacity = options.opacity ?? 0.95;
      const yPosition = options.yPosition ?? DEFAULT_Y_POSITION;

      // Probe the input video for dimensions
      const probeData = await probeVideoDimensions(inputPath);
      const canvasWidth = probeData.width || CANVAS_W;
      const canvasHeight = probeData.height || CANVAS_H;

      // Calculate frame counts for each phase
      const totalFrames = Math.ceil(totalDuration * FPS);
      const revealFrames = Math.ceil(revealDur * FPS);
      const wipeFrames = Math.ceil(wipeDur * FPS);
      const holdFrames = totalFrames - revealFrames - wipeFrames;

      onProgress?.(`🏷️  Applying animated watermark: "${rawText}" ...`);
      console.log(`[Watermark] Rendering ${totalFrames} overlay frames at ${FPS}fps (${canvasWidth}x${canvasHeight})`);
      console.log(`[Watermark] Timeline: reveal=${revealDur}s, hold=${holdDur}s, wipe=${wipeDur}s, start=${startTime}s, yPos=${yPosition}`);

      // Use VideoToolbox on macOS, libx264 elsewhere
      const isDarwin = process.platform === 'darwin';
      const videoCodecArgs = isDarwin ? [
        '-c:v', 'h264_videotoolbox',
        '-b:v', '8M',
        '-maxrate', '12M',
        '-bufsize', '16M',
        '-profile:v', 'high',
        '-pix_fmt', 'yuv420p',
      ] : [
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-profile:v', 'high',
        '-level:v', '4.2',
        '-maxrate', '10M',
        '-bufsize', '16M',
        '-pix_fmt', 'yuv420p',
      ];

      // Overlay filter: enabled only during [startTime, startTime + totalDuration]
      const endTime = startTime + totalDuration;
      const overlayFilter = [
        `[1:v]format=rgba[wm];`,
        `[0:v][wm]overlay=0:0:enable='between(t,${startTime.toFixed(3)},${endTime.toFixed(3)})'[outv]`
      ].join('');

      const args = [
        '-y',
        '-i', inputPath,
        // Raw RGBA frames from stdin
        '-f', 'rawvideo',
        '-pixel_format', 'rgba',
        '-video_size', `${canvasWidth}x${canvasHeight}`,
        '-framerate', String(FPS),
        '-i', 'pipe:0',
        '-filter_complex', overlayFilter,
        '-map', '[outv]',
        '-map', '0:a?',
        ...videoCodecArgs,
        '-c:a', 'copy',
        '-movflags', '+faststart',
        outputPath
      ];

      console.log(`[Watermark] FFmpeg args: ffmpeg ${args.join(' ')}`);
      const child = spawn(FFMPEG_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.stdout.on('data', () => {}); // drain stdout

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn FFmpeg for watermark: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          console.log(`[Watermark] ✅ Watermark applied successfully: ${outputPath}`);
          resolve(outputPath);
        } else {
          console.error(`[Watermark] FFmpeg failed (code=${code}):`, stderr.slice(-500));
          reject(new Error(`FFmpeg watermark overlay failed: ${stderr.slice(-300)}`));
        }
      });

      // Handle broken pipe gracefully
      child.stdin.on('error', (err) => {
        if (err.code !== 'EPIPE') {
          console.warn(`[Watermark] stdin error: ${err.message}`);
        }
      });

      // ── Generate and pipe frames ──
      let framesWritten = 0;
      const logInterval = Math.max(1, Math.floor(totalFrames / 5));

      for (let i = 0; i < totalFrames; i++) {
        const buf = renderFrame({
          text: rawText,
          frameIndex: i,
          totalFrames,
          opacity,
          yPosition,
          revealFrames,
          holdFrames,
          wipeFrames,
          canvasWidth,
          canvasHeight
        });

        // Write frame and handle backpressure
        const canContinue = child.stdin.write(buf);
        framesWritten++;

        if (framesWritten % logInterval === 0) {
          const pct = Math.round((framesWritten / totalFrames) * 100);
          onProgress?.(`🏷️  Watermark: rendering frame ${framesWritten}/${totalFrames} (${pct}%)...`);
        }

        if (!canContinue) {
          await new Promise((res) => child.stdin.once('drain', res));
        }
      }

      child.stdin.end();
      console.log(`[Watermark] Piped ${framesWritten}/${totalFrames} frames to FFmpeg`);

    } catch (err) {
      reject(err);
    }
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function probeVideoDimensions(filePath) {
  return new Promise((resolve) => {
    execFile(FFPROBE_BIN, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      filePath
    ], { timeout: 15000 }, (err, stdout) => {
      if (err) {
        console.warn('[Watermark] ffprobe failed, using defaults:', err.message);
        return resolve({ width: CANVAS_W, height: CANVAS_H });
      }
      try {
        const data = JSON.parse(stdout);
        const stream = (data.streams || [])[0] || {};
        resolve({
          width: stream.width || CANVAS_W,
          height: stream.height || CANVAS_H
        });
      } catch {
        resolve({ width: CANVAS_W, height: CANVAS_H });
      }
    });
  });
}

// ─── Convenience: Apply Watermark In-Place ───────────────────────────────────

async function applyWatermarkInPlace(filePath, options = {}, onProgress) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const tempOutput = path.join(dir, `${base}_wm_${Date.now()}${ext}`);

  try {
    await applyWatermark(filePath, tempOutput, options, onProgress);

    // Replace original with watermarked version
    fs.unlinkSync(filePath);
    fs.renameSync(tempOutput, filePath);
    console.log(`[Watermark] Replaced original with watermarked file: ${filePath}`);
    return filePath;
  } catch (err) {
    try { if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput); } catch {}
    throw err;
  }
}

module.exports = {
  applyWatermark,
  applyWatermarkInPlace,
  renderFrame,
  formatBrandText,
  parseWatermarkText,
  CANVAS_W,
  CANVAS_H,
  FPS,
  DEFAULT_Y_POSITION
};
