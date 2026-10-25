const aiClient = require('./aiClient');
const fs = require('fs');
const path = require('path');

const TREND_CACHE_PATH = path.join(__dirname, '..', 'trend-queries.json');
// Trend queries are cached for 1 hour by default (override with TREND_CACHE_HOURS)
const TREND_CACHE_TTL_MS = Math.max(0, Number(process.env.TREND_CACHE_HOURS ?? 1)) * 60 * 60 * 1000;

/**
 * Returns cached trend queries while they are still fresh, otherwise null.
 * Invalidates cache if the configured topic fingerprint has changed.
 */
function readTrendCache(expectedFingerprint = null) {
  if (TREND_CACHE_TTL_MS === 0) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(TREND_CACHE_PATH, 'utf-8'));
    if (!Array.isArray(cached?.queries) || cached.queries.length === 0) return null;
    const age = Date.now() - new Date(cached.generatedAt).getTime();
    if (!Number.isFinite(age) || age > TREND_CACHE_TTL_MS) return null;
    if (expectedFingerprint && cached.topicsFingerprint && cached.topicsFingerprint !== expectedFingerprint) {
      return null;
    }
    return { queries: cached.queries, generatedAt: cached.generatedAt };
  } catch {
    return null;
  }
}

function writeTrendCache(queries, topicsFingerprint = '') {
  try {
    fs.writeFileSync(TREND_CACHE_PATH, JSON.stringify({
      generatedAt: new Date().toISOString(),
      topicsFingerprint,
      queries
    }, null, 2));
  } catch (err) {
    console.warn('[TrendEngine] Could not write trend cache:', err.message);
  }
}

function clearTrendCache() {
  try {
    if (fs.existsSync(TREND_CACHE_PATH)) {
      fs.unlinkSync(TREND_CACHE_PATH);
      console.log('[TrendEngine] 🗑️ Cleared trend queries cache.');
    }
  } catch (err) {
    console.warn('[TrendEngine] Could not clear trend cache:', err.message);
  }
}

// Preset high-velocity trending pools with heavy Worldwide Gaming focus + Tech Innovations
const TREND_POOLS = {
  gaming: [
    'worldwide trending gaming clips shorts',
    'most viral gaming moments in the world shorts',
    'GTA 6 worldwide viral trailer gameplay shorts',
    'GTA 6 vs GTA 5 graphics comparison shorts',
    'minecraft world record viral moments shorts',
    'fortnite worldwide viral clutch shorts',
    'valorant insane global esports clutch shorts',
    'black myth wukong epic boss fight viral shorts',
    'unreal engine 5 photorealistic graphics shorts',
    'elden ring most insane moments viral shorts',
    'best viral gaming clips worldwide shorts',
    'cyberpunk 2077 ultra realistic graphics shorts',
    'upcoming PS5 Pro next gen game releases shorts',
    'most anticipated upcoming games 2026 worldwide shorts'
  ],
  tech_innovations: [
    'futuristic tech gadgets and innovations shorts',
    'breakthrough AI technology demo viral shorts',
    'next gen robotic inventions shorts',
    'insane tech inventions you must see shorts',
    'next gen tech and AI hardware launches shorts'
  ],
  trending_now: [
    'worldwide trending viral gaming shorts',
    'viral gaming moments this week shorts',
    'breaking worldwide gaming news launch teasers shorts',
    'viral tech innovations reactions shorts'
  ]
};

/**
 * Generates dynamic high-hype search queries aligned with creator strategy and trending topics
 * @param {object} opts
 * @param {string} [opts.model] Preferred model ref ("provider/model"); the free-model chain handles fallback
 * @param {number} [opts.count]
 * @param {boolean} [opts.forceRefresh] Bypass the on-disk query cache
 * @param {string} [opts.nicheFocus] Strategy focus
 * @param {Array} [opts.sources] Configured creator sources
 */
async function getDynamicSearchQueries({ model = 'opencode/glm-5.3-flash-free', count = 5, forceRefresh = false, nicheFocus = 'smart_mix', sources = [] } = {}) {
  const sourceTopics = (sources || []).map(s => s.name || s.url).filter(Boolean);
  const topicsFingerprint = sourceTopics.slice().sort().join('|');

  if (!forceRefresh) {
    const cached = readTrendCache(topicsFingerprint);
    if (cached) {
      console.log(`[TrendEngine] ♻️ Using cached trend queries from ${cached.generatedAt}`);
      return cached.queries.slice(0, count);
    }
  }

  const preferredModel = aiClient.normalizeModelName(model);

  try {
    let focusInstructions = '';
    if (sourceTopics.length > 0) {
      focusInstructions = `The creator focuses strictly on these target topics/categories:
${sourceTopics.map(t => `- ${t}`).join('\n')}

MANDATORY RULES:
- Every generated query MUST be directly relevant to one of the creator's target topics listed above.
- Distribute the ${count} queries evenly across the creator's target topics so each topic gets viral discovery coverage.
- NEVER generate random unrelated topics (no magic tricks, animal fails, life hacks, or random gadget reviews unless in target list).
- For cinema/movies (e.g. Christopher Nolan, Dune, Marvel), generate queries for scene edits, trailers, or cinematic moments (e.g. "epic scenes shorts", "cinematic edit shorts").
- For anime, generate queries for epic fight edits or viral anime moments.
- For gaming, generate queries for high-stakes clutch plays or comparison shorts.`;
    } else {
      focusInstructions = `Content Focus Mode: ${nicheFocus}
- Include diverse queries spanning popular gaming, trending entertainment/anime, viral cinema, or innovative tech depending on the focus mode.`;
    }

    const prompt = `You are an elite YouTube Shorts viral trends strategist targeting high-CTR vertical clips.
Generate exactly ${count} diverse, high-CTR YouTube search queries to discover the freshest, most viral YouTube Shorts right now.

${focusInstructions}

Requirements:
- Each query must be 3-6 words, optimized for YouTube Shorts algorithm.
- Queries must target strictly short-form vertical clips under 60 seconds (append "#shorts" to each query).
- Return ONLY a valid JSON array of ${count} query strings. For example: ["<query_1>", "<query_2>", "<query_3>"]`;

    const { result: queries } = await aiClient.generateJSON(prompt, {
      model: preferredModel,
      task: 'metadata',
      expectArray: true
    });

    if (Array.isArray(queries) && queries.length > 0) {
      console.log(`[TrendEngine] 🧠 AI generated ${queries.length} dynamic queries matching target topics:`, queries);
      writeTrendCache(queries, topicsFingerprint);
      return queries.slice(0, count);
    }
  } catch (err) {
    console.warn('[TrendEngine] AI dynamic query error, using target-aligned fallback:', err.message);
  }

  // Fallback: If AI fails or returns empty, construct targeted queries directly from configured sources
  if (sourceTopics.length > 0) {
    const suffixes = ['viral edit shorts', 'epic moments shorts', 'best scenes shorts', 'trending clips shorts', '4k edit shorts'];
    const targeted = [];
    const shuffledTopics = [...sourceTopics].sort(() => 0.5 - Math.random());
    for (let i = 0; i < count; i++) {
      const topic = shuffledTopics[i % shuffledTopics.length];
      const suffix = suffixes[i % suffixes.length];
      targeted.push(`${topic} ${suffix}`);
    }
    console.log(`[TrendEngine] 🎯 Generated ${targeted.length} target-aligned fallback queries:`, targeted);
    writeTrendCache(targeted, topicsFingerprint);
    return targeted;
  }

  // General fallback weighted selection: 70% Gaming, 30% Tech Innovations
  const gamingItems = [...TREND_POOLS.gaming].sort(() => 0.5 - Math.random());
  const techItems = [...TREND_POOLS.tech_innovations].sort(() => 0.5 - Math.random());

  const numTech = Math.max(1, Math.round(count * 0.3));
  const numGaming = count - numTech;

  const selected = [
    ...gamingItems.slice(0, numGaming),
    ...techItems.slice(0, numTech)
  ].sort(() => 0.5 - Math.random());

  console.log(`[TrendEngine] 🎮 Curated ${selected.length} Gaming & Tech queries:`, selected);
  return selected;
}

module.exports = {
  getDynamicSearchQueries,
  clearTrendCache,
  TREND_POOLS,
  readTrendCache,
  TREND_CACHE_PATH
};
