/**
 * visualHook.js — Dynamic 0-2.5s Visual Hook Banner Engine for YouTube Shorts
 *
 * Renders a high-contrast, attention-grabbing on-screen hook pill in the
 * upper-third safe zone during seconds 0.0 to 2.5 of a vertical (9:16) Short.
 *
 * Why this exists:
 * The #1 metric driving YouTube Shorts algorithmic distribution is
 * Viewed vs. Swiped Away (VVSA). Mobile viewers decide whether to swipe within
 * 0.8–2.0 seconds. A bold visual hook immediately stops the scroll, dramatically
 * increasing VVSA and overall viewer retention.
 *
 * Safe Zone Placement:
 * YouTube's mobile interface covers the top 8% (back/search) and bottom 25-30%
 * (title, channel handle, sound info). The hook is placed at yPosition=0.16
 * (16% from top), squarely within the upper-third viral safe zone.
 */

const { createCanvas } = require('canvas');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Binary Resolution ────────────────────────────────────────────────────────

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

// ── Constants & Typography ───────────────────────────────────────────────────

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const FPS = 30;

const FONT_FAMILY = 'Avenir Next';
const FONT_SIZE = 42;
const LETTER_SPACING = 3;
const TEXT_COLOR = '#FFFFFF';
const PILL_BG_COLOR = 'rgba(12, 12, 18, 0.85)';
const PILL_BORDER_COLOR = 'rgba(255, 255, 255, 0.32)';
const PILL_BORDER_WIDTH = 3;
const PILL_RADIUS = 28;
const PADDING_X = 36;
const PADDING_Y = 18;

const HOOK_START_TIME = 0.0;
const HOOK_DURATION = 2.5; // seconds

// ── Fallback Hook Generator ──────────────────────────────────────────────────

const VIRAL_HOOK_PATTERNS = [
  'Wait for his cold aura 💀',
  'The scene that broke the internet 🤯',
  'Bro really thought he could win 💀',
  'Peak cinematic moment 🔥',
  'Notice how he reacted? 🥶',
  'Nobody saw this coming ⚡',
  'Pure demonic aura 💀'
];

/**
 * Generates or refines a punchy 3–6 word visual hook
 */
function generateHookText(metadata = {}) {
  if (metadata.visualHook && typeof metadata.visualHook === 'string' && metadata.visualHook.trim()) {
    return metadata.visualHook.trim();
  }

  const title = (metadata.title || metadata.originalTitle || '').toLowerCase();
  const character = metadata.character || '';
  const franchise = metadata.franchise || '';

  if (character && character !== 'Protagonist') {
    return `${character}'s coldest aura 💀`;
  }
  if (franchise && /solo leveling|jinwoo/i.test(franchise)) {
    return 'The Shadow Monarch Awakens 💀';
  }
  if (/gojo|sukuna|domain/i.test(title)) {
    return 'Wait for his cold aura 💀';
  }
  if (/levi|eren|titan/i.test(title)) {
    return 'Peak humanity strength ⚡';
  }
  if (/demon slayer|zenitsu/i.test(title)) {
    return 'Thunderclap speed ⚡';
  }

  // Pick random viral hook
  const idx = Math.floor(Math.random() * VIRAL_HOOK_PATTERNS.length);
  return VIRAL_HOOK_PATTERNS[idx];
}

// ── Easing Helper ────────────────────────────────────────────────────────────

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// ── Canvas Frame Rendering ───────────────────────────────────────────────────

/**
 * Renders a single hook banner frame into a raw RGBA buffer
 */
function renderHookFrame(opts) {
  const {
    text,
    frameIndex,
    totalFrames,
    popFrames,
    fadeFrames,
    yPosition,
    canvasWidth,
    canvasHeight
  } = opts;

  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Animation calculation
  let scale = 1.0;
  let alpha = 1.0;

  if (frameIndex < popFrames) {
    // Pop in with spring ease
    const t = frameIndex / popFrames;
    scale = 0.80 + 0.20 * easeOutBack(t);
    alpha = Math.min(1.0, t * 1.5);
  } else if (frameIndex >= totalFrames - fadeFrames) {
    // Smooth fade out
    const t = (frameIndex - (totalFrames - fadeFrames)) / fadeFrames;
    alpha = Math.max(0.0, 1.0 - t);
    scale = 1.0 - 0.05 * t;
  }

  if (alpha <= 0.001) return canvas.toBuffer('raw');

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.font = `bold ${FONT_SIZE}px "${FONT_FAMILY}"`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // Measure text
  const textMetrics = ctx.measureText(text);
  const textWidth = textMetrics.width + (text.length * LETTER_SPACING);
  const textHeight = FONT_SIZE;

  const pillWidth = textWidth + PADDING_X * 2;
  const pillHeight = textHeight + PADDING_Y * 2;

  const centerX = canvasWidth / 2;
  const centerY = canvasHeight * yPosition;

  // Apply scale from center
  ctx.translate(centerX, centerY);
  ctx.scale(scale, scale);

  const rectX = -pillWidth / 2;
  const rectY = -pillHeight / 2;

  // Draw pill rounded background
  ctx.beginPath();
  ctx.roundRect(rectX, rectY, pillWidth, pillHeight, PILL_RADIUS);
  ctx.fillStyle = PILL_BG_COLOR;
  ctx.fill();

  // Subtle border
  ctx.strokeStyle = PILL_BORDER_COLOR;
  ctx.lineWidth = PILL_BORDER_WIDTH;
  ctx.stroke();

  // Draw drop shadow for text
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;

  // Render centered text with letter spacing
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(text, 0, 2);

  ctx.restore();

  return canvas.toBuffer('raw');
}

/**
 * Probes input video dimensions
 */
function probeVideoDimensions(videoPath) {
  return new Promise((resolve) => {
    execFile(FFPROBE_BIN, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      videoPath
    ], { timeout: 10000 }, (err, stdout) => {
      if (err) return resolve({ width: CANVAS_W, height: CANVAS_H });
      try {
        const data = JSON.parse(stdout);
        const w = data.streams?.[0]?.width || CANVAS_W;
        const h = data.streams?.[0]?.height || CANVAS_H;
        resolve({ width: w, height: h });
      } catch {
        resolve({ width: CANVAS_W, height: CANVAS_H });
      }
    });
  });
}

/**
 * Applies a visual hook banner to a video file
 */
function applyVisualHook(inputPath, outputPath, options = {}, onProgress = null) {
  return new Promise(async (resolve, reject) => {
    try {
      if (!fs.existsSync(inputPath)) {
        return reject(new Error(`Input video not found: ${inputPath}`));
      }

      const text = (options.text || generateHookText(options.metadata || {})).trim();
      const startTime = options.startTime ?? HOOK_START_TIME;
      const duration = options.duration ?? HOOK_DURATION;
      const yPosition = options.yPosition ?? 0.16; // 16% from top (upper-third safe zone)

      const probeData = await probeVideoDimensions(inputPath);
      const canvasWidth = probeData.width || CANVAS_W;
      const canvasHeight = probeData.height || CANVAS_H;

      const totalFrames = Math.ceil(duration * FPS);
      const popFrames = Math.ceil(0.25 * FPS); // 0.25s pop-in
      const fadeFrames = Math.ceil(0.35 * FPS); // 0.35s fade-out

      onProgress?.(`⚡ Compositing visual hook banner: "${text}" (0.0s - ${duration}s)...`);

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

      const endTime = startTime + duration;
      const overlayFilter = [
        `[1:v]format=rgba[hook];`,
        `[0:v][hook]overlay=0:0:enable='between(t,${startTime.toFixed(3)},${endTime.toFixed(3)})'[outv]`
      ].join('');

      const args = [
        '-y',
        '-i', inputPath,
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

      const child = spawn(FFMPEG_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.stdout.on('data', () => {});

      child.on('error', (err) => {
        reject(new Error(`Visual hook FFmpeg spawn failed: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          console.log(`[VisualHook] ✅ Visual hook applied successfully: "${text}"`);
          resolve(outputPath);
        } else {
          console.error(`[VisualHook] FFmpeg failed (code=${code}):`, stderr.slice(-300));
          reject(new Error(`Visual hook overlay failed: ${stderr.slice(-200)}`));
        }
      });

      let brokenPipe = false;
      child.stdin.on('error', (err) => {
        if (err.code === 'EPIPE') brokenPipe = true;
      });

      for (let i = 0; i < totalFrames; i++) {
        if (brokenPipe) break;
        const buf = renderHookFrame({
          text,
          frameIndex: i,
          totalFrames,
          popFrames,
          fadeFrames,
          yPosition,
          canvasWidth,
          canvasHeight
        });

        const ok = child.stdin.write(buf);
        if (!ok) {
          await new Promise((r) => child.stdin.once('drain', r));
        }
      }

      child.stdin.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Applies visual hook banner directly in-place
 */
async function applyVisualHookInPlace(videoPath, options = {}, onProgress = null) {
  const dir = path.dirname(videoPath);
  const ext = path.extname(videoPath);
  const base = path.basename(videoPath, ext);
  const tempOutput = path.join(dir, `${base}_hooked_${Date.now()}${ext}`);

  try {
    await applyVisualHook(videoPath, tempOutput, options, onProgress);
    if (fs.existsSync(tempOutput) && fs.statSync(tempOutput).size > 1000) {
      fs.unlinkSync(videoPath);
      fs.renameSync(tempOutput, videoPath);
      return videoPath;
    }
    throw new Error('Hooked video output is empty or missing');
  } catch (err) {
    if (fs.existsSync(tempOutput)) {
      try { fs.unlinkSync(tempOutput); } catch {}
    }
    throw err;
  }
}

module.exports = {
  applyVisualHook,
  applyVisualHookInPlace,
  generateHookText,
  renderHookFrame,
  probeVideoDimensions
};
