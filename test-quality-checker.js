// test-quality-checker.js — Comprehensive verification of AI Quality Checker
const { checkVideoQuality, heuristicQualityCheck, extractSampleFrames } = require('./lib/qualityChecker');
const fs = require('fs');
const { execSync } = require('child_process');

async function runTests() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   AI QUALITY CHECKER TEST SUITE (OpenCode)        ');
  console.log('═══════════════════════════════════════════════════\n');

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

  // 1. Create a dummy test video
  const testVideoPath = '/tmp/qc_suite_test.mp4';
  try {
    execSync(`ffmpeg -y -f lavfi -i color=c=black:s=320x240:d=1 -c:v libx264 ${testVideoPath} 2>/dev/null`);
  } catch (err) {
    console.error('Could not create test video:', err.message);
  }

  // Test 1: Frame extraction
  console.log('── Test 1: Frame Extraction ──');
  const frames = await extractSampleFrames(testVideoPath, 2);
  assert(frames.length > 0, 'Extracts sample frames from video', `Extracted ${frames.length} frames`);
  frames.forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });

  // Test 2: Heuristic AI Slop Detection
  console.log('\n── Test 2: Heuristic AI Slop Detection ──');
  const hSlop = heuristicQualityCheck({
    title: 'Crazy Sora AI Generated Synthetic Loop #shorts #sora',
    uploader: 'AIVids'
  });
  assert(hSlop.decision === 'REJECT', 'Heuristic rejects AI slop');
  assert(hSlop.isAiSlop === true, 'Heuristic identifies isAiSlop = true');

  // Test 3: Heuristic Person Name Exemption (Allowed in Titles/Descriptions)
  console.log('\n── Test 3: Person/Celebrity Name Exemption in Titles ──');
  const hPerson = heuristicQualityCheck({
    title: 'Timothée Chalamet best acting scenes edit #shorts',
    uploader: 'CinemaEdits'
  });
  assert(hPerson.decision === 'PASS', 'Heuristic allows celebrity/actor names in movie edits');
  assert(hPerson.isAiSlop === false, 'isAiSlop is false');

  // Test 4: OpenCode Live AI Quality Check on Clean Gaming Clip
  console.log('\n── Test 4: OpenCode Check on Clean Gaming Clip ──');
  const liveClean = await checkVideoQuality({
    videoPath: testVideoPath,
    metadata: {
      title: 'GTA 6 Photorealistic Graphics Showcase #Shorts #Gaming',
      uploader: 'RockstarGamesClips',
      description: 'Check out the physics and lighting engine in this Los Santos clip.'
    }
  });
  console.log(`  Decision: ${liveClean.decision} (by ${liveClean.usedModel})`);
  console.log(`  Reason: ${liveClean.reason}`);
  assert(liveClean.decision === 'PASS', 'OpenCode passes clean gaming content');
  assert(liveClean.isAiSlop === false, 'isAiSlop is false');

  // Test 5: OpenCode Live Check on Celebrity Edit Video (Allowed)
  console.log('\n── Test 5: OpenCode Check on Celebrity Edit Video (Allowed) ──');
  const livePerson = await checkVideoQuality({
    videoPath: testVideoPath,
    metadata: {
      title: 'Robert Downey Jr Iron Man Return Scene Edit #Shorts',
      uploader: 'MarvelEditsChannel',
      description: 'The moment Tony Stark says I am Iron Man.'
    }
  });
  console.log(`  Decision: ${livePerson.decision} (by ${livePerson.usedModel})`);
  console.log(`  Reason: ${livePerson.reason}`);
  assert(livePerson.decision === 'PASS', 'OpenCode passes celebrity movie edit');
  assert(livePerson.isAiSlop === false, 'isAiSlop is false');

  // Test 6: OpenCode Live Check on AI Slop
  console.log('\n── Test 6: OpenCode Check on AI Slop Video ──');
  const liveSlop = await checkVideoQuality({
    videoPath: testVideoPath,
    metadata: {
      title: 'Mind-Blowing Kling & Runway Gen-3 AI Video Loop #Shorts #AI',
      uploader: 'SyntheticCreatives',
      description: '100% generated with Kling AI, Midjourney and Runway! Fully synthetic animation morph.'
    }
  });
  console.log(`  Decision: ${liveSlop.decision} (by ${liveSlop.usedModel})`);
  console.log(`  Reason: ${liveSlop.reason}`);
  assert(liveSlop.decision === 'REJECT', 'OpenCode rejects video with AI generated slop');
  assert(liveSlop.isAiSlop === true, 'isAiSlop is true');

  // Cleanup
  try { if (fs.existsSync(testVideoPath)) fs.unlinkSync(testVideoPath); } catch {}

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
