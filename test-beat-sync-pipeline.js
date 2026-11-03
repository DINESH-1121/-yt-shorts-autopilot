// test-beat-sync-pipeline.js — Verification test suite for Beat Sync Option A & Title Integration
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const {
  createBeatSyncedShort,
  createBeatSyncedShortWithMetadata,
  extractSongName,
  resolvePhonkTrack
} = require('./lib/beatSyncTranscoder');
const {
  buildBeatSyncTitle,
  buildBeatSyncDescription,
  generateBeatSyncMetadata
} = require('./lib/aiClient');

async function runTestSuite() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   BEAT SYNC & TITLE SONG-INTEGRATION TEST SUITE           ');
  console.log('═══════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, detail = '') {
    if (condition) {
      console.log(`✅ PASS: ${testName} ${detail ? `(${detail})` : ''}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // ── TEST 1: Song Name Extraction ──────────────────────────────────────────
  console.log('── Test 1: Song Name Extraction ──');
  const song1 = extractSongName('assets/phonk/MONTAGEM ALQUIMIA.mp3');
  assert(song1 === 'MONTAGEM ALQUIMIA', 'Extract clean song name', song1);

  const song2 = extractSongName('assets/phonk/01 - Brazilian Dança Phonk (Slowed).mp3');
  assert(song2.includes('BRAZILIAN DAN') || song2.includes('BRAZILIAN'), 'Clean indexed & slowed tags from filename', song2);

  const resolvedTrack = resolvePhonkTrack();
  assert(!!resolvedTrack && fs.existsSync(resolvedTrack), 'Resolve trending Phonk track from assets/phonk/', resolvedTrack);

  // ── TEST 2: Title Formula & 95-Char Bound ─────────────────────────────────
  console.log('\n── Test 2: Title Formula & 95-Character Enforcement ──');
  const title1 = buildBeatSyncTitle({
    hook: 'Peak Aura Moment',
    franchise: 'Jujutsu Kaisen',
    songName: 'MONTAGEM ALQUIMIA',
    nicheTag: '#anime'
  });
  console.log('   Generated title:', title1);
  assert(title1.includes('Peak Aura Moment 🔥💀 | Jujutsu Kaisen | Song - MONTAGEM ALQUIMIA | #anime #edit #shorts'), 'Title matches @Editclips-k2r formula');
  assert(title1.length <= 95, 'Title strictly <= 95 characters', `length: ${title1.length}`);
  assert(title1.includes('Song - MONTAGEM ALQUIMIA'), 'Song name injected into title');

  // Test 2b: Long title auto-clamping
  const titleLong = buildBeatSyncTitle({
    hook: 'This Is An Exceptionally Long Hook Sentence That Will Greatly Exceed Standard Character Allocations',
    franchise: 'Fullmetal Alchemist Brotherhood',
    songName: 'SUPER ULTRA BRAZILIAN DRIFT PHONK REMIX',
    nicheTag: '#anime'
  });
  console.log('   Clamped title:', titleLong);
  assert(titleLong.length <= 95, 'Overly long title strictly clamped to <= 95 characters', `length: ${titleLong.length}`);
  assert(titleLong.includes('Song - SUPER ULTRA BRAZILIAN DRIFT PHONK REMIX'), 'Preserves Song identifier even when clamped');
  assert(titleLong.endsWith('#edit #shorts'), 'Ends with #edit #shorts');

  // ── TEST 3: Description Formula (Strictly Max 4 Hashtags, Zero Spam) ─────
  console.log('\n── Test 3: Description Formula & Max 4 Hashtags ──');
  const desc = buildBeatSyncDescription({
    questionHook: 'Who had the peak demonic aura in this scene?',
    franchise: 'Jujutsu Kaisen',
    character: 'Sukuna',
    songName: 'MONTAGEM ALQUIMIA',
    nicheTag: '#anime'
  });
  console.log('   Generated description:\n' + desc.split('\n').map(l => '   | ' + l).join('\n'));

  assert(desc.includes('Who had the peak demonic aura in this scene?'), 'Description includes questionHook');
  assert(desc.includes('Series: Jujutsu Kaisen'), 'Description includes Series');
  assert(desc.includes('Character: Sukuna'), 'Description includes Character');
  assert(desc.includes('Song: MONTAGEM ALQUIMIA'), 'Description includes Song name');

  // Check hashtags
  const hashtags = desc.split('\n\n').pop().trim().split(/\s+/);
  assert(hashtags.length === 4, 'Description strictly contains exactly 4 hashtags', `found ${hashtags.length}: ${hashtags.join(', ')}`);
  assert(hashtags[0] === '#anime', 'Niche tag present');
  assert(hashtags[1] === '#jujutsukaisen', 'Franchise tag formatted without special characters');
  assert(hashtags[2] === '#edit', '#edit present');
  assert(hashtags[3] === '#shorts', '#shorts present');

  // Verify zero spam tags and zero CTA
  assert(!/fyp|reels|foryoupage|foryou|viral|explore/i.test(desc), 'Zero cross-platform spam tags');
  assert(!/drop a like|subscribe|leave a comment/i.test(desc), 'Zero hardcoded CTA paragraphs');

  // ── TEST 4: Beat-Sync Video Transcoder Execution (Option A Mixing) ────────
  console.log('\n── Test 4: Beat Sync Editor & Audio Mixing Execution ──');
  const tempDir = '/tmp/beatsync_tests';
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const testInputVideo = path.join(tempDir, 'test_source.mp4');
  const testOutputVideo = path.join(tempDir, 'test_output_beatsync.mp4');

  // Generate test 3-second source video with audio tone
  execSync(`ffmpeg -y -f lavfi -i testsrc=size=1280x720:rate=30 -f lavfi -i sine=frequency=500:sample_rate=48000 -t 3 -c:v libx264 -c:a aac -b:a 192k "${testInputVideo}" 2>/dev/null`);

  const transcodeResult = await createBeatSyncedShort(testInputVideo, {
    outputPath: testOutputVideo,
    duration: 3.0,
    bpm: 130.0,
    ducking: 0.18,
    phonkVolume: 1.0
  });

  assert(fs.existsSync(transcodeResult.outputPath), 'Beat-synced video created', transcodeResult.outputPath);
  assert(transcodeResult.duration > 0, 'Valid video duration', `${transcodeResult.duration.toFixed(2)}s`);
  assert(transcodeResult.songName === 'MONTAGEM ALQUIMIA', 'Returned exact songName', transcodeResult.songName);

  // Probe output video streams
  const probeRaw = execSync(`ffprobe -v error -show_entries stream=codec_type,width,height,duration -of json "${transcodeResult.outputPath}"`).toString();
  const probeData = JSON.parse(probeRaw);
  const vStream = probeData.streams.find(s => s.codec_type === 'video');
  const aStream = probeData.streams.find(s => s.codec_type === 'audio');

  // The beat-sync pass is audio-first and deliberately preserves framing.
  // The following Shorts formatter owns the 9:16 conversion so we never crop
  // a landscape source before its blurred-background layout is applied.
  assert(vStream && vStream.width === 1280 && vStream.height === 720, 'Beat-sync preserves source framing for the Shorts formatter', `${vStream.width}x${vStream.height}`);
  assert(aStream !== undefined, 'Output contains mixed audio stream');

  // ── TEST 5: Orchestration with Metadata Generation ────────────────────────
  console.log('\n── Test 5: End-to-End Orchestration with Metadata ──');
  // Pass timeoutMs: 2000 so test completes quickly even if local LLM daemon is offline
  const endToEndResult = await createBeatSyncedShortWithMetadata(testInputVideo, {
    title: 'Sukuna vs Mahoraga Domain Clash',
    franchise: 'Jujutsu Kaisen',
    character: 'Ryomen Sukuna'
  }, {
    duration: 3.0,
    bpm: 130.0,
    timeoutMs: 2000
  });

  assert(!!endToEndResult.songName, 'Returned songName', endToEndResult.songName);
  assert(!!endToEndResult.metadata, 'Generated metadata object');
  assert(endToEndResult.metadata.title.includes(`Song - ${endToEndResult.songName}`), 'Metadata title contains Song identifier');
  assert(endToEndResult.metadata.title.length <= 95, 'Metadata title <= 95 chars', `length: ${endToEndResult.metadata.title.length}`);
  assert(endToEndResult.metadata.description.includes(`Song: ${endToEndResult.songName}`), 'Metadata description includes Song');
  assert(endToEndResult.metadata.hashtags.length === 4, 'Metadata has exactly 4 hashtags');

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
