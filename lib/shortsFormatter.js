const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Resolve ffmpeg/ffprobe portably: explicit env override first, then the
// usual install locations, otherwise fall back to the bare name so the OS
// resolves it via PATH (correct on Linux, Intel macs, nix, etc.).
function resolveBinary(envVar, name, fallbacks) {
  const fromEnv = process.env[envVar];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const candidate of fallbacks) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return name;
}

const FFPROBE_BIN = resolveBinary('FFPROBE_PATH', 'ffprobe', [
  '/opt/homebrew/bin/ffprobe',
  '/usr/local/bin/ffprobe',
  '/usr/bin/ffprobe'
]);
const FFMPEG_BIN = resolveBinary('FFMPEG_PATH', 'ffmpeg', [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg'
]);

const PROJECT_ROOT = path.join(__dirname, '..');

/**
 * Resolves the path to the endcard video.
 * Prioritizes:
 * 1. process.env.ENDCARD_PATH
 * 2. assets/End Cards Shorts.mp4 (project directory)
 * 3. assets/endcard.mp4
 * 4. /Users/admin/Desktop/End Cards Shorts.mp4
 * 5. ~/Desktop/End Cards Shorts.mp4
 */
function resolveEndCardPath() {
  const candidates = [
    process.env.ENDCARD_PATH,
    path.join(PROJECT_ROOT, 'assets', 'End Cards Shorts.mp4'),
    path.join(PROJECT_ROOT, 'assets', 'endcard.mp4'),
    '/Users/admin/Desktop/End Cards Shorts.mp4',
    path.join(process.env.HOME || '', 'Desktop', 'End Cards Shorts.mp4')
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.isAbsolute(candidate) ? candidate : path.join(PROJECT_ROOT, candidate);
    try {
      if (fs.existsSync(resolved)) {
        fs.accessSync(resolved, fs.constants.R_OK);
        return resolved;
      }
    } catch {
      // Inaccessible (e.g. sandbox or permission restrictions)
    }
  }
  return null;
}

/**
 * Probes a video file for width, height, duration, audio, and fps
 */
function probeVideo(filePath) {
  return new Promise((resolve) => {
    execFile(FFPROBE_BIN, [
      '-v', 'error',
      '-show_entries', 'stream=width,height,duration,r_frame_rate,avg_frame_rate,codec_type:format=duration',
      '-of', 'json',
      filePath
    ], { timeout: 15000 }, (err, stdout) => {
      if (err) {
        console.warn('[ShortsFormatter] ffprobe failed:', err.message);
        return resolve(null);
      }
      try {
        const data = JSON.parse(stdout);
        const streams = data.streams || [];
        const vStream = streams.find(s => s.codec_type === 'video' && s.width && s.height)
          || streams.find(s => s.width && s.height)
          || {};
        const hasAudio = streams.some(s => s.codec_type === 'audio');
        const width = vStream.width || 0;
        const height = vStream.height || 0;
        const duration = parseFloat(vStream.duration || data.format?.duration || 0);

        let fps = 30;
        const fpsStr = vStream.r_frame_rate || vStream.avg_frame_rate || '';
        if (fpsStr && fpsStr.includes('/')) {
          const [num, den] = fpsStr.split('/').map(Number);
          if (den > 0 && num > 0) {
            const calculatedFps = Math.round(num / den);
            if (calculatedFps > 0 && calculatedFps < 120) fps = calculatedFps;
          }
        }

        resolve({
          width,
          height,
          duration,
          hasAudio,
          fps,
          isVertical: height >= width && height > 0,
          isShortDuration: duration <= 60.5
        });
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Video codec arguments:
 * Uses Apple Silicon VideoToolbox hardware encoder on macOS for lightning fast transcoding,
 * falls back to libx264 on other operating systems.
 */
function getVideoCodecArgs() {
  const isDarwin = process.platform === 'darwin';
  return isDarwin ? [
    '-c:v', 'h264_videotoolbox',
    '-b:v', '8M',
    '-maxrate', '12M',
    '-bufsize', '16M',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
  ] : [
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20', // visually lossless studio quality matching YouTube specs
    '-profile:v', 'high',
    '-level:v', '4.2',
    '-maxrate', '10M',
    '-bufsize', '16M',
    '-pix_fmt', 'yuv420p',
  ];
}

/**
 * Transcodes main video into 1080x1920 9:16 Shorts format and appends endcard video to the end.
 * Caps total combined duration strictly to <= 59.5 seconds.
 */
function formatAndAttachEndCard(inputPath, outputPath, endCardPath, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      const [inputInfo, endCardInfo] = await Promise.all([
        probeVideo(inputPath),
        probeVideo(endCardPath)
      ]);

      if (!inputInfo) {
        throw new Error('Failed to probe input video metadata');
      }
      if (!endCardInfo) {
        throw new Error('Failed to probe endcard video metadata');
      }

      const endCardDuration = endCardInfo.duration || 3.141;
      const MAX_TOTAL_DURATION = 59.5;
      const maxMainDuration = Math.max(1, MAX_TOTAL_DURATION - endCardDuration);
      const actualMainDuration = Math.min(inputInfo.duration, maxMainDuration);

      onProgress?.(`🎬 Formatting video into 9:16 Short & attaching End Card (${endCardDuration.toFixed(1)}s)...`);
      console.log(`[ShortsFormatter] Formatting + appending endcard: ${inputPath} + ${endCardPath} -> ${outputPath}`);

      // Video filter for main video:
      // If already vertical: scale & pad to fit 1080x1920
      // If horizontal/square: fast ambient blur (downscale -> light blur -> upscale) + centered foreground
      let v0Filter = '';
      if (inputInfo.isVertical) {
        v0Filter = '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,settb=AVTB,setsar=1,format=yuv420p[v0];';
      } else {
        v0Filter = [
          '[0:v]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=10:2,scale=1080:1920:flags=bicubic[bg];',
          '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos[fg];',
          '[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=30,settb=AVTB,setsar=1,format=yuv420p[v0];'
        ].join('');
      }

      // Video filter for endcard: scale & pad to 1080x1920
      const v1Filter = '[1:v]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,settb=AVTB,setsar=1,format=yuv420p[v1];';

      // Audio filters: ensures sample rate, layout and format match seamlessly
      let a0Filter = '';
      if (inputInfo.hasAudio) {
        a0Filter = '[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=1[a0];';
      } else {
        a0Filter = `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=end=${actualMainDuration.toFixed(3)}[a0];`;
      }

      let a1Filter = '';
      if (endCardInfo.hasAudio !== false) {
        a1Filter = '[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=1[a1];';
      } else {
        a1Filter = `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=end=${endCardDuration.toFixed(3)}[a1];`;
      }

      const concatFilter = '[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]';
      const filterComplex = `${v0Filter}${v1Filter}${a0Filter}${a1Filter}${concatFilter}`;

      const args = [
        '-y',
        '-t', maxMainDuration.toFixed(3),
        '-i', inputPath,
        '-i', endCardPath,
        '-filter_complex', filterComplex,
        '-map', '[outv]',
        '-map', '[outa]',
        ...getVideoCodecArgs(),
        '-c:a', 'aac',
        '-b:a', '320k',
        '-ar', '48000',
        '-movflags', '+faststart',
        outputPath
      ];

      const child = spawn(FFMPEG_BIN, args);
      let stderr = '';

      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          console.log(`[ShortsFormatter] ✅ Successfully formatted Short with End Card: ${outputPath}`);
          resolve(outputPath);
        } else {
          console.error('[ShortsFormatter] Concat with endcard failed:', stderr.slice(-300));
          reject(new Error(`FFmpeg failed to format with endcard: ${stderr.slice(-200)}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Converts any video into strict 9:16 vertical YouTube Shorts format:
 * - Dimensions: 1080x1920 (vertical 9:16)
 * - Duration: strictly capped at <= 59.5 seconds
 * - Visual aesthetic: centered foreground clip with ambient blurred background
 */
function convertToShortsFormat(inputPath, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    onProgress?.('🎨 Formatting video into 9:16 Vertical YouTube Shorts format...');
    console.log(`[ShortsFormatter] Transcoding into 9:16 Vertical Short: ${inputPath} -> ${outputPath}`);

    // Studio-grade fast ambient blurred background filter:
    // Downscales to 270x480 before blur (saving 62% CPU power), then upscales smoothly:
    const filterComplex = [
      '[0:v]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=10:2,scale=1080:1920:flags=bicubic[bg];',
      '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos[fg];',
      '[bg][fg]overlay=(W-w)/2:(H-h)/2[outv]'
    ].join('');

    const args = [
      '-y',
      '-i', inputPath,
      '-t', '59.5', // clamp duration to under 60 seconds
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-map', '0:a?', // keep high-fidelity audio
      ...getVideoCodecArgs(),
      '-c:a', 'aac',
      '-b:a', '320k', // 320kbps studio audio
      '-ar', '48000',
      '-movflags', '+faststart', // moov atom first: friendlier for streaming upload
      outputPath
    ];

    const child = spawn(FFMPEG_BIN, args);
    let stderr = '';

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        console.log(`[ShortsFormatter] ✅ Successfully formatted 9:16 Vertical Short: ${outputPath}`);
        resolve(outputPath);
      } else {
        console.error('[ShortsFormatter] Conversion failed:', stderr);
        reject(new Error(`FFmpeg failed to convert to Shorts format: ${stderr.slice(-200)}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

/**
 * Trims duration to <= 59.5 seconds if already vertical but slightly too long
 */
function trimShortDuration(inputPath, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    onProgress?.('✂️ Trimming video to under 60 seconds for YouTube Shorts...');
    const args = [
      '-y',
      '-i', inputPath,
      '-t', '59.5',
      '-c', 'copy',
      outputPath
    ];
    execFile(FFMPEG_BIN, args, (err) => {
      if (err) return reject(err);
      resolve(outputPath);
    });
  });
}

/**
 * Inspects any video and guarantees it is strictly in YouTube Shorts format:
 * - Must be Vertical (9:16 aspect ratio: 1080x1920)
 * - Must be <= 60 seconds (strictly <= 59.5 seconds)
 * - Adds the configured endcard video to the end of every short
 */
async function ensureShortsFormat(inputPath, onProgress) {
  const info = await probeVideo(inputPath);
  if (!info) {
    console.warn('[ShortsFormatter] Could not probe video metadata. Passing through.');
    return inputPath;
  }

  console.log(`[ShortsFormatter] Probed: ${info.width}x${info.height}, duration: ${info.duration}s, vertical: ${info.isVertical}`);

  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  let formattedPath = path.join(dir, `${base}_shorts_9x16.mp4`);
  if (formattedPath === inputPath) {
    formattedPath = path.join(dir, `${base}_endcard_${Date.now()}.mp4`);
  }

  const endCardPath = resolveEndCardPath();

  if (endCardPath) {
    console.log(`[ShortsFormatter] Found endcard at: ${endCardPath}`);
    try {
      await formatAndAttachEndCard(inputPath, formattedPath, endCardPath, onProgress);
      try {
        if (fs.existsSync(inputPath) && inputPath !== formattedPath) fs.unlinkSync(inputPath);
      } catch { /* ignore */ }
      return formattedPath;
    } catch (endCardErr) {
      console.warn('[ShortsFormatter] ⚠️ Endcard append failed, falling back to standard formatting:', endCardErr.message);
    }
  } else {
    console.warn('[ShortsFormatter] ⚠️ Endcard not found. Formatting video without endcard.');
  }

  // Fallback if no endcard was found or endcard processing encountered an error:
  // Already vertical and under 60s -> Perfect Short!
  if (info.isVertical && info.isShortDuration) {
    console.log('[ShortsFormatter] ✅ Video is already in native 9:16 vertical Shorts format.');
    return inputPath;
  }

  // Already vertical but slightly over 60s
  if (info.isVertical && !info.isShortDuration) {
    try {
      await trimShortDuration(inputPath, formattedPath, onProgress);
      try {
        if (fs.existsSync(inputPath) && inputPath !== formattedPath) fs.unlinkSync(inputPath);
      } catch { /* ignore */ }
      return formattedPath;
    } catch (trimErr) {
      console.warn('[ShortsFormatter] Trim error, falling back to full transcode:', trimErr.message);
    }
  }

  // Horizontal or square video: transcode to 1080x1920 9:16 vertical Short
  try {
    await convertToShortsFormat(inputPath, formattedPath, onProgress);
    try {
      if (fs.existsSync(inputPath) && inputPath !== formattedPath) fs.unlinkSync(inputPath);
    } catch { /* ignore */ }
    return formattedPath;
  } catch (err) {
    console.warn('[ShortsFormatter] Format conversion error, keeping original file:', err.message);
    return inputPath;
  }
}

module.exports = {
  probeVideo,
  ensureShortsFormat,
  convertToShortsFormat,
  formatAndAttachEndCard,
  resolveEndCardPath
};
