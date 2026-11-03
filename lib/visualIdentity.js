/**
 * Visual Identity Studio
 *
 * Shared configuration, cinematic grading presets, and the FFmpeg pass used by
 * both manual uploads and Auto-Pilot. Keeping this here makes the dashboard a
 * configuration surface for the real render pipeline instead of a preview-only
 * feature.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'visual-identity.json');

function resolveBinary(envVar, name, fallbacks) {
  const fromEnv = process.env[envVar];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const candidate of fallbacks) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return name;
}

const FFMPEG_BIN = resolveBinary('FFMPEG_PATH', 'ffmpeg', [
  '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'
]);

const COLOR_GRADING_PRESETS = {
  'cinematic-teal-orange': {
    label: 'Cinematic Teal & Orange', exposure: 0.02, contrast: 1.08, saturation: 1.06,
    temperature: 0.08, tint: 0.01, highlights: -0.06, shadows: 0.04, gamma: 0.98,
    vibrance: 0.12, fade: 0.015, vignette: 0.10, filmGrain: 0.025, glow: 0.025
  },
  'dark-cinematic': {
    label: 'Dark Cinematic', exposure: -0.04, contrast: 1.12, saturation: 0.92,
    temperature: -0.02, tint: 0.01, highlights: -0.10, shadows: -0.02, gamma: 0.94,
    vibrance: 0.04, fade: 0.01, vignette: 0.18, filmGrain: 0.035, glow: 0.015
  },
  'moody-blue': {
    label: 'Moody Blue', exposure: -0.02, contrast: 1.06, saturation: 0.94,
    temperature: -0.12, tint: -0.015, highlights: -0.05, shadows: 0.02, gamma: 0.97,
    vibrance: 0.08, fade: 0.02, vignette: 0.14, filmGrain: 0.03, glow: 0.018
  },
  'warm-film': {
    label: 'Warm Film', exposure: 0.025, contrast: 1.04, saturation: 1.02,
    temperature: 0.14, tint: 0.02, highlights: -0.04, shadows: 0.05, gamma: 1.0,
    vibrance: 0.08, fade: 0.035, vignette: 0.08, filmGrain: 0.04, glow: 0.02
  },
  'vibrant-anime': {
    label: 'Vibrant Anime', exposure: 0.02, contrast: 1.10, saturation: 1.16,
    temperature: 0.015, tint: 0.02, highlights: -0.03, shadows: 0.02, gamma: 1.01,
    vibrance: 0.20, fade: 0, vignette: 0.04, filmGrain: 0.012, glow: 0.035
  },
  'high-contrast': {
    label: 'High Contrast', exposure: 0, contrast: 1.18, saturation: 1.04,
    temperature: 0, tint: 0, highlights: -0.08, shadows: -0.01, gamma: 0.97,
    vibrance: 0.10, fade: 0, vignette: 0.12, filmGrain: 0.018, glow: 0.01
  },
  'reference-paradise': {
    label: 'Reference — Cool Steel Cinema', exposure: -0.01, contrast: 1.14, saturation: 0.90,
    temperature: -0.14, tint: -0.01, highlights: -0.12, shadows: 0.02, gamma: 0.98,
    vibrance: 0.045, fade: 0.006, vignette: 0.12, filmGrain: 0.012, glow: 0.012,
    sharpen: 0.28
  },
  custom: {
    label: 'Custom', exposure: 0, contrast: 1, saturation: 1, temperature: 0,
    tint: 0, highlights: 0, shadows: 0, gamma: 1, vibrance: 0, fade: 0,
    vignette: 0, filmGrain: 0, glow: 0
  }
};

const DEFAULT_BRAND_PROFILE = {
  id: 'ditch67',
  name: 'DITCH_67',
  brandName: 'DITCH_67',
  label: 'MADE BY',
  since: 'SINCE 2026',
  fontFamily: 'Pirata One',
  fontStyle: 'blackletter',
  fontSize: 44,
  letterSpacing: 0,
  primaryColor: '#ffffff',
  secondaryColor: '#d8e8ff',
  outlineColor: '#0a0c10',
  outlineWidth: 0,
  shadow: 0.85,
  glow: 0.24,
  colorPreset: 'cinematic-teal-orange',
  grading: { ...COLOR_GRADING_PRESETS['cinematic-teal-orange'] },
  animationStyle: 'cursor-reveal',
  startTime: 1,
  revealDuration: 0.6,
  holdDuration: 3,
  exitDuration: 0.5,
  visibility: 'animated',
  opacity: 0.92,
  position: 'bottom-center',
  customPosition: { x: 0.5, y: 0.82 },
  enabled: true
};

const DEFAULT_CONFIG = {
  activeProfileId: DEFAULT_BRAND_PROFILE.id,
  profiles: [DEFAULT_BRAND_PROFILE]
};

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function normalizeGrading(grading = {}, preset = 'custom') {
  const base = COLOR_GRADING_PRESETS[preset] || COLOR_GRADING_PRESETS.custom;
  const merged = { ...base, ...grading };
  return {
    preset: preset || 'custom',
    exposure: clamp(merged.exposure, -1, 1, base.exposure),
    contrast: clamp(merged.contrast, 0.5, 1.8, base.contrast),
    saturation: clamp(merged.saturation, 0, 2, base.saturation),
    temperature: clamp(merged.temperature, -1, 1, base.temperature),
    tint: clamp(merged.tint, -1, 1, base.tint),
    highlights: clamp(merged.highlights, -1, 1, base.highlights),
    shadows: clamp(merged.shadows, -1, 1, base.shadows),
    gamma: clamp(merged.gamma, 0.5, 1.5, base.gamma),
    vibrance: clamp(merged.vibrance, -1, 1, base.vibrance),
    fade: clamp(merged.fade, 0, 0.25, base.fade),
    vignette: clamp(merged.vignette, 0, 1, base.vignette),
    filmGrain: clamp(merged.filmGrain, 0, 0.25, base.filmGrain),
    glow: clamp(merged.glow, 0, 0.25, base.glow),
    sharpen: clamp(merged.sharpen, 0, 2, base.sharpen || 0)
  };
}

function normalizeProfile(profile = {}) {
  const preset = profile.colorPreset || 'cinematic-teal-orange';
  const merged = { ...DEFAULT_BRAND_PROFILE, ...profile };
  const customPosition = profile.customPosition || DEFAULT_BRAND_PROFILE.customPosition;
  return {
    ...merged,
    id: String(profile.id || merged.id || `profile-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '-'),
    name: String(profile.name || merged.name).slice(0, 80),
    brandName: String(profile.brandName || merged.brandName).slice(0, 48),
    label: String(profile.label ?? merged.label).slice(0, 32),
    since: String(profile.since ?? merged.since).slice(0, 32),
    fontSize: clamp(profile.fontSize, 18, 120, merged.fontSize),
    letterSpacing: clamp(profile.letterSpacing, -4, 20, merged.letterSpacing),
    shadow: clamp(profile.shadow, 0, 1, merged.shadow),
    glow: clamp(profile.glow, 0, 1, merged.glow),
    outlineWidth: clamp(profile.outlineWidth, 0, 12, merged.outlineWidth),
    startTime: clamp(profile.startTime, 0, 55, merged.startTime),
    revealDuration: clamp(profile.revealDuration, 0.05, 4, merged.revealDuration),
    holdDuration: clamp(profile.holdDuration, 0.1, 20, merged.holdDuration),
    exitDuration: clamp(profile.exitDuration, 0.05, 4, merged.exitDuration),
    opacity: clamp(profile.opacity, 0.1, 1, merged.opacity),
    position: ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right', 'bottom-center', 'custom'].includes(profile.position)
      ? profile.position : merged.position,
    customPosition: {
      x: clamp(customPosition.x, 0.08, 0.92, 0.5),
      y: clamp(customPosition.y, 0.10, 0.90, 0.82)
    },
    colorPreset: COLOR_GRADING_PRESETS[preset] ? preset : 'custom',
    grading: normalizeGrading(profile.grading || {}, preset),
    enabled: profile.enabled !== false,
    visibility: profile.visibility === 'persistent' ? 'persistent' : 'animated'
  };
}

function normalizeConfig(config = {}) {
  const rawProfiles = Array.isArray(config.profiles) && config.profiles.length
    ? config.profiles : DEFAULT_CONFIG.profiles;
  const profiles = rawProfiles.map(normalizeProfile);
  const activeProfileId = profiles.some(p => p.id === config.activeProfileId)
    ? config.activeProfileId : profiles[0].id;
  return { activeProfileId, profiles };
}

function getVisualIdentityConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const initial = normalizeConfig(DEFAULT_CONFIG);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch (err) {
    console.warn('[VisualIdentity] Could not read config, using defaults:', err.message);
    return normalizeConfig(DEFAULT_CONFIG);
  }
}

function saveVisualIdentityConfig(config) {
  const normalized = normalizeConfig(config);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2));
  return normalized;
}

function getActiveBrandProfile(config = getVisualIdentityConfig()) {
  const normalized = normalizeConfig(config);
  return normalized.profiles.find(p => p.id === normalized.activeProfileId) || normalized.profiles[0];
}

function buildColorGradeFilter(grading = {}, inputLabel = '0:v', outputLabel = 'outv') {
  const g = normalizeGrading(grading, grading.preset || 'custom');
  // The mapping keeps the controls deliberately gentle. This protects skin
  // tones and highlight detail while still making each preset recognizable.
  const brightness = (g.exposure * 0.14) + (g.fade * 0.08);
  const redBalance = (g.temperature * 0.16) + (g.tint * 0.04);
  const blueBalance = (-g.temperature * 0.14) + (g.tint * 0.02);
  const greenBalance = -g.tint * 0.04;
  const shadowLift = g.shadows * 0.09;
  const highlightRollOff = g.highlights * 0.08;
  const parts = [
    `eq=brightness=${brightness.toFixed(4)}:contrast=${g.contrast.toFixed(4)}:saturation=${g.saturation.toFixed(4)}:gamma=${g.gamma.toFixed(4)}`,
    `colorbalance=rs=${redBalance.toFixed(4)}:gs=${greenBalance.toFixed(4)}:bs=${blueBalance.toFixed(4)}:rh=${(redBalance + highlightRollOff).toFixed(4)}:gh=${highlightRollOff.toFixed(4)}:bh=${(blueBalance + highlightRollOff).toFixed(4)}:rm=${shadowLift.toFixed(4)}:gm=${shadowLift.toFixed(4)}:bm=${shadowLift.toFixed(4)}`,
    `vibrance=intensity=${g.vibrance.toFixed(4)}`
  ];
  if (g.fade > 0.001) {
    parts.push(`curves=all='0/${Math.min(0.20, g.fade).toFixed(4)} 0.5/0.5 1/${Math.max(0.80, 1 - g.fade).toFixed(4)}'`);
  }
  if (g.vignette > 0.001) parts.push(`vignette=PI/${Math.max(3, Math.round(14 - g.vignette * 8))}`);
  if (g.filmGrain > 0.001) parts.push(`noise=alls=${Math.round(g.filmGrain * 32)}:allf=t+u`);
  if (g.sharpen > 0.001) parts.push(`unsharp=5:5:${g.sharpen.toFixed(3)}:5:5:0`);

  const chain = parts.join(',');
  if (g.glow <= 0.001) return `[${inputLabel}]${chain},format=yuv420p[${outputLabel}]`;
  const glowSigma = (1.2 + g.glow * 10).toFixed(2);
  return `[${inputLabel}]${chain},split=2[gradebase][gradeglow];` +
    `[gradeglow]gblur=sigma=${glowSigma}[gradeblur];` +
    `[gradebase][gradeblur]blend=all_mode=screen:all_opacity=${g.glow.toFixed(4)},format=yuv420p[${outputLabel}]`;
}

function getCodecArgs() {
  return process.platform === 'darwin'
    ? ['-c:v', 'h264_videotoolbox', '-b:v', '8M', '-maxrate', '12M', '-bufsize', '16M', '-profile:v', 'high', '-pix_fmt', 'yuv420p']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-level:v', '4.2', '-pix_fmt', 'yuv420p'];
}

function applyColorGrade(inputPath, outputPath, grading, onProgress) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) return reject(new Error(`Input video not found: ${inputPath}`));
    onProgress?.(`🎞️ Applying ${COLOR_GRADING_PRESETS[grading?.preset]?.label || 'custom'} cinematic grade...`);
    const filter = buildColorGradeFilter(grading, '0:v', 'graded');
    const run = (codecArgs, usedHardware) => {
      const args = [
        '-y', '-i', inputPath,
        '-filter_complex', filter,
        '-map', '[graded]', '-map', '0:a?',
        ...codecArgs, '-c:a', 'copy', '-movflags', '+faststart', outputPath
      ];
      const child = spawn(FFMPEG_BIN, args);
      let stderr = '';
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('error', err => reject(new Error(`Failed to spawn FFmpeg for color grading: ${err.message}`)));
      child.on('close', code => {
        if (code === 0 && fs.existsSync(outputPath)) return resolve(outputPath);
        // VideoToolbox is preferred on Apple Silicon, but it can be unavailable
        // in headless/CI sessions. Fall back to libx264 without dropping the job.
        if (usedHardware && process.platform === 'darwin') {
          try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
          return run(['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-level:v', '4.2', '-pix_fmt', 'yuv420p'], false);
        }
        reject(new Error(`FFmpeg color grading failed: ${stderr.slice(-400)}`));
      });
    };
    run(getCodecArgs(), process.platform === 'darwin');
  });
}

async function applyColorGradeInPlace(filePath, grading, onProgress) {
  const ext = path.extname(filePath);
  const tempOutput = path.join(path.dirname(filePath), `${path.basename(filePath, ext)}_grade_${Date.now()}${ext}`);
  try {
    await applyColorGrade(filePath, tempOutput, grading, onProgress);
    fs.unlinkSync(filePath);
    fs.renameSync(tempOutput, filePath);
    return filePath;
  } catch (err) {
    try { if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput); } catch {}
    throw err;
  }
}

module.exports = {
  CONFIG_PATH,
  COLOR_GRADING_PRESETS,
  DEFAULT_BRAND_PROFILE,
  getVisualIdentityConfig,
  saveVisualIdentityConfig,
  getActiveBrandProfile,
  normalizeProfile,
  normalizeGrading,
  buildColorGradeFilter,
  applyColorGrade,
  applyColorGradeInPlace
};
