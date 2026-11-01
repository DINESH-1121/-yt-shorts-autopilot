/**
 * lib/beatSyncTranscoder.js
 *
 * Automated Beat-Sync Transcoder & Phonk Audio Mixing Pipeline.
 * Orchestrates `scripts/beat_sync_editor.py` and passes extracted `songName`
 * down to metadata generation in `lib/aiClient.js`.
 */

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const aiClient = require('./aiClient');

const PROJECT_ROOT = path.join(__dirname, '..');
const SCRIPT_PATH = path.join(PROJECT_ROOT, 'scripts', 'beat_sync_editor.py');
const PHONK_DIR = path.join(PROJECT_ROOT, 'assets', 'phonk');
const AUDIO_DIR = path.join(PROJECT_ROOT, 'assets', 'audio');

/**
 * Resolves python executable: prefers .venv-mlx if installed, falls back to python3
 */
function resolvePythonBinary() {
  const venvPython = path.join(PROJECT_ROOT, '.venv-mlx', 'bin', 'python');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return 'python3';
}

/**
 * Extracts a clean song title from an audio file path or filename.
 * e.g., "assets/phonk/MONTAGEM ALQUIMIA.mp3" -> "MONTAGEM ALQUIMIA"
 */
function extractSongName(audioPath) {
  if (!audioPath) return 'MONTAGEM ALQUIMIA';
  const base = path.basename(audioPath, path.extname(audioPath));
  // Remove leading numbers/indexing, brackets, parentheses, and cleanup extra tags
  const clean = base
    .replace(/^\d+[\s.-]+/, '')
    .replace(/\[.*?\]|\(.*?\)/g, '')
    .replace(/(slowed|reverb|official|audio|edit|phonk|prod\..*?)$/gi, '')
    .replace(/[_\-]+/g, ' ')
    .trim();
  return clean ? clean.toUpperCase() : 'MONTAGEM ALQUIMIA';
}

/**
 * Resolves a trending Phonk/Jumpstyle audio track from assets/phonk/ (or assets/audio/).
 */
function resolvePhonkTrack(requestedTrack = null) {
  if (requestedTrack && fs.existsSync(requestedTrack)) {
    return path.resolve(requestedTrack);
  }

  const searchDirs = [PHONK_DIR, AUDIO_DIR];
  const validExts = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'];

  for (const sDir of searchDirs) {
    if (fs.existsSync(sDir)) {
      try {
        const files = fs.readdirSync(sDir).filter((f) => {
          const ext = path.extname(f).toLowerCase();
          return validExts.includes(ext) && !f.startsWith('.');
        });
        if (files.length > 0) {
          // Return the first match or pick randomly if multiple
          return path.join(sDir, files[0]);
        }
      } catch (err) {
        console.warn(`[BeatSyncTranscoder] Directory read warning for ${sDir}:`, err.message);
      }
    }
  }

  return null;
}

/**
 * Creates a beat-synced YouTube Short:
 * - Runs scripts/beat_sync_editor.py with audio ducking and sidechain mixing
 * - Returns { outputPath, duration, songName }
 *
 * @param {string} inputVideoPath
 * @param {object} [options]
 * @param {string} [options.audioPath]
 * @param {string} [options.outputPath]
 * @param {number} [options.bpm=130.0]
 * @param {number} [options.duration=59.0]
 * @param {number} [options.ducking=0.18]
 * @param {number} [options.phonkVolume=1.0]
 * @param {function} [onProgress]
 * @returns {Promise<{ outputPath: string, duration: number, songName: string, phonkTrack: string }>}
 */
function createBeatSyncedShort(inputVideoPath, options = {}, onProgress = null) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputVideoPath)) {
      return reject(new Error(`Input video file not found: ${inputVideoPath}`));
    }

    const phonkTrack = resolvePhonkTrack(options.audioPath);
    if (!phonkTrack) {
      return reject(
        new Error(
          `No Phonk audio track available in ${PHONK_DIR} or ${AUDIO_DIR}. Please add a track to assets/phonk/.`
        )
      );
    }

    const songName = extractSongName(phonkTrack);
    const pythonBin = resolvePythonBinary();

    const args = [
        SCRIPT_PATH,
        '--video', inputVideoPath,
        '--audio', phonkTrack,
        '--ducking', String(options.ducking || 0.18),
        '--phonk-volume', String(options.phonkVolume || 1.0),
        '--bpm', String(options.bpm || 130.0),
        '--duration', String(options.duration || 59.0),
        '--json'
    ];

    if (options.outputPath) {
      args.push('--output', options.outputPath);
    }

    onProgress?.(`🎵 Starting beat-sync editor with track: "${songName}" (Option A: 85-100% Phonk + 18% SFX Ducking)...`);
    console.log(`[BeatSyncTranscoder] Executing ${pythonBin} ${args.join(' ')}`);

    const child = spawn(pythonBin, args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          const res = JSON.parse(stdout.trim());
          if (res.success && res.outputPath && fs.existsSync(res.outputPath)) {
            console.log(`[BeatSyncTranscoder] ✅ Beat-sync transcode completed: ${res.outputPath}`);
            return resolve({
              outputPath: res.outputPath,
              duration: res.duration || options.duration || 59.0,
              songName: res.songName || songName,
              phonkTrack: res.phonkTrack || phonkTrack
            });
          }
          return reject(new Error(`Beat sync script failed: ${res.error || 'Unknown error'}`));
        } catch (parseErr) {
          return reject(new Error(`Failed to parse beat sync response: ${stdout || stderr}`));
        }
      } else {
        return reject(new Error(`Beat-sync transcode exited with code ${code}: ${stderr || stdout}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start beat_sync_editor.py: ${err.message}`));
    });
  });
}

/**
 * High-level orchestration:
 * 1. Transcodes video into beat-synced Short with Option A audio ducking.
 * 2. Extracts songName from returned object.
 * 3. Passes songName down into lib/aiClient.js metadata generation function.
 *
 * @param {string} inputVideoPath
 * @param {object} [videoInfo]
 * @param {object} [options]
 * @param {function} [onProgress]
 * @returns {Promise<{ outputPath: string, duration: number, songName: string, metadata: object }>}
 */
async function createBeatSyncedShortWithMetadata(inputVideoPath, videoInfo = {}, options = {}, onProgress = null) {
  const transcodeResult = await createBeatSyncedShort(inputVideoPath, options, onProgress);
  onProgress?.(`🧠 Generating viral @Editclips-k2r metadata for track "${transcodeResult.songName}"...`);

  // Pass extracted songName object down to lib/aiClient.js
  const metadata = await aiClient.generateBeatSyncMetadata({
    ...videoInfo,
    songName: transcodeResult.songName
  }, options);

  return {
    ...transcodeResult,
    metadata
  };
}

module.exports = {
  createBeatSyncedShort,
  createBeatSyncedShortWithMetadata,
  extractSongName,
  resolvePhonkTrack
};
