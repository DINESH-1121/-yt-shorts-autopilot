const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG_BIN = fs.existsSync('/opt/homebrew/bin/ffmpeg')
  ? '/opt/homebrew/bin/ffmpeg'
  : (fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg');

// A 1440p 9:16 upload gives YouTube more detail to work with than a 1080p
// re-encode, while keeping the file practical for short-form uploads.
const SHORTS_WIDTH = 1440;
const SHORTS_HEIGHT = 2560;

function localEnhancementFilter() {
  return [
    '[0:v]format=yuv420p',
    'deband=1thr=0.018:2thr=0.018:range=12:blur=1',
    `scale=${SHORTS_WIDTH}:${SHORTS_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd+full_chroma_int`,
    `pad=${SHORTS_WIDTH}:${SHORTS_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
    // These are deliberately subtle. They clean compression noise without
    // inventing detail or leaving the halos common in aggressive sharpening.
    'cas=strength=0.24',
    'unsharp=5:5:0.18:5:5:0',
    'setsar=1[outv]'
  ].join(',');
}

function codecArgs() {
  return process.platform === 'darwin'
    ? ['-c:v', 'h264_videotoolbox', '-b:v', '22M', '-maxrate', '28M', '-bufsize', '44M', '-profile:v', 'high', '-pix_fmt', 'yuv420p']
    : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-maxrate', '24M', '-bufsize', '48M', '-profile:v', 'high', '-level:v', '5.1', '-pix_fmt', 'yuv420p'];
}

const SOFTWARE_CODEC_ARGS = [
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-maxrate', '24M',
  '-bufsize', '48M', '-profile:v', 'high', '-level:v', '5.1', '-pix_fmt', 'yuv420p'
];

function enhanceForYouTubeShorts(inputPath, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) return reject(new Error(`Input video not found: ${inputPath}`));

    onProgress?.('✨ Running local high-quality enhancement (deband, Lanczos upscale, adaptive sharpen)...');
    const run = (videoArgs, allowFallback) => {
      const args = [
        '-y', '-i', inputPath,
        '-filter_complex', localEnhancementFilter(),
        '-map', '[outv]', '-map', '0:a?',
        ...videoArgs,
        '-c:a', 'copy',
        '-movflags', '+faststart',
        outputPath
      ];

      const child = spawn(FFMPEG_BIN, args);
      let stderr = '';
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('error', err => reject(new Error(`Could not start local enhancer: ${err.message}`)));
      child.on('close', code => {
        if (code === 0 && fs.existsSync(outputPath)) return resolve(outputPath);
        if (allowFallback && process.platform === 'darwin') {
          try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
          onProgress?.('✨ Hardware encoder unavailable; finishing with the high-quality local software encoder...');
          return run(SOFTWARE_CODEC_ARGS, false);
        }
        reject(new Error(`Local enhancer failed: ${stderr.slice(-400)}`));
      });
    };
    run(codecArgs(), process.platform === 'darwin');
  });
}

async function enhanceForYouTubeShortsInPlace(filePath, onProgress) {
  const ext = path.extname(filePath) || '.mp4';
  const outputPath = path.join(path.dirname(filePath), `${path.basename(filePath, ext)}_enhanced_${Date.now()}${ext}`);
  await enhanceForYouTubeShorts(filePath, outputPath, onProgress);
  fs.unlinkSync(filePath);
  fs.renameSync(outputPath, filePath);
  return filePath;
}

module.exports = {
  SHORTS_WIDTH,
  SHORTS_HEIGHT,
  localEnhancementFilter,
  enhanceForYouTubeShorts,
  enhanceForYouTubeShortsInPlace
};
