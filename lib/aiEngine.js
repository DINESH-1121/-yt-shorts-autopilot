const aiClient = require('./aiClient');

/**
 * Validates a generated YouTube Short title against placeholders or empty responses.
 * Throws an error immediately if invalid so fallback strings are NEVER uploaded.
 */
function validateGeneratedTitle(title) {
  if (!title || typeof title !== 'string' || !title.trim()) {
    throw new Error('AI output validation failed: title is missing or empty');
  }
  const clean = title.trim();
  if (
    /^(catchy\s*short\s*title|catchy\s*title|short\s*title|title|untitled video|untitled short|untitled)/i.test(clean) ||
    clean.includes('Catchy Short Title') ||
    clean.includes('Catchy Title') ||
    clean.includes('[2-4 Word')
  ) {
    throw new Error(`AI output validation failed: placeholder title detected ("${clean}")`);
  }
  return clean;
}

/**
 * Genre Guard: Detects if content matches the channel's locked niche (Anime Edits).
 * If the candidate cannot be confidently classified into the locked niche
 * (e.g., food, UFC, random gaming, animal compilations), returns null so it is
 * immediately REJECTED instead of falling back to gaming.
 */
function detectContentCategory(title = '', sourceName = '', description = '') {
  const text = `${title} ${sourceName} ${description}`.toLowerCase();

  // Rejection triggers for non-niche / spam topics
  if (/\b(ufc|mma|boxing|football|soccer|nba|nfl|cooking|recipe|asmr|mukbang|food|burger|pizza|cat|dog|pet|puppy|animal compilation)\b/i.test(text)) {
    return null;
  }

  // 1. Anime & Manga Edits (Locked Channel Niche)
  if (/anime|manga|naruto|one piece|jujutsu|jjk|dragon ball|dbz|demon slayer|kimetsu|zenitsu|sukuna|gojo|luffy|goku|bleach|otaku|weeb|animedit|amv|shonen|attack on titan|eren|levi|solo leveling|sung jinwoo|death note|chainsaw man/i.test(text)) {
    return 'anime';
  }

  // 2. Cinema / Marvel Superhero Edits
  if (/marvel|mcu|avengers|spiderman|iron man|thor|captain america|doomsday|cinematic edit|movie edit/i.test(text)) {
    return 'cinema';
  }

  // Do NOT fall back to gaming! Reject non-matching candidates.
  return null;
}

/**
 * Detects specific franchise hashtag for anime/cinema edit packaging
 */
function detectFranchiseTag(title = '', categoryHint = '', description = '') {
  const text = `${title} ${categoryHint} ${description}`.toLowerCase();
  if (/solo leveling|sung jinwoo/i.test(text)) return '#sololeveling';
  if (/attack on titan|aot|eren|levi/i.test(text)) return '#attackontitan';
  if (/jujutsu|jjk|gojo|sukuna/i.test(text)) return '#jujutsukaisen';
  if (/demon slayer|kimetsu|tanjiro|nezuko/i.test(text)) return '#demonslayer';
  if (/death note|light yagami|ryuk/i.test(text)) return '#deathnote';
  if (/naruto|sasuke|kakashi/i.test(text)) return '#naruto';
  if (/one piece|luffy|zoro/i.test(text)) return '#onepiece';
  if (/bleach|ichigo/i.test(text)) return '#bleach';
  if (/dragon ball|dbz|goku|vegeta/i.test(text)) return '#dragonball';
  if (/chainsaw man|denji/i.test(text)) return '#chainsawman';
  if (/marvel|avengers|mcu/i.test(text)) return '#marvel';
  return '#animedit';
}

/**
 * Builds strictly 3 to 4 relevant hashtags:
 * #[PrimaryCategory] #[SpecificFranchise] #edit #shorts
 * Completely strips cross-platform tags (#fyp, #foryou, #viral, #trending, etc.)
 */
function buildRichHashtags(title = '', categoryHint = '', existingTags = []) {
  const category = detectContentCategory(title, categoryHint);
  if (!category) {
    return [];
  }

  const primaryTag = category === 'anime' ? '#anime' : '#cinema';
  const franchiseTag = detectFranchiseTag(title, categoryHint);

  const cleanCandidates = [primaryTag, franchiseTag, '#edit', '#shorts'];

  // Add any explicitly relevant existing tags that are not cross-platform spam
  if (Array.isArray(existingTags)) {
    for (const tag of existingTags) {
      const clean = (tag.startsWith('#') ? tag : `#${tag}`).toLowerCase();
      if (/fyp|foryou|foryoupage|reels|filmtok|explore|viral|trending/i.test(clean)) continue;
      if (!cleanCandidates.some(c => c.toLowerCase() === clean) && /^#[a-z0-9_]+$/i.test(clean)) {
        cleanCandidates.push(clean);
      }
    }
  }

  const seen = new Set();
  const finalTags = [];
  for (const t of cleanCandidates) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      finalTags.push(t);
    }
    if (finalTags.length >= 4) break;
  }

  // Enforce minimum 3, max 4 hashtags
  if (finalTags.length < 3) {
    if (!seen.has('#edit')) finalTags.push('#edit');
    if (!seen.has('#shorts')) finalTags.push('#shorts');
  }

  return finalTags.slice(0, 4);
}

/**
 * Formats the final YouTube description cleanly according to the @Editclips-k2r formula:
 * {questionHook}
 *
 * Series: {franchise}
 * Character: {character}
 * Song: {songName}
 *
 * {hashtags.join(' ')}
 */
function formatRichDescription({
  questionHook = '',
  franchise = '',
  character = '',
  hashtags = [],
  title = '',
  categoryHint = '',
  aiDescription = '',
  songName = ''
}) {
  let hook = (questionHook || '').trim();
  let series = (franchise || '').trim();
  let char = (character || '').trim();
  let song = (songName || '').trim();

  // If parsed fields are missing, attempt extraction from aiDescription
  if (!hook && aiDescription) {
    const lines = aiDescription.split('\n').map(l => l.trim()).filter(Boolean);
    const nonTagLines = lines.filter(l => !l.startsWith('#') && !l.toLowerCase().startsWith('series:') && !l.toLowerCase().startsWith('character:') && !l.toLowerCase().startsWith('song:'));
    if (nonTagLines.length > 0) {
      hook = nonTagLines[0];
    }
    for (const l of lines) {
      if (/^series:\s*(.+)$/i.test(l)) series = l.replace(/^series:\s*/i, '').trim();
      if (/^character:\s*(.+)$/i.test(l)) char = l.replace(/^character:\s*/i, '').trim();
      if (/^song:\s*(.+)$/i.test(l)) song = l.replace(/^song:\s*/i, '').trim();
    }
  }

  if (!hook) {
    hook = 'Who had the colder aura in this scene?';
  }
  if (!series) {
    series = detectFranchiseTag(title, categoryHint).replace('#', '').toUpperCase();
  }
  if (!char) {
    char = 'Main Character';
  }

  let finalTags = Array.isArray(hashtags) && hashtags.length > 0
    ? hashtags.filter(t => !/fyp|foryou|foryoupage|reels|filmtok|explore|viral|trending/i.test(t)).slice(0, 4)
    : buildRichHashtags(title, categoryHint);

  if (finalTags.length === 0) {
    const franchiseTag = `#${series.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    finalTags = ['#anime', franchiseTag || '#animedit', '#edit', '#shorts'];
  }

  const songLine = song ? `\nSong: ${song}` : '';
  return `${hook}\n\nSeries: ${series}\nCharacter: ${char}${songLine}\n\n${finalTags.join(' ')}`.trim();
}

/**
 * Standard viral hashtag generator (returns 3-4 hashtags)
 */
function getStandardHashtags(title = '', categoryHint = '') {
  return buildRichHashtags(title, categoryHint).join(' ');
}

/**
 * Normalizes legacy/deprecated model names to current providers
 */
function normalizeModelName(name) {
  return aiClient.normalizeModelName(name);
}

/**
 * Immediately formats viral metadata for a candidate video.
 * If candidate doesn't match the channel niche, rejects immediately.
 */
function buildCandidateMetadata(candidate, customTitle = null, customDesc = null, customReason = null, customSongName = null) {
  const cleanTitle = (candidate.title || 'Epic Video').replace(/#\S+/g, '').trim();
  const category = detectContentCategory(cleanTitle, candidate.sourceName || '', candidate.description || '');

  if (!category) {
    throw new Error(`Genre Guard rejection: Candidate "${cleanTitle}" does not match channel niche (Anime Edits).`);
  }

  const franchise = detectFranchiseTag(cleanTitle, candidate.sourceName || '').replace('#', '').toUpperCase();
  const hashtags = buildRichHashtags(cleanTitle, candidate.sourceName || '');
  const titleTag = hashtags[0] || '#anime';

  const song = customSongName || 'MONTAGEM ALQUIMIA';
  const defaultTitle = aiClient.buildBeatSyncTitle
    ? aiClient.buildBeatSyncTitle({ hook: cleanTitle.slice(0, 30), franchise, songName: song, nicheTag: titleTag })
    : `${cleanTitle.slice(0, 45)} 🔥💀 | ${franchise} | Song - ${song} | ${titleTag} #edit #shorts`;
  const validatedTitle = validateGeneratedTitle(customTitle || defaultTitle);

  const richDescription = formatRichDescription({
    questionHook: 'Who had the peak aura in this scene?',
    franchise,
    character: 'Protagonist',
    hashtags,
    title: cleanTitle,
    categoryHint: candidate.sourceName || '',
    aiDescription: customDesc || '',
    songName: song
  });

  return {
    selectedCandidate: candidate,
    aiReasoning: customReason || `Selected high-engagement ${category} candidate from "${candidate.sourceName || 'Trending'}"`,
    optimizedTitle: validatedTitle,
    optimizedDescription: richDescription,
    questionHook: 'Who had the peak aura in this scene?',
    visualHook: `${franchise || 'Peak'} cold aura 💀`,
    franchise,
    character: 'Protagonist',
    hashtags,
    tags: [category, franchise, 'edit', 'shorts']
  };
}

/**
 * Evaluates candidate videos and selects the best one via AI gateway.
 * Strictly respects creator content mix percentages and balances under-represented topics.
 */
async function selectAndOptimizeVideo(candidates, apiKey, modelName = 'opencode/glm-5.3-flash-free', options = {}) {
  if (!candidates || candidates.length === 0) {
    throw new Error('No candidate videos available for evaluation');
  }

  // 1. Strict Genre Guard: Reject any candidate that does not match the channel's niche (Anime Edits)
  const validCandidates = candidates.filter(c => {
    const cat = detectContentCategory(c.title, c.sourceName, c.description);
    return cat !== null;
  });

  if (validCandidates.length === 0) {
    throw new Error('Genre Guard rejection: None of the candidate videos match the channel niche (Anime Edits). All non-matching candidates rejected.');
  }

  const sources = options.sources || [];
  const underrepresented = options.underrepresented || [];

  // Instant ranking based on target content balancing and viral proof
  const scoreCandidate = (c) => {
    let score = Math.min(25, (c.viewCount || 0) / 15000);
    if (typeof c.priorityBoost === 'number') {
      score += c.priorityBoost;
    }
    if (typeof c.sourcePercentage === 'number' && c.sourcePercentage > 0) {
      score += c.sourcePercentage * 0.5;
    }
    return score;
  };

  const ranked = [...validCandidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));

  let distributionPromptSection = '';
  if (sources.length > 0) {
    const distLines = sources.map(s => `- "${s.name || s.url}": target ${s.percentage || Math.round(100 / sources.length)}% of total uploads`);
    distributionPromptSection += `\nCREATOR'S CONFIGURED FRANCHISE PERCENTAGES:\n${distLines.join('\n')}\n`;
  }
  if (underrepresented.length > 0) {
    distributionPromptSection += `\n⚠️ URGENT BALANCING NOTICE — The following sub-franchises are currently UNDER-REPRESENTED in recent uploads:\n${underrepresented.join('\n')}\nYou SHOULD prioritize selecting a quality candidate from one of these under-represented franchises to maintain the creator's configured content percentages.\n`;
  }

  const prompt = `You are an elite YouTube Shorts packaging specialist for high-retention Anime edits (@Editclips-k2r viral style).

YOUR CHANNEL IS STRICTLY LOCKED TO ANIME EDITS.
CRITICAL CATEGORY ACCURACY RULE (STRICT GENRE GUARD):
- Evaluate the candidate list below. REJECT any candidate that is NOT an authentic Anime edit (e.g. Reject food, sports, UFC, non-anime gaming, commercial clips).
- Return metadata ONLY in the strict @Editclips-k2r viral edit formula.
- NEVER include generic placeholder titles like "Catchy Short Title" or "Title".
- NEVER include call-to-action strings like "Drop a like" or "Subscribe".

${distributionPromptSection}

CANDIDATES:
${JSON.stringify(validCandidates.map((c, i) => ({
  index: i,
  id: c.id,
  title: c.title,
  uploader: c.uploader,
  viewCount: c.viewCount,
  source: c.sourceName,
  descriptionSnippet: c.description ? c.description.slice(0, 160) : undefined
})), null, 2)}

Respond ONLY with a valid JSON object in this exact schema (no markdown backticks, no comments):
{
  "selectedIndex": 0,
  "aiReasoning": "1-2 sentence explanation of viral appeal and franchise balance",
  "title": "[2-4 Word Emotional Hook or Quote] 🔥💀 | [Exact Franchise/Series Name] | Song - [Track Name] | #[NicheTag] #edit #shorts",
  "questionHook": "[1 short polarizing question about the character/scene to trigger comment velocity]",
  "visualHook": "[3-5 word on-screen hook, e.g. 'Wait for his cold aura 💀' or 'The scene that broke the internet 🤯']",
  "franchise": "[Exact Show/Movie/Game Name]",
  "character": "[Character Name]",
  "hashtags": ["#[niche]", "#[franchise]", "#edit", "#shorts"]
}`;

  const { result, usedModel } = await aiClient.generateJSON(prompt, {
    model: modelName,
    task: 'reasoning',
    timeoutMs: 15000
  });

  const winnerIndex = (typeof result.selectedIndex === 'number' && validCandidates[result.selectedIndex])
    ? result.selectedIndex
    : 0;
  const winner = validCandidates[winnerIndex];

  const rawTitle = result.title || result.optimizedTitle;
  const validTitle = validateGeneratedTitle(rawTitle);

  const cleanHashtags = Array.isArray(result.hashtags) && result.hashtags.length >= 3
    ? result.hashtags.filter(t => !/fyp|foryou|reels|viral|trending|explore/i.test(t)).slice(0, 4)
    : buildRichHashtags(winner.title, winner.sourceName);

  const richDescription = formatRichDescription({
    questionHook: result.questionHook,
    franchise: result.franchise,
    character: result.character,
    hashtags: cleanHashtags,
    title: winner.title,
    categoryHint: winner.sourceName
  });

  return {
    selectedCandidate: winner,
    aiReasoning: result.aiReasoning || `Selected by ${usedModel} for franchise balance and viral traction`,
    optimizedTitle: validTitle,
    optimizedDescription: richDescription,
    questionHook: result.questionHook || 'Who had the colder aura in this scene?',
    visualHook: result.visualHook || `${result.character || result.franchise || 'Peak'} cold aura 💀`,
    franchise: result.franchise || 'Anime',
    character: result.character || 'Protagonist',
    hashtags: cleanHashtags,
    tags: ['anime', 'edit', 'shorts', result.franchise, result.character].filter(Boolean),
    rankedCandidates: ranked
  };
}

/**
 * Rewrites title and generates detailed description for a SINGLE video
 * (Used for Manual Uploads) matching @Editclips-k2r packaging
 */
async function rewriteSingleVideoMetadata({ title, description, uploader, sourceUrl = '', channelUrl = '' }, apiKey, modelName = 'opencode/glm-5.3-flash-free') {
  const category = detectContentCategory(title, '', description);
  if (!category) {
    throw new Error(`Genre Guard rejection: Video "${title}" does not match channel niche (Anime Edits).`);
  }

  const prompt = `You are an elite viral content strategist and YouTube SEO algorithm specialist targeting a global audience (@Editclips-k2r viral edit style).
Formulate high-performing, click-worthy metadata for this Anime Short:

Requirements:
1. Title matching @Editclips-k2r packaging: "[2-4 Word Emotional Hook or Quote] 🔥💀 | [Exact Franchise/Series Name] | Song - [Track Name] | #[NicheTag] #edit #shorts"
2. 1 short polarizing question about the character/scene to trigger comment velocity.
3. Exact Franchise and Character names.
4. Strictly 3 to 4 hashtags: ["#[niche]", "#[franchise]", "#edit", "#shorts"]. No cross-platform tags.
5. NEVER return placeholder titles like "Catchy Short Title".
6. NO generic CTAs like "Drop a like" or "Subscribe".

Video Info:
Title: ${title}
Description: ${description || 'N/A'}
Creator: ${uploader || 'N/A'}

Respond ONLY with valid JSON (no markdown backticks, no comments):
{
  "title": "[2-4 Word Emotional Hook or Quote] 🔥💀 | [Exact Franchise/Series Name] | Song - [Track Name] | #[NicheTag] #edit #shorts",
  "questionHook": "[1 short polarizing question about the character/scene to trigger comment velocity]",
  "visualHook": "[3-5 word on-screen hook, e.g. 'Wait for his cold aura 💀' or 'The scene that broke the internet 🤯']",
  "franchise": "[Exact Show/Movie/Game Name]",
  "character": "[Character Name]",
  "hashtags": ["#[niche]", "#[franchise]", "#edit", "#shorts"]
}`;

  const { result } = await aiClient.generateJSON(prompt, {
    model: modelName,
    task: 'metadata'
  });

  const rawTitle = result.title || result.optimizedTitle;
  const validTitle = validateGeneratedTitle(rawTitle);

  const cleanHashtags = Array.isArray(result.hashtags) && result.hashtags.length >= 3
    ? result.hashtags.filter(t => !/fyp|foryou|reels|viral|trending|explore/i.test(t)).slice(0, 4)
    : buildRichHashtags(title);

  const richDescription = formatRichDescription({
    questionHook: result.questionHook,
    franchise: result.franchise,
    character: result.character,
    hashtags: cleanHashtags,
    title,
    categoryHint: 'Anime'
  });

  return {
    optimizedTitle: validTitle,
    optimizedDescription: richDescription,
    questionHook: result.questionHook || 'Who had the colder aura in this scene?',
    visualHook: result.visualHook || `${result.character || result.franchise || 'Peak'} cold aura 💀`,
    franchise: result.franchise || 'Anime',
    character: result.character || 'Protagonist',
    hashtags: cleanHashtags,
    tags: ['anime', 'edit', 'shorts', result.franchise, result.character].filter(Boolean)
  };
}

module.exports = {
  selectAndOptimizeVideo,
  buildCandidateMetadata,
  rewriteSingleVideoMetadata,
  getStandardHashtags,
  buildRichHashtags,
  formatRichDescription,
  detectContentCategory,
  detectFranchiseTag,
  validateGeneratedTitle,
  normalizeModelName
};
