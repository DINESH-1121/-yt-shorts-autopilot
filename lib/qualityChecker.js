/**
 * qualityChecker.js — Pre-upload video quality & compliance validator using OpenCode models.
 *
 * Enforces two strict quality criteria before ANY video is uploaded to YouTube:
 * 1. AI Generated Slop: If the entire video is AI-generated slop (e.g., completely synthetic
 *    AI video generation like Sora/Runway/Kling/Pika, morphing uncanny AI loops, talking AI avatars,
 *    or low-effort AI brainrot/slideshows), REJECT. Authentic gaming gameplay, real cinematic
 *    movie edits, anime clips, and tech hardware demos are NOT slop.
 * 2. On-Screen Channel Promo: If the VIDEO FRAMES have visible on-screen text or burnt-in
 *    watermarks promoting another YouTube channel (e.g. "@channel", "subscribe to XYZ", "YT: @..."),
 *    REJECT. Titles and descriptions are EXEMPT (actor/celebrity names like Timothée Chalamet
 *    in movie clips/edits are 100% ALLOWED).
 *
 * Validated with OpenCode models via aiClient.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const aiClient = require('./aiClient');
const { probeVideo } = require('./shortsFormatter');

// Resolve ffmpeg binary path
const FFMPEG_BIN = process.env.FFMPEG_PATH || (
  fs.existsSync('/opt/homebrew/bin/ffmpeg')
    ? '/opt/homebrew/bin/ffmpeg'
    : (fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg')
);

/**
 * Calculates strategic timestamps to catch on-screen names, channel promos, and watermarks
 * that appear at specific moments (opening, 2s mark, 3.5s mark, middle, and outro).
 */
function getStrategicSampleTimestamps(duration) {
  if (duration <= 3) {
    return [Math.max(0.2, duration * 0.2), Math.min(duration - 0.2, duration * 0.8)];
  }

  const rawTimes = [
    0.5,                          // First frame / immediate opening
    2.0,                          // 2-second mark (catches delayed intro watermarks & names)
    3.5,                          // 3.5-second mark (catches post-hook lower-thirds & promos)
    duration * 0.25,              // Quarter mark (early body)
    duration * 0.50,              // Middle of the video
    duration * 0.75,              // Three-quarter mark (late body)
    Math.max(0.5, duration - 2.5),// Pre-outro (2-3 seconds before end)
    Math.max(0.5, duration - 0.8) // Final frame / closing end-slate
  ];

  const uniqueTimes = [];
  for (const t of rawTimes) {
    const clamped = Math.max(0.3, Math.min(duration - 0.3, Number(t.toFixed(2))));
    if (!uniqueTimes.some(existing => Math.abs(existing - clamped) < 0.75)) {
      uniqueTimes.push(clamped);
    }
  }

  return uniqueTimes.sort((a, b) => a - b);
}

/**
 * Extracts representative sample frames across the video as temporary JPEG images.
 * Strategically samples opening (0.5s), early intro (2.0s, 3.5s), mid-video, and outro frames.
 */
async function extractSampleFrames(videoPath) {
  if (!fs.existsSync(videoPath)) return [];

  const info = await probeVideo(videoPath);
  const duration = info?.duration || 10;
  const tempPrefix = path.join(os.tmpdir(), `qc_${process.pid}_${Date.now()}_`);
  const times = getStrategicSampleTimestamps(duration);

  // Extract sample frames in parallel for immediate validation (scaled to 480p for battery & speed efficiency)
  const framePromises = times.map((t, i) => {
    const framePath = `${tempPrefix}frame_${i}.jpg`;
    return new Promise((resolve) => {
      execFile(FFMPEG_BIN, [
        '-y',
        '-ss', String(t),
        '-i', videoPath,
        '-vf', 'scale=-2:480',
        '-frames:v', '1',
        '-q:v', '3',
        framePath
      ], { timeout: 6000 }, (err) => {
        if (!err && fs.existsSync(framePath)) {
          resolve(framePath);
        } else {
          resolve(null);
        }
      });
    });
  });

  const frames = (await Promise.all(framePromises)).filter(Boolean);
  return frames;
}

/**
 * Extracts any embedded subtitle stream from the video file
 */
function extractSubtitles(videoPath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(videoPath)) return resolve('');
    const srtPath = path.join(os.tmpdir(), `qc_subs_${process.pid}_${Date.now()}.srt`);
    execFile(FFMPEG_BIN, [
      '-y',
      '-i', videoPath,
      '-map', '0:s:0',
      srtPath
    ], { timeout: 2000 }, (err) => {
      if (err || !fs.existsSync(srtPath)) {
        return resolve('');
      }
      try {
        const text = fs.readFileSync(srtPath, 'utf8').trim();
        try { fs.unlinkSync(srtPath); } catch {}
        resolve(text);
      } catch {
        resolve('');
      }
    });
  });
}

/**
 * Local heuristic validator used as a safety fallback if all OpenCode models are unreachable
 */
function heuristicQualityCheck({ title = '', description = '', uploader = '' }) {
  const combined = `${title} ${description} ${uploader}`.toLowerCase();

  // Obvious AI slop, food morphs, cooking ASMR, and commercial signals in metadata
  const slopPatterns = [
    /\b(sora ai|midjourney video|runway gen|pika labs|kling ai|haiper ai|luma dream machine|viggle ai|ai brainrot|synthetic video|completely generated by ai|talking avatar|ai generated video)\b/i,
    /#(sora|runway|pika|kling|haiper|lumaai|aigenerated|generativeai)\b/i,
    /\b(food morph|food morphing|miniature cooking|cooking asmr|snack commercial|satisfying food|slime asmr|soap cutting|kinetic sand)\b/i
  ];
  const isSlop = slopPatterns.some(p => p.test(combined));

  if (isSlop) {
    return {
      decision: 'REJECT',
      isAiSlop: true,
      hasChannelPromo: false,
      hasPersonName: false,
      detectedNames: [],
      reason: 'Rejected by heuristic safety check: Video metadata indicates 100% synthetic AI-generated content (AI slop).'
    };
  }

  return {
    decision: 'PASS',
    isAiSlop: false,
    hasChannelPromo: false,
    hasPersonName: false,
    detectedNames: [],
    reason: 'Passed heuristic safety check (No AI slop signals found in metadata).'
  };
}

/**
 * Main quality check executor:
 * Validates a video using OpenCode models with attached video frames.
 *
 * @param {object} params
 * @param {string} params.videoPath       Local path to the formatted/downloaded MP4 video
 * @param {object} params.metadata        Video metadata { title, description, uploader, tags, ... }
 * @param {string} [params.model]         Preferred OpenCode model ref
 * @param {function} [params.onProgress]  Progress notification callback
 * @returns {Promise<{ decision: 'PASS'|'REJECT', isAiSlop: boolean, hasChannelPromo: boolean, hasPersonName: boolean, detectedNames: string[], reason: string, usedModel: string }>}
 */
async function checkVideoQuality({ videoPath, metadata = {}, model, onProgress }) {
  onProgress?.('🔍 Quality Checker: Extracting sample frames from video for visual analysis...');
  console.log(`[QualityChecker] Starting validation on video: "${metadata.title || videoPath}"`);

  let sampleFrames = [];
  let subtitles = '';

  try {
    const [frames, subs] = await Promise.all([
      extractSampleFrames(videoPath),
      extractSubtitles(videoPath)
    ]);
    sampleFrames = frames;
    subtitles = subs;
  } catch (err) {
    console.warn('[QualityChecker] Error gathering visual frames/subtitles:', err.message);
  }

  const prompt = `You are an elite video quality, safety, and compliance validator for a high-standard YouTube Shorts channel.
Your job is to evaluate this video and decide whether it is ALLOWED to be uploaded or must be REJECTED.

You are evaluating:
1. Visual Keyframes: ${sampleFrames.length} representative frame(s) extracted strategically across the entire video timeline:
   - Opening: First frame (~0.5s)
   - Early Intro (2.0s - 3.5s): Check ONLY for third-party channel name watermarks or @handles.
   - Middle Body: Frames sampled across the 25%, 50%, and 75% marks of the video.
   - Closing Outro: Pre-outro and final closing frames (check for end-slate promos like "Subscribe to @Channel").
2. Video Title: ${metadata.title || 'N/A'} (Completely EXEMPT from name checks — movie/actor names like Doctor Doom or Timothée Chalamet are 100% ALLOWED).

============================================================
CRITICAL DISTINCTION: ON-SCREEN CAPTIONS & TRANSCRIPTIONS ARE 100% ALLOWED!
============================================================
- DO NOT REJECT FOR NORMAL ON-SCREEN TEXT OR TRANSCRIPTIONS:
  * Speech-to-text captions, animated subtitles, spoken dialogue, and lyrics (e.g., "Wait until the end", "I cannot believe this", "He really thought", lyrics of songs, dialogue translations) are 100% ALLOWED and DESIRED.
  * In-game text, UI, HUD elements, game character names, mission objectives, kill feeds, or scoreboards are 100% ALLOWED.
  * Movie/anime quotes, character names, and dialogue captions are 100% ALLOWED.

- YOU MUST ONLY REJECT FOR THIRD-PARTY CHANNEL PROMOTIONAL BRANDING:
  * Burnt-in channel watermarks promoting another YouTube/TikTok channel (e.g. "@ChannelName", "YT: @...", "youtube.com/@...", "TikTok: @...").
  * Explicit calls-to-action promoting a competitor channel (e.g., "Subscribe to @XYZ", "Follow @ABC for more", "Join my channel @...").
  * Large, intrusive creator watermark logos plastered across the video to mark ownership by another channel.

============================================================
CRITICAL VALIDATION RULES:
============================================================

RULE 1: REJECT IF THE ENTIRE VIDEO IS AI GENERATED SLOP, FOOD MORPH, OR NON-EDIT CONTENT
- What IS AI generated slop or non-edit content (MUST REJECT):
  * AI food morphs, miniature cooking ASMR, snack commercials, and non-edit clips.
  * 100% synthetic AI-generated video loops or hallucinations (e.g., Sora, Runway Gen-2/3, Kling, Pika, Haiper, Luma, morphing uncanny AI objects/scenes).
  * Synthetic AI-generated slideshows with robotic AI voiceover reading fake facts, Reddit stories, or generic AI motivational scripts.
  * AI-generated deepfake avatars talking to the camera, or weird surreal AI brainrot/memes (e.g., dancing AI animals/babies, fake AI creature transformations).
  * Low-effort, mass-generated synthetic spam devoid of genuine human artistry, real gameplay, or authentic video.
- What is authentic content (MUST PASS):
  * Authentic Anime edits, AMVs, cinematic movie edits (e.g. Solo Leveling, Attack on Titan, Jujutsu Kaisen, Demon Slayer, Marvel clips). Real anime scenes and human fan edits of anime/cinema are authentic content, NOT AI slop!
  * Real video game captures/gameplay (e.g. GTA 5/6, Minecraft, Fortnite, Valorant, Call of Duty, Unreal Engine 5 tech demos, Elden Ring, Black Myth: Wukong, etc.). High-end 3D CGI in video games is authentic gaming capture, NOT AI slop.
  * Authentic tech reviews, real gadget hardware demos, actual robotics, physical product reveals.
- IF THE ENTIRE VIDEO IS AI-GENERATED SLOP, AI FOOD MORPH, MINIATURE COOKING ASMR, SNACK COMMERCIAL, OR NON-EDIT CLIP -> MUST REJECT! Set "isAiSlop": true.

RULE 2: REJECT ONLY FOR VISIBLE THIRD-PARTY CHANNEL NAMES OR PROMOTIONAL HANDLES
- Inspect the attached VIDEO FRAMES ONLY for burnt-in watermarks, text, or outro screens that promote a third-party channel (e.g., "@ChannelName", "Subscribe to @...", "YT: @...").
- Remember: Subtitles, transcriptions, spoken dialogue captions, in-game text, character names, and movie titles MUST NEVER be treated as channel names!
- If a third-party channel name or handle is prominently displayed on-screen -> REJECT! Set "hasChannelPromo": true and describe it in "detectedPromo".

============================================================
DECISION LOGIC:
============================================================
- If isAiSlop is true OR hasChannelPromo is true:
  "decision": "REJECT"
  "reason": Detailed explanation of why it was rejected.
- If BOTH rules pass (not AI slop AND no on-screen third-party channel promotion):
  "decision": "PASS"
  "reason": Explanation of why the video passed quality check.

Respond ONLY with valid JSON in this exact structure:
{
  "decision": "PASS",
  "isAiSlop": false,
  "hasChannelPromo": false,
  "detectedPromo": "",
  "reason": "Explanation of validation findings"
}`;

  onProgress?.('🧠 Quality Checker: Validating with AI (checking for AI slop & on-screen channel promos)...');

  try {
    const { result, usedModel } = await aiClient.generateJSON(prompt, {
      model: model || 'opencode/nemotron-3.5-super-vl-free',
      task: 'quality_check',
      files: sampleFrames,
      timeoutMs: 15000
    });

    const isAiSlop = Boolean(result.isAiSlop);
    const hasChannelPromo = Boolean(result.hasChannelPromo || result.detectedPromo);
    const shouldReject = isAiSlop || hasChannelPromo || String(result.decision).toUpperCase() === 'REJECT';

    const decision = shouldReject ? 'REJECT' : 'PASS';
    const reason = result.reason || (
      shouldReject
        ? `Video rejected: ${isAiSlop ? 'AI-generated slop detected. ' : ''}${hasChannelPromo ? `On-screen channel promotion detected: ${result.detectedPromo}. ` : ''}`
        : 'Quality check passed: Video contains authentic content with no AI slop and no on-screen channel promotions.'
    );

    console.log(`[QualityChecker] ${decision === 'PASS' ? '✅' : '🛑'} Validated by ${usedModel}: ${decision} — ${reason}`);

    return {
      decision,
      isAiSlop,
      hasChannelPromo,
      hasPersonName: hasChannelPromo, // backwards compatibility
      detectedNames: result.detectedPromo ? [result.detectedPromo] : [],
      reason,
      usedModel
    };
  } catch (err) {
    console.warn('[QualityChecker] AI validation failed, falling back to heuristic validator:', err.message);
    const heuristic = heuristicQualityCheck({
      title: `${metadata.title || ''} ${metadata.originalTitle || ''}`,
      description: `${metadata.description || ''} ${metadata.originalDescription || ''}`,
      uploader: metadata.uploader || ''
    });
    return {
      ...heuristic,
      usedModel: `heuristic-fallback (${err.message.slice(0, 80)})`
    };
  } finally {
    // Clean up temporary extracted frames
    for (const framePath of sampleFrames) {
      if (fs.existsSync(framePath)) {
        try { fs.unlinkSync(framePath); } catch {}
      }
    }
  }
}

module.exports = {
  checkVideoQuality,
  extractSampleFrames,
  extractSubtitles,
  heuristicQualityCheck
};
