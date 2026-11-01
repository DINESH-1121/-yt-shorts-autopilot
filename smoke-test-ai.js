// Smoke test for lib/aiClient.js — run with: node smoke-test-ai.js
require('dotenv').config();
const aiClient = require('./lib/aiClient');

(async () => {
  console.log('── Discovered free models ──');
  const models = await aiClient.listFreeModels('metadata');
  models.forEach(m => console.log(`  ${m.id} ${m.healthy ? '✓ healthy' : '✗ cooling down'}`));

  console.log('\n── Live JSON generation test ──');
  const t0 = Date.now();
  try {
    const { result, usedModel } = await aiClient.generateJSON(
      'You are a YouTube strategist. Given the video title "Insane GTA 6 physics moment", respond ONLY with JSON: {"optimizedTitle": "...", "tags": ["shorts"]}. Keep title under 70 chars with #Shorts #Gaming at the end.',
      { task: 'metadata', timeoutMs: 120000 }
    );
    console.log('✓ Success via', usedModel, `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log('  →', JSON.stringify(result));
  } catch (err) {
    console.error('✗ Failed:', err.message);
    process.exitCode = 1;
  }

  console.log('\n── Array-mode test (trend queries) ──');
  try {
    const { result, usedModel } = await aiClient.generateJSON(
      'Return ONLY a valid JSON array of exactly 3 short YouTube search query strings (3-6 words each) trending gaming shorts. No other text.',
      { task: 'metadata', expectArray: true, timeoutMs: 120000 }
    );
    console.log(`✓ Success via ${usedModel}:`, JSON.stringify(result));
  } catch (err) {
    console.error('✗ Failed:', err.message);
    process.exitCode = 1;
  }

  console.log('\n── extractJSON robustness ──');
  const cases = [
    ['```json\n{"a":1}\n```', {a:1}],
    ['Here is the result: {"b":[1,2]} done', {b:[1,2]}],
    ['["gta 6 shorts", "minecraft viral"]', ['gta 6 shorts', 'minecraft viral']],
  ];
  for (const [input, expected] of cases) {
    const got = aiClient.extractJSON(input);
    console.log(JSON.stringify(got) === JSON.stringify(expected) ? '  ✓' : '  ✗', input.slice(0, 40).replace(/\n/g, ' '), '→', JSON.stringify(got));
  }
})();
