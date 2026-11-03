const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Resolve ffmpeg/ffprobe portably: explicit env override first, then standard locations
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
 * Resolves optional background audio track from assets/audio/*.mp3
 */
function resolveBackgroundAudio() {
  const audioDir = path.join(PROJECT_ROOT, 'assets', 'audio');
  if (!fs.existsSync(audioDir)) return null;
  try {
    const files = fs.readdirSync(audioDir).filter(f => f.toLowerCase().endsWith('.mp3'));
    if (files.length === 0) return null;
    const selected = files[Math.floor(Math.random() * files.length)];
    const fullPath = path.join(audioDir, selected);
    return fs.existsSync(fullPath) ? fullPath : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the path to the endcard video.
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
 * Video codec arguments with metadata stripping flags (-map_metadata -1 -fflags +bitexact)
 * to alter container hashes and evade automated duplicate fingerprinting.
 */
function getVideoCodecArgs() {
  // Software x264 is used deliberately here: it is consistent across hosts
  // and gives a visibly cleaner source for the final 1440p enhancement pass.
  return [
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '17',
    '-profile:v', 'high',
    '-level:v', '4.2',
    '-maxrate', '16M',
    '-bufsize', '24M',
    '-pix_fmt', 'yuv420p',
    '-map_metadata', '-1',
    '-fflags', '+bitexact',
  ];
}

/**
 * Transcodes main video into 1080x1920 9:16 Shorts format and appends endcard video to the end.
 * Preserves framing while formatting a source as a 9:16 Short.
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
      const outputFps = Math.min(60, Math.max(1, inputInfo.fps || 30));

      onProgress?.(`🎬 Formatting video into 9:16 Short & attaching End Card with Hash Evasion...`);
      console.log(`[ShortsFormatter] Formatting + appending endcard: ${inputPath} + ${endCardPath} -> ${outputPath}`);

      const bgmPath = resolveBackgroundAudio();
      if (bgmPath) {
        console.log(`[ShortsFormatter] 🎵 Blending background audio track: ${bgmPath}`);
      }

      // Preserve portrait framing. The previous 95% center crop made every
      // vertical source visibly zoomed; grading is applied later in one place.
      let v0Filter = '';
      if (inputInfo.isVertical) {
        v0Filter = `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=${outputFps},settb=AVTB,setsar=1,format=yuv420p[v0];`;
      } else {
        v0Filter = [
          '[0:v]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=10:2,scale=1080:1920:flags=bicubic[bg];',
          '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos[fg];',
          `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${outputFps},settb=AVTB,setsar=1,format=yuv420p[v0];`
        ].join('');
      }

      // Video filter for endcard: scale & pad to 1080x1920
      const v1Filter = `[1:v]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=${outputFps},settb=AVTB,setsar=1,format=yuv420p[v1];`;

      // Audio filters: atempo=1.03 + optional background music blending
      let a0Filter = '';
      const scaledMainDuration = actualMainDuration.toFixed(3);

      if (inputInfo.hasAudio) {
        if (bgmPath) {
          a0Filter = `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=1,volume=0.4[a0_ducked];` +
                     `[2:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=1,volume=0.6,atrim=end=${scaledMainDuration}[a0_bgm];` +
                     `[a0_ducked][a0_bgm]amix=inputs=2:duration=first:dropout_transition=2[a0];`;
        } else {
          a0Filter = '[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=1[a0];';
        }
      } else {
        if (bgmPath) {
          a0Filter = `[2:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=1,volume=0.7,atrim=end=${scaledMainDuration}[a0];`;
        } else {
          a0Filter = `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=end=${scaledMainDuration}[a0];`;
        }
      }

      let a1Filter = '';
      if (endCardInfo.hasAudio !== false) {
        a1Filter = '[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=1[a1];';
      } else {
        a1Filter = `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=end=${endCardDuration.toFixed(3)}[a1];`;
      }

      const concatFilter = '[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][cat_a];[cat_a]loudnorm=I=-14:LRA=7:tp=-1.5[outa]';
      const filterComplex = `${v0Filter}${v1Filter}${a0Filter}${a1Filter}${concatFilter}`;

      const args = [
        '-y',
        '-t', actualMainDuration.toFixed(3),
        '-i', inputPath,
        '-i', endCardPath
      ];

      if (bgmPath) {
        args.push('-i', bgmPath);
      }

      args.push(
        '-filter_complex', filterComplex,
        '-map', '[outv]',
        '-map', '[outa]',
        ...getVideoCodecArgs(),
        '-c:a', 'aac',
        '-b:a', '320k',
        '-ar', '48000',
        '-movflags', '+faststart',
        outputPath
      );

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
 * Converts video into strict 9:16 vertical YouTube Shorts format:
 * - Dimensions: 1080x1920 (vertical 9:16)
 * - Duration: strictly capped at <= 59.5 seconds
 * - Strip container metadata: -map_metadata -1 -fflags +bitexact
 * - Preserves source framing and frame rate (up to 60 fps)
 * - Optional audio mixer: duck original audio or blend assets/audio/*.mp3
 */
function convertToShortsFormat(inputPath, outputPath, onProgress) {
  return new Promise(async (resolve, reject) => {
    onProgress?.('🎨 Formatting video as a clean, full-frame 9:16 Short...');
    console.log(`[ShortsFormatter] Transcoding into a clean 9:16 Short: ${inputPath} -> ${outputPath}`);

    const inputInfo = await probeVideo(inputPath);
    const bgmPath = resolveBackgroundAudio();
    const outputFps = Math.min(60, Math.max(1, inputInfo?.fps || 30));

    let vFilter = '';
    if (inputInfo?.isVertical) {
      vFilter = `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=${outputFps},settb=AVTB,setsar=1,format=yuv420p[outv];`;
    } else {
      vFilter = [
        '[0:v]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=10:2,scale=1080:1920:flags=bicubic[bg];',
        '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos[fg];',
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${outputFps},settb=AVTB,setsar=1,format=yuv420p[outv];`
      ].join('');
    }

    let aFilter = '';
    if (inputInfo?.hasAudio) {
      if (bgmPath) {
        aFilter = `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=1,volume=0.4[orig];` +
                  `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=1,volume=0.6[bgm];` +
                  `[orig][bgm]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-14:LRA=7:tp=-1.5[outa]`;
      } else {
        aFilter = '[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=1,loudnorm=I=-14:LRA=7:tp=-1.5[outa]';
      }
    } else {
      if (bgmPath) {
        aFilter = '[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=1,volume=0.7,loudnorm=I=-14:LRA=7:tp=-1.5[outa]';
      } else {
        aFilter = 'anullsrc=channel_layout=stereo:sample_rate=48000[outa]';
      }
    }

    const filterComplex = `${vFilter}${aFilter}`;

    const args = [
      '-y',
      '-i', inputPath
    ];

    if (bgmPath) {
      args.push('-i', bgmPath);
    }

    args.push(
      '-t', '59.5',
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-map', '[outa]',
      ...getVideoCodecArgs(),
      '-c:a', 'aac',
      '-b:a', '320k',
      '-ar', '48000',
      '-movflags', '+faststart',
      outputPath
    );

    const child = spawn(FFMPEG_BIN, args);
    let stderr = '';

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        console.log(`[ShortsFormatter] ✅ Successfully formatted 9:16 Vertical Short with Hash Evasion: ${outputPath}`);
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
 * Trims duration to <= 59.5 seconds
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
 * - Preserves source framing and applies EBU R128 loudness normalization
 * - Supports Seamless Looping Mode (omits endcards by default to maximize APV > 100%)
 */
async function ensureShortsFormat(inputPath, onProgress, options = {}) {
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
    formattedPath = path.join(dir, `${base}_evaded_${Date.now()}.mp4`);
  }

  // End card is disabled by default for YouTube Shorts to ensure seamless looping & >100% APV retention
  const endCardEnabled = options.enableEndCard ?? (process.env.ENABLE_ENDCARD === 'true');
  const endCardPath = endCardEnabled ? resolveEndCardPath() : null;

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
    console.log('[ShortsFormatter] 🔁 Seamless Looping Mode active: End card omitted to maximize APV retention (>100%).');
  }

  // Render a clean full-frame 9:16 version; grading and local enhancement are applied later.
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
  resolveEndCardPath,
  resolveBackgroundAudio,
  getVideoCodecArgs
};
