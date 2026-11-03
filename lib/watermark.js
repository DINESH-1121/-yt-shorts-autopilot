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

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function resolveBrandPosition(brand, canvasWidth, canvasHeight, scale) {
  const positions = {
    'top-left': [0.15, 0.14],
    'top-right': [0.85, 0.14],
    center: [0.5, 0.50],
    'bottom-left': [0.15, 0.82],
    'bottom-right': [0.85, 0.82],
    'bottom-center': [0.5, 0.82]
  };
  const [defaultX, defaultY] = positions[brand.position] || positions['bottom-center'];
  const custom = brand.position === 'custom' ? brand.customPosition : null;
  return {
    x: canvasWidth * (custom?.x ?? defaultX),
    y: canvasHeight * (custom?.y ?? defaultY),
    scale
  };
}

function drawSpacedText(ctx, text, x, y, spacing) {
  if (!spacing) {
    ctx.fillText(text, x, y);
    return;
  }
  const widths = [...text].map(char => ctx.measureText(char).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, text.length - 1) * spacing;
  let cursor = x - total / 2;
  ctx.textAlign = 'left';
  [...text].forEach((char, index) => {
    ctx.fillText(char, cursor, y);
    cursor += widths[index] + spacing;
  });
  ctx.textAlign = 'center';
}

function drawSpacedStrokeText(ctx, text, x, y, spacing) {
  if (!spacing) {
    ctx.strokeText(text, x, y);
    return;
  }
  const widths = [...text].map(char => ctx.measureText(char).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, text.length - 1) * spacing;
  let cursor = x - total / 2;
  ctx.textAlign = 'left';
  [...text].forEach((char, index) => {
    ctx.strokeText(char, cursor, y);
    cursor += widths[index] + spacing;
  });
  ctx.textAlign = 'center';
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
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
    canvasWidth = CANVAS_W, canvasHeight = CANVAS_H,
    brand = {}
  } = opts;

  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const parsed = parseWatermarkText(rawText);
  const topText = String(brand.label ?? parsed.topText).toUpperCase();
  const mainText = String(brand.brandName || parsed.mainText).toUpperCase();
  const sinceText = String(brand.since || '').toUpperCase();
  const animationStyle = brand.animationStyle || 'cursor-reveal';

  // Determine animation phase and progress
  let clipFraction = 0;   // 0 = fully hidden, 1 = fully revealed
  let showCursor = animationStyle === 'cursor-reveal';
  let cursorOpacity = 1.0;
  let frameAlpha = 1;
  let frameScale = 1;
  let blurAmount = 0;

  if (brand.visibility === 'persistent') {
    clipFraction = 1;
    showCursor = false;
  } else if (frameIndex < revealFrames) {
    // Phase 1: Reveal In (L -> R)
    const t = revealFrames > 0 ? frameIndex / revealFrames : 1;
    clipFraction = easeOutCubic(t);
    showCursor = animationStyle === 'cursor-reveal' || animationStyle === 'neon-glow' || animationStyle === 'slide-reveal';
    cursorOpacity = 1.0;
    if (animationStyle === 'fade-scale') {
      frameAlpha = easeOutCubic(t);
      frameScale = 0.88 + 0.12 * easeOutCubic(t);
    } else if (animationStyle === 'blur-reveal') {
      frameAlpha = 0.35 + 0.65 * easeOutCubic(t);
      blurAmount = Math.max(0, 10 * (1 - t));
    } else if (animationStyle === 'glitch-reveal') {
      frameAlpha = 0.85 + 0.15 * easeOutCubic(t);
    }
  } else if (frameIndex < revealFrames + holdFrames) {
    // Phase 2: Hold
    clipFraction = 1;
    showCursor = animationStyle === 'cursor-reveal' || animationStyle === 'neon-glow' || animationStyle === 'slide-reveal';
    const holdProgress = (frameIndex - revealFrames) / holdFrames;

    // Cursor blinks softly for first 20% of hold, fades out over next 15%, then remains hidden
    if (holdProgress < 0.20 && animationStyle === 'cursor-reveal') {
      const blinkCycle = Math.floor((frameIndex - revealFrames) / 5);
      showCursor = blinkCycle % 2 === 0;
      cursorOpacity = 1.0;
    } else if (holdProgress < 0.35 && animationStyle === 'cursor-reveal') {
      showCursor = true;
      cursorOpacity = 1.0 - (holdProgress - 0.20) / 0.15;
    } else {
      showCursor = false;
    }
  } else {
    // Phase 3: Wipe Out (R -> L)
    const wipeIndex = frameIndex - revealFrames - holdFrames;
    const t = wipeFrames > 0 ? wipeIndex / wipeFrames : 1;
    // Cursor-reveal signatures should fade out as a complete word. Reducing
    // the left-to-right clip here leaves broken letter fragments at the end.
    if (animationStyle === 'cursor-reveal' || animationStyle === 'smooth-reveal' || animationStyle === 'slide-reveal') {
      clipFraction = 1;
      frameAlpha = 1 - easeInCubic(Math.min(1, Math.max(0, t)));
      showCursor = true;
      cursorOpacity = frameAlpha;
    } else {
      clipFraction = 1 - easeInCubic(t);
      showCursor = animationStyle === 'neon-glow';
      cursorOpacity = 1.0;
    }
    if (animationStyle === 'fade-scale') {
      frameAlpha = 1 - easeInCubic(t);
      frameScale = 1 - 0.08 * easeInCubic(t);
    }
  }

  if (animationStyle === 'minimal-fade') {
    const fadeFrames = Math.max(1, Math.min(revealFrames, wipeFrames));
    if (frameIndex < revealFrames) frameAlpha = easeOutCubic(frameIndex / fadeFrames);
    else if (frameIndex >= revealFrames + holdFrames) {
      frameAlpha = 1 - easeInCubic((frameIndex - revealFrames - holdFrames) / fadeFrames);
    }
    clipFraction = 1;
    showCursor = false;
  }

  if (animationStyle === 'typewriter') showCursor = false;
  if (animationStyle === 'smooth-reveal') showCursor = false;

  // The Paradise-style signature is a true type-on reveal, not a sliding mask.
  // Keep the text layer available while characters are being added so the
  // cursor can track the revealed word cleanly.
  const isSingleLineCursorSignature = animationStyle === 'cursor-reveal' && !topText && !sinceText;
  if (isSingleLineCursorSignature) clipFraction = 1;

  // Skip rendering if fully clipped (e.g. frame 0 or end)
  if (clipFraction <= 0) return canvas.toBuffer('raw');

  // Resolution scaling (reference: 1080p)
  const scale = canvasWidth / 1080;
  const position = resolveBrandPosition({ ...brand, customPosition: brand.customPosition, position: brand.position || 'bottom-center' }, canvasWidth, canvasHeight, scale);
  const centerX = position.x;
  const yCenter = brand.position ? position.y : canvasHeight * yPosition;
  const topFontSize = Math.max(10, Math.round((brand.topFontSize || Math.max(15, (brand.fontSize || 44) * 0.34)) * scale));
  const mainFontSize = Math.max(20, Math.round((brand.fontSize || 44) * scale));
  const letterSpacing = Number(brand.letterSpacing) || 0;
  const primaryColor = brand.primaryColor || '#ffffff';
  const secondaryColor = brand.secondaryColor || '#ffffff';
  const outlineWidth = Math.max(0, Number(brand.outlineWidth) || 0) * scale;
  const shadowStrength = clamp01(brand.shadow ?? 0.85);
  const glowStrength = clamp01(brand.glow ?? 0);

  // Measure widths
  ctx.font = `bold ${topFontSize}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
  const topW = topText ? ctx.measureText(topText).width + Math.max(0, topText.length - 1) * letterSpacing : 0;

  const fontFamily = brand.fontFamily || 'Pirata One';
  ctx.font = `${mainFontSize}px "${fontFamily}", Impact, "Arial Black", cursive, sans-serif`;
  const mainW = ctx.measureText(mainText).width + Math.max(0, mainText.length - 1) * letterSpacing;

  const totalW = Math.max(topW, mainW);
  const startX = Math.round(centerX - totalW / 2);
  const isSlidingSignature = animationStyle === 'slide-reveal' && !topText && !sinceText;
  let slideOffset = 0;
  let slideAlpha = 1;
  if (isSlidingSignature) {
    const travel = totalW + Math.round(48 * scale);
    if (frameIndex < revealFrames) {
      const progress = easeOutCubic(frameIndex / Math.max(1, revealFrames));
      slideOffset = -travel * (1 - progress);
      slideAlpha = 0.5 + 0.5 * progress;
    } else if (frameIndex >= revealFrames + holdFrames) {
      const progress = easeInCubic(Math.min(1, (frameIndex - revealFrames - holdFrames) / Math.max(1, wipeFrames)));
      slideOffset = travel * progress;
      slideAlpha = 1 - progress;
    }
    // The slide variant is a clean wordmark; it does not use a cursor.
    showCursor = false;
    cursorOpacity = 0;
  }

  const topY = yCenter - (sinceText ? 25 : 18) * scale;
  const mainY = yCenter + (sinceText ? 7 : 12) * scale;
  const sinceY = yCenter + 31 * scale;
  const cursorH = Math.round(48 * scale);
  const cursorW = Math.max(2, Math.round(3 * scale));
  const cursorY = yCenter - 22 * scale;

  let revealedW = totalW * clipFraction;
  if (isSlidingSignature) revealedW = totalW;
  if (isSingleLineCursorSignature) {
    let visibleCharacters = mainText.length;
    if (frameIndex < revealFrames) {
      visibleCharacters = Math.floor((frameIndex / Math.max(1, revealFrames)) * mainText.length);
    }
    const visibleText = mainText.slice(0, visibleCharacters);
    revealedW = visibleText
      ? ctx.measureText(visibleText).width + Math.max(0, visibleText.length - 1) * letterSpacing
      : 0;
  }

  // YouTube Shorts' visible creator row: avatar, handle, and Subscribe pill.
  // This is intentionally opt-in because it is normally supplied by YouTube's
  // player UI and should not be burned into a production upload.
  if (brand.variant === 'youtube-short-row') {
    const rowX = canvasWidth * (brand.customPosition?.x ?? 0.05);
    const rowY = canvasHeight * (brand.customPosition?.y ?? 0.85);
    const avatarRadius = Math.round(26 * scale);
    const handle = String(brand.brandName || mainText);
    const handleFontSize = Math.max(18, Math.round(25 * scale));
    const pillHeight = Math.round(44 * scale);
    const pillPadding = Math.round(22 * scale);

    ctx.save();
    ctx.globalAlpha = clamp01(opacity) * clamp01(frameAlpha);
    ctx.textBaseline = 'middle';
    ctx.shadowColor = `rgba(0, 0, 0, ${Math.max(0.65, shadowStrength)})`;
    ctx.shadowBlur = 8 * scale;
    ctx.shadowOffsetY = 2 * scale;

    // Compact dark avatar treatment, matching the circular creator avatar slot.
    const avatarGradient = ctx.createLinearGradient(
      rowX - avatarRadius, rowY - avatarRadius,
      rowX + avatarRadius, rowY + avatarRadius
    );
    avatarGradient.addColorStop(0, '#1e355d');
    avatarGradient.addColorStop(0.55, '#3d8fa8');
    avatarGradient.addColorStop(1, '#111827');
    ctx.beginPath();
    ctx.arc(rowX, rowY, avatarRadius, 0, Math.PI * 2);
    ctx.fillStyle = avatarGradient;
    ctx.fill();
    ctx.lineWidth = Math.max(2, Math.round(2 * scale));
    ctx.strokeStyle = 'rgba(255,255,255,0.82)';
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = `900 ${Math.round(22 * scale)}px Arial, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(String(brand.avatarLetter || 'D').slice(0, 1).toUpperCase(), rowX, rowY + 1 * scale);

    const handleX = rowX + avatarRadius * 2 + Math.round(14 * scale);
    ctx.font = `600 ${handleFontSize}px Arial, sans-serif`;
    ctx.textAlign = 'left';
    const handleWidth = ctx.measureText(handle).width;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(handle, handleX, rowY + 1 * scale);

    const pillX = handleX + handleWidth + Math.round(18 * scale);
    const pillWidth = Math.round(ctx.measureText(brand.subscribeLabel || 'Subscribe').width + pillPadding * 2);
    const pillY = rowY - pillHeight / 2;
    ctx.shadowColor = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur = 5 * scale;
    ctx.shadowOffsetY = 1 * scale;
    drawRoundedRect(ctx, pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.font = `700 ${Math.round(21 * scale)}px Arial, sans-serif`;
    ctx.fillStyle = '#111111';
    ctx.textAlign = 'center';
    ctx.fillText(brand.subscribeLabel || 'Subscribe', pillX + pillWidth / 2, rowY + 1 * scale);
    ctx.restore();
    return canvas.toBuffer('raw');
  }

  // ── Draw masked text ──
  ctx.save();
  ctx.globalAlpha = clamp01(opacity) * clamp01(frameAlpha) * clamp01(slideAlpha);
  ctx.translate(centerX, yCenter);
  ctx.scale(frameScale, frameScale);
  ctx.translate(-centerX + slideOffset, -yCenter);
  if (blurAmount > 0.1 && 'filter' in ctx) ctx.filter = `blur(${blurAmount * scale}px)`;
  if (!isSlidingSignature) {
    ctx.beginPath();
    // Clipping rect unmasks text from startX to startX + revealedW
    ctx.rect(startX - 20, yCenter - 60 * scale, revealedW + 20, 120 * scale);
    ctx.clip();
  }

  // Top line: crisp sans-serif uppercase
  if (topText) {
    ctx.font = `bold ${topFontSize}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = secondaryColor;
    ctx.globalAlpha *= 0.85;
    ctx.shadowColor = `rgba(0, 0, 0, ${shadowStrength})`;
    ctx.shadowBlur = 6 * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawSpacedText(ctx, topText, centerX, topY, letterSpacing);
  }

  // Main line: viral gothic blackletter in Pirata One
  ctx.font = `${mainFontSize}px "${fontFamily}", Impact, "Arial Black", cursive, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Dedicated colored glow pass, followed by a crisp foreground pass.
  // A single text shadow is too subtle after video compression.
  if (glowStrength > 0.01) {
    const glowColor = brand.glowColor || primaryColor;
    const baseGlowAlpha = clamp01(opacity) * clamp01(frameAlpha) * clamp01(slideAlpha)
      * (0.32 + glowStrength * 0.68);
    [[46, 0.20], [28, 0.34], [12, 0.52]].forEach(([blur, alpha]) => {
      ctx.save();
      ctx.globalAlpha = baseGlowAlpha * alpha;
      ctx.fillStyle = glowColor;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = blur * scale;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      drawSpacedText(ctx, mainText, centerX, mainY, letterSpacing);
      ctx.restore();
    });
    ctx.save();
    ctx.globalAlpha = baseGlowAlpha * 0.52;
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = Math.max(2, Math.round((2 + glowStrength * 7) * scale));
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 18 * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    drawSpacedStrokeText(ctx, mainText, centerX, mainY, letterSpacing);
    ctx.restore();
  }

  ctx.globalAlpha = clamp01(opacity) * clamp01(frameAlpha) * clamp01(slideAlpha);
  ctx.fillStyle = primaryColor;
  ctx.shadowColor = `rgba(0, 0, 0, ${shadowStrength})`;
  ctx.shadowBlur = 8 * scale;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;
  if (outlineWidth > 0) {
    ctx.lineWidth = outlineWidth;
    ctx.strokeStyle = brand.outlineColor || '#0a0c10';
    ctx.strokeText(mainText, centerX, mainY);
  }
  drawSpacedText(ctx, mainText, centerX, mainY, letterSpacing);

  if (sinceText) {
    ctx.font = `600 ${Math.max(9, Math.round(12 * scale))}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = secondaryColor;
    ctx.shadowColor = `rgba(0, 0, 0, ${shadowStrength})`;
    ctx.shadowBlur = 4 * scale;
    drawSpacedText(ctx, sinceText, centerX, sinceY, Math.max(1, letterSpacing * 0.6));
  }

  ctx.restore();

  // ── Glowing white cursor bar at leading edge ──
  if (showCursor && cursorOpacity > 0.01) {
    const cursorX = startX + revealedW + slideOffset;
    ctx.save();
    ctx.globalAlpha = cursorOpacity * opacity * frameAlpha * slideAlpha;
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
 * @param {object}  [options.brand]                         - Brand profile typography/animation overrides
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
      let totalDuration = options.duration ?? (revealDur + holdDur + wipeDur);
      const opacity = options.opacity ?? 0.95;
      const yPosition = options.yPosition ?? DEFAULT_Y_POSITION;
      const brand = options.brand || {};

      // Probe the input video for dimensions
      const probeData = await probeVideoDimensions(inputPath);
      const canvasWidth = probeData.width || CANVAS_W;
      const canvasHeight = probeData.height || CANVAS_H;
      if (Number.isFinite(probeData.duration) && probeData.duration > startTime) {
        totalDuration = Math.min(totalDuration, Math.max(0.05, probeData.duration - startTime));
      }

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
        // Align the generated overlay stream with the requested start time.
        // Without this offset FFmpeg consumes the reveal frames too early and
        // the exit animation disappears before the visible window ends.
        `[1:v]format=rgba,setpts=PTS-STARTPTS+${startTime.toFixed(3)}/TB[wm];`,
        `[0:v][wm]overlay=0:0:enable='between(t,${startTime.toFixed(3)},${endTime.toFixed(3)})'[outv]`
      ].join('');

      const softwareCodecArgs = [
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-profile:v', 'high', '-level:v', '4.2', '-maxrate', '10M',
        '-bufsize', '16M', '-pix_fmt', 'yuv420p'
      ];

      const pipeToEncoder = async (codecArgs, usedHardware) => {
        const args = [
          '-y', '-i', inputPath,
          '-f', 'rawvideo', '-pixel_format', 'rgba',
          '-video_size', `${canvasWidth}x${canvasHeight}`, '-framerate', String(FPS),
          '-i', 'pipe:0', '-filter_complex', overlayFilter,
          '-map', '[outv]', '-map', '0:a?', ...codecArgs,
          '-c:a', 'copy', '-movflags', '+faststart', outputPath
        ];
        console.log(`[Watermark] FFmpeg args: ffmpeg ${args.join(' ')}`);
        const child = spawn(FFMPEG_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stderr = '';
        let closed = false;
        let closeCode = null;
        child.stderr.on('data', d => { stderr += d.toString(); });
        child.stdout.on('data', () => {});
        child.stdin.on('error', err => {
          if (err.code !== 'EPIPE') console.warn(`[Watermark] stdin error: ${err.message}`);
        });
        const closedPromise = new Promise((resolveClose, rejectClose) => {
          child.on('error', err => rejectClose(new Error(`Failed to spawn FFmpeg for watermark: ${err.message}`)));
          child.on('close', code => { closed = true; closeCode = code; resolveClose(code); });
        });

        let framesWritten = 0;
        const logInterval = Math.max(1, Math.floor(totalFrames / 5));
        for (let i = 0; i < totalFrames && !closed; i++) {
          const buf = renderFrame({ text: rawText, frameIndex: i, totalFrames, opacity, yPosition,
            revealFrames, holdFrames, wipeFrames, canvasWidth, canvasHeight, brand });
          const canContinue = child.stdin.write(buf);
          framesWritten++;
          if (framesWritten % logInterval === 0) {
            onProgress?.(`🏷️  Watermark: rendering frame ${framesWritten}/${totalFrames} (${Math.round((framesWritten / totalFrames) * 100)}%)...`);
          }
          if (!canContinue) await Promise.race([
            new Promise(res => child.stdin.once('drain', res)),
            closedPromise
          ]);
        }
        try { child.stdin.end(); } catch {}
        console.log(`[Watermark] Piped ${framesWritten}/${totalFrames} frames to FFmpeg`);
        const code = await closedPromise;
        if (code === 0 && fs.existsSync(outputPath)) return true;
        if (usedHardware && isDarwin) {
          try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
          console.warn('[Watermark] VideoToolbox unavailable; retrying watermark render with libx264.');
          return pipeToEncoder(softwareCodecArgs, false);
        }
        throw new Error(`FFmpeg watermark overlay failed: ${stderr.slice(-300)}`);
      };

      await pipeToEncoder(videoCodecArgs, isDarwin);
      console.log(`[Watermark] ✅ Watermark applied successfully: ${outputPath}`);
      resolve(outputPath);

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
      '-show_entries', 'stream=width,height,duration:format=duration',
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
          height: stream.height || CANVAS_H,
          duration: parseFloat(stream.duration || data.format?.duration || 0) || 0
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
