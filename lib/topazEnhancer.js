const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_TOPAZ_APP = '/Applications/Topaz Video AI.app';
const DEFAULT_TOPAZ_FFMPEG = path.join(DEFAULT_TOPAZ_APP, 'Contents', 'MacOS', 'ffmpeg');
const DEFAULT_TOPAZ_MODELS = path.join(DEFAULT_TOPAZ_APP, 'Contents', 'Resources', 'models');

/**
 * Checks if Topaz Video AI is installed and returns key paths.
 */
function getTopazInfo() {
  const customPath = process.env.TOPAZ_VIDEO_AI_CLI;
  if (customPath && fs.existsSync(customPath)) {
    return {
      installed: true,
      ffmpegPath: customPath,
      modelsDir: process.env.TVAI_MODEL_DIR || DEFAULT_TOPAZ_MODELS
    };
  }

  if (fs.existsSync(DEFAULT_TOPAZ_FFMPEG)) {
    return {
      installed: true,
      ffmpegPath: DEFAULT_TOPAZ_FFMPEG,
      modelsDir: DEFAULT_TOPAZ_MODELS
    };
  }

  return {
    installed: false,
    ffmpegPath: null,
    modelsDir: null
  };
}

function isTopazInstalled() {
  return getTopazInfo().installed;
}

function splitArgs(value) {
  return String(value || '').match(/"[^\"]*"|'[^']*'|\S+/g)?.map((part) =>
    part.replace(/^(["'])(.*)\1$/, '$2')
  ) || [];
}

/**
 * Probes video properties using ffprobe.
 */
function probeVideoProperties(videoPath) {
  const ffprobeBin = fs.existsSync('/opt/homebrew/bin/ffprobe')
    ? '/opt/homebrew/bin/ffprobe'
    : (fs.existsSync('/usr/local/bin/ffprobe') ? '/usr/local/bin/ffprobe' : 'ffprobe');

  try {
    const out = execSync(
      `"${ffprobeBin}" -v error -select_streams v:0 -show_entries stream=width,height,bit_rate -show_entries format=bit_rate -of json "${videoPath}"`,
      { encoding: 'utf8' }
    );
    const data = JSON.parse(out);
    const stream = data.streams?.[0] || {};
    const width = parseInt(stream.width, 10) || 1080;
    const height = parseInt(stream.height, 10) || 1920;
    const bitrate = parseInt(stream.bit_rate || data.format?.bit_rate, 10) || 0;
    return { width, height, bitrate };
  } catch {
    return { width: 1080, height: 1920, bitrate: 0 };
  }
}

/**
 * Dynamically selects the best Topaz model and parameters based on video resolution,
 * bitrate, and content type (gaming, faces/vlogs, compressed reposts, cinematic).
 */
function selectDynamicTopazModel({ inputPath, title = '', niche = '', description = '' } = {}) {
  const meta = probeVideoProperties(inputPath);
  const text = `${title} ${niche} ${description}`.toLowerCase();

  const isFaceOrVlog = /\b(face|reaction|interview|podcast|streamer|talk|review|speech|person|human|vlog|actor|actress|influencer)\b/.test(text);
  const isGamingOrCgi = /\b(game|gaming|gameplay|gta|cod|fortnite|minecraft|fps|cyberpunk|anime|cgi|render|motion|speedrun|esports)\b/.test(text);
  const isLowResOrCompressed = meta.width < 720 || meta.height < 1280 || (meta.bitrate > 0 && meta.bitrate < 2500000);

  if (isFaceOrVlog) {
    return {
      model: 'iris-2',
      reason: 'Detected face/talking-head content: Iris specializes in human facial recovery and natural skin clarity.'
    };
  }

  if (isGamingOrCgi) {
    return {
      model: 'prob-4',
      reason: 'Detected fast-paced gaming/CGI: Proteus preserves sharp HUD elements and motion edges without ghosting.'
    };
  }

  if (isLowResOrCompressed) {
    return {
      model: 'ahq-12',
      reason: `Detected low-res/compressed source (${meta.width}x${meta.height}): Artemis cleans macroblocks and compression noise.`
    };
  }

  return {
    model: 'prob-4',
    reason: 'Standard high-motion clip: Proteus provides balanced detail recovery and adaptive clarity.'
  };
}

/**
 * Builds the optimal FFmpeg arguments for Topaz Video AI.
 */
function buildTopazArgs({ inputPath, outputPath, model = 'prob-4', resolution = '1440x2560' }) {
  // Construct the video filter chain
  const filters = [];

  // Base Topaz upscale filter (scale=1 runs the 1x neural model to enhance details/clean artifacts)
  filters.push(`tvai_up=model=${model}:scale=1:device=0`);

  // Target resolution scaling: preserve 100% of the video without cropping or distortion
  if (resolution === '1440x2560') {
    filters.push('scale=1440:2560:force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd,pad=1440:2560:(ow-iw)/2:(oh-ih)/2:color=black');
  } else if (resolution === '1080x1920') {
    filters.push('scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black');
  }

  const vf = filters.join(',');

  const videoCodecArgs = process.platform === 'darwin'
    ? ['-c:v', 'h264_videotoolbox', '-b:v', '25M', '-maxrate', '32M', '-bufsize', '50M', '-pix_fmt', 'yuv420p']
    : ['-c:v', 'libx264', '-crf', '17', '-preset', 'fast', '-pix_fmt', 'yuv420p'];

  return [
    '-y',
    '-i', inputPath,
    '-vf', vf,
    ...videoCodecArgs,
    '-c:a', 'copy',
    '-movflags', '+faststart',
    outputPath
  ];
}

/**
 * Runs Topaz Video AI enhancement on a video file.
 */
function runTopaz(inputPath, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    const topazInfo = getTopazInfo();
    const executable = options.executable || topazInfo.ffmpegPath;
    const modelsDir = options.modelsDir || topazInfo.modelsDir;

    if (!executable || !fs.existsSync(executable)) {
      return reject(new Error('Topaz Video AI CLI not found. Please verify Topaz Video AI is installed in /Applications.'));
    }
    if (!fs.existsSync(inputPath)) {
      return reject(new Error(`Input video not found: ${inputPath}`));
    }

    const { model = 'auto', resolution = '1440x2560', argsTemplate, onProgress } = options;

    let selectedModel = model;
    if (!selectedModel || selectedModel === 'auto') {
      const decision = selectDynamicTopazModel({
        inputPath,
        title: options.title,
        niche: options.niche,
        description: options.description
      });
      selectedModel = decision.model;
      onProgress?.(`🧠 Dynamic Topaz Selector: ${decision.reason}`);
    }

    let args;
    if (argsTemplate && argsTemplate.includes('{input}') && argsTemplate.includes('{output}')) {
      args = splitArgs(argsTemplate).map((arg) =>
        arg.replaceAll('{input}', inputPath).replaceAll('{output}', outputPath)
      );
    } else {
      args = buildTopazArgs({ inputPath, outputPath, model: selectedModel, resolution });
    }

    const modelLabels = {
      'prob-4': 'Proteus (Auto-Tune / Detail Recovery)',
      'ahq-12': 'Artemis (High Quality / Denoise)',
      'ghq-5': 'Gaia (High Detail)',
      'iris-2': 'Iris (Face / Portrait Enhancement)'
    };
    const friendlyModel = modelLabels[selectedModel] || selectedModel;

    onProgress?.(`✨ Starting Topaz Video AI enhancement with ${friendlyModel} [${resolution}]...`);

    const env = {
      ...process.env,
      TVAI_MODEL_DIR: modelsDir,
      TVAI_MODEL_DATA_DIR: modelsDir
    };

    const child = spawn(executable, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let lastProgressTime = 0;

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-4000);

      const now = Date.now();
      if (now - lastProgressTime > 1500) {
        const frameMatch = text.match(/frame=\s*(\d+)/);
        const fpsMatch = text.match(/fps=\s*([0-9.]+)/);
        const timeMatch = text.match(/time=([0-9:.]+)/);
        const speedMatch = text.match(/speed=\s*([0-9.]+x)/);

        if (frameMatch || timeMatch) {
          const frame = frameMatch ? `frame ${frameMatch[1]}` : '';
          const fps = fpsMatch ? `(${fpsMatch[1]} fps)` : '';
          const time = timeMatch ? `processed ${timeMatch[1].split('.')[0]}` : '';
          const speed = speedMatch ? `@ ${speedMatch[1]}` : '';
          const progressMsg = `✨ Topaz AI: ${[frame, fps, time, speed].filter(Boolean).join(' ')}...`;
          onProgress?.(progressMsg);
          lastProgressTime = now;
        }
      }
    });

    child.on('error', (err) => reject(new Error(`Could not start Topaz Video AI: ${err.message}`)));

    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        return resolve(outputPath);
      }
      reject(new Error(`Topaz Video AI exited with code ${code}. ${stderr.slice(-400)}`));
    });
  });
}

/**
 * Enhances a video file in-place using Topaz Video AI.
 */
async function enhanceWithTopazInPlace(filePath, options = {}) {
  const ext = path.extname(filePath) || '.mp4';
  const outputPath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath, ext)}_topaz_${Date.now()}${ext}`
  );

  try {
    await runTopaz(filePath, outputPath, options);
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error('Topaz output file is missing or empty.');
    }
    fs.unlinkSync(filePath);
    fs.renameSync(outputPath, filePath);
    return filePath;
  } catch (err) {
    if (fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath); } catch {}
    }
    throw err;
  }
}

module.exports = {
  getTopazInfo,
  isTopazInstalled,
  buildTopazArgs,
  runTopaz,
  enhanceWithTopazInPlace,
  selectDynamicTopazModel,
  probeVideoProperties,
  splitArgs,
  DEFAULT_TOPAZ_FFMPEG,
  DEFAULT_TOPAZ_MODELS
};
