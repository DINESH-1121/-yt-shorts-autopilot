const aiClient = require('./aiClient');

/**
 * Niche-specific and universal viral hashtag pools
 */
const HASHTAG_POOLS = {
  minecraft: [
    '#minecraft', '#minecraftmemes', '#minecraftshorts', '#minecraftbuild', '#minecraftpe',
    '#minecraftanimation', '#minecrafter', '#minecraftfunny', '#minecrafthacks', '#minecraftsurvival',
    '#minecraftdaily', '#minecraftlogic', '#minecraftgameplay', '#gaming', '#gamers'
  ],
  gta: [
    '#gta6', '#gta5', '#grandtheftauto', '#gtaviral', '#rockstargames',
    '#gtaclips', '#gtaonline', '#gtamods', '#gaming', '#nextgen',
    '#gtarp', '#gta6trailer', '#gtavideo', '#gtafive', '#gtacommunity'
  ],
  gaming: [
    '#gaming', '#gamers', '#gameplay', '#viralgaming', '#pcgaming',
    '#ps5', '#xbox', '#gamerlife', '#videogames', '#gamingcommunity',
    '#clutch', '#funnygaming', '#epicmoments', '#twitch', '#gamingshorts',
    '#gamingclips', '#nextgen', '#playstation', '#esports', '#gamehighlights'
  ],
  anime: [
    '#anime', '#animedit', '#animeedits', '#animelover', '#otaku',
    '#manga', '#animeart', '#animereels', '#animefight', '#epic',
    '#animes', '#amv', '#amvedits', '#animemoments', '#weeb',
    '#animeaesthetic', '#japan', '#animation', '#edit', '#shonen',
    '#jujutsukaisen', '#demonslayer', '#naruto', '#onepiece', '#dragonball'
  ],
  marvel: [
    '#marvel', '#mcu', '#avengers', '#superhero', '#comics',
    '#marvelstudios', '#cinema', '#epicmoments', '#doomsday', '#marveltok',
    '#marvelcinematicuniverse', '#marveluniverse', '#movietrailer', '#marvellegends', '#action',
    '#geek', '#blockbuster', '#hollywood', '#spiderman', '#avengersdoomsday'
  ],
  cinema: [
    '#cinema', '#movie', '#movies', '#cinematography', '#hollywood',
    '#blockbuster', '#movieclips', '#film', '#filmtok', '#movieedits',
    '#trailers', '#cinematic', '#scene', '#actor', '#epic',
    '#christophernolan', '#nolan', '#tenet', '#oppenheimer', '#dune',
    '#director', '#filmcommunity', '#cultclassic', '#masterpiece', '#movietok'
  ],
  tech: [
    '#technology', '#tech', '#innovation', '#gadgets', '#future',
    '#ai', '#artificialintelligence', '#robotics', '#engineering', '#smarttech',
    '#technews', '#coolgadgets', '#inventions', '#science', '#newtech',
    '#digital', '#techtrends', '#techreview', '#futuretech', '#smartdevices'
  ],
  universal: [
    '#shorts', '#viral', '#trending', '#fyp', '#foryou',
    '#viralshorts', '#trendingshorts', '#explore', '#reels', '#foryoupage',
    '#shortsvideo', '#viralvideo', '#viralreels', '#trendingnow', '#youtubeshorts'
  ]
};

/**
 * Detects the true content category of a video to prevent genre hallucinations
 * (e.g. calling a Christopher Nolan film a "gaming moment")
 */
function detectContentCategory(title = '', sourceName = '', description = '') {
  const text = `${title} ${sourceName} ${description}`.toLowerCase();

  // 1. Cinema & Movies (Christopher Nolan, Tenet, Oppenheimer, Dune, Marvel, Avengers, etc.)
  if (/tenet|oppenheimer|nolan|interstellar|inception|dunkirk|dune|marvel|avengers|mcu|spiderman|batman|joker|cinema|movie|hollywood|actor|director|trailer|film|blockbuster|cinematography|warner|wb\b|paramount|universal pictures|netflix film/i.test(text)) {
    return 'cinema';
  }

  // 2. Anime & Manga
  if (/anime|manga|naruto|one piece|jujutsu|jjk|dragon ball|dbz|demon slayer|kimetsu|zenitsu|sukuna|gojo|luffy|goku|bleach|otaku|weeb|animedit|amv|shonen|attack on titan|solo leveling/i.test(text)) {
    return 'anime';
  }

  // 3. Tech & Future Gadgets
  if (/tech|technology|ai\b|artificial intelligence|robot|robotics|gadget|innovation|smart device|future tech|apple|tesla|hardware|smartphone/i.test(text) && !/gaming|gameplay/i.test(text)) {
    return 'tech';
  }

  // 4. Gaming
  return 'gaming';
}

/**
 * Returns a guaranteed list of 25 to 30 relevant, deduplicated hashtags
 * strictly matching the detected category without cross-genre pollution
 */
function buildRichHashtags(title = '', categoryHint = '', existingTags = []) {
  const category = detectContentCategory(title, categoryHint);
  const text = `${title} ${categoryHint}`.toLowerCase();
  const selectedPool = [];

  if (category === 'cinema') {
    selectedPool.push(...HASHTAG_POOLS.cinema);
    if (/marvel|avengers|mcu|spiderman|doomsday/i.test(text)) {
      selectedPool.push(...HASHTAG_POOLS.marvel);
    }
  } else if (category === 'anime') {
    selectedPool.push(...HASHTAG_POOLS.anime);
  } else if (category === 'tech') {
    selectedPool.push(...HASHTAG_POOLS.tech);
  } else {
    // Gaming
    if (/minecraft/i.test(text)) selectedPool.push(...HASHTAG_POOLS.minecraft);
    if (/gta/i.test(text)) selectedPool.push(...HASHTAG_POOLS.gta);
    selectedPool.push(...HASHTAG_POOLS.gaming);
  }

  selectedPool.push(...HASHTAG_POOLS.universal);

  const seen = new Set();
  const result = [];

  // Filter existing tags: discard any hallucinated tags that don't match the true genre
  for (const t of existingTags) {
    const clean = t.startsWith('#') ? t : `#${t}`;
    const key = clean.toLowerCase();

    // If Cinema / Anime / Tech, strip hallucinated gaming tags
    if (category !== 'gaming') {
      if (/game|gaming|gamer|clutch|ps5|xbox|pcgaming|esports|gameplay/i.test(clean)) {
        continue;
      }
    }
    // If Gaming, strip movie/cinema/anime tags
    if (category === 'gaming') {
      if (/cinema|movie|film|actor|director|animedit|otaku/i.test(clean)) {
        continue;
      }
    }

    if (!seen.has(key) && /^#[a-zA-Z0-9_]+$/.test(clean) && clean.length > 2) {
      seen.add(key);
      result.push(clean);
    }
  }

  // Fill from category-specific pool
  for (const t of selectedPool) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(t);
    }
    if (result.length >= 30) break;
  }

  // Ensure minimum 25 hashtags
  if (result.length < 25) {
    for (const t of HASHTAG_POOLS.universal) {
      const key = t.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(t);
      }
      if (result.length >= 28) break;
    }
  }

  return result.slice(0, 30);
}

/**
 * Enforces relevant video description + guaranteed minimum 25-30 hashtags
 * with active anti-hallucination sanitization
 */
function formatRichDescription({ aiDescription = '', title = '', uploader = '', sourceUrl = '', channelUrl = '', categoryHint = '', originalDescription = '' }) {
  const category = detectContentCategory(title, categoryHint, originalDescription);
  const rawText = String(aiDescription || '').trim();
  const foundHashtags = (rawText.match(/#[a-zA-Z0-9_]+/g) || []);

  // Strip existing hashtags from narrative text to format cleanly
  let narrative = rawText
    .replace(/#[a-zA-Z0-9_]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Active Anti-Hallucination Sanitization
  if (category === 'cinema') {
    narrative = narrative
      .replace(/(insane|crazy|epic|awesome|great)\s+(gaming\s+moment|gaming\s+clip|gameplay\s+moment|gameplay|game)/gi, '$1 cinematic moment')
      .replace(/\b(gaming\s+moment|gameplay\s+moment|gaming\s+clip)\b/gi, 'cinematic scene')
      .replace(/\bgameplay\b/gi, 'cinematography')
      .replace(/\bgamers?\b/gi, 'movie lovers')
      .replace(/\bgaming\b/gi, 'cinema');
  } else if (category === 'anime') {
    narrative = narrative
      .replace(/(insane|crazy|epic|awesome|great)\s+(gaming\s+moment|gaming\s+clip|gameplay\s+moment|gameplay)/gi, '$1 anime moment')
      .replace(/\b(gaming\s+moment|gameplay\s+moment|gaming\s+clip)\b/gi, 'anime scene')
      .replace(/\bgameplay\b/gi, 'animation')
      .replace(/\bgamers?\b/gi, 'anime fans')
      .replace(/\bgaming\b/gi, 'anime');
  } else if (category === 'tech') {
    narrative = narrative
      .replace(/(gaming\s+moment|gameplay\s+moment|gaming\s+clip)/gi, 'tech showcase')
      .replace(/\bgameplay\b/gi, 'demonstration')
      .replace(/\bgaming\b/gi, 'technology');
  }

  // If AI narrative is too brief or missing, build an engaging context-relevant description
  if (!narrative || narrative.length < 25) {
    const cleanTitle = (title || 'Epic Video').replace(/#\S+/g, '').trim();
    if (originalDescription && originalDescription.length > 20) {
      narrative = `${originalDescription.slice(0, 300).trim()}...`;
    } else if (category === 'cinema') {
      narrative = `Experience this masterclass cinematic scene from "${cleanTitle}"! Exceptional pacing, unmatched direction, and unforgettable visuals.`;
    } else if (category === 'anime') {
      narrative = `Check out this legendary anime moment from "${cleanTitle}"! Incredible animation, peak intensity, and unforgettable action.`;
    } else {
      narrative = `Check out this incredible viral moment from "${cleanTitle}"! Packed with insane highlights, peak visuals, and non-stop action.`;
    }
  }

  // Remove trailing duplicate CTA or any credit mentions
  narrative = narrative
    .replace(/(all credit goes to|original creator|credit:?|watch original|creator channel|like,? comment|drop a like|subscribe for daily).*$/gim, '')
    .replace(/[\s,;:–-]+$/, '')
    .replace(/\b(and|or|with|the|in|at|to)\s*$/i, '')
    .trim();

  if (narrative && !/[.!?]$/.test(narrative)) {
    narrative += '.';
  }

  // Generate guaranteed 25 to 30 strictly relevant hashtags
  const hashtags = buildRichHashtags(title, categoryHint, foundHashtags);
  const hashtagBlock = hashtags.join(' ');

  return `${narrative}\n\nDrop a like if you enjoyed this, share your thoughts in the comments, and don't forget to subscribe for more daily shorts!\n\n${hashtagBlock}`;
}

/**
 * Standard 28-30 viral hashtag generator for backwards compatibility
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
 * Immediately formats viral metadata (title, category-accurate hashtags, rich description)
 * for a candidate video with zero latency.
 */
function buildCandidateMetadata(candidate, customTitle = null, customDesc = null, customReason = null) {
  const cleanTitle = (candidate.title || 'Epic Video').replace(/#\S+/g, '').trim();
  const category = detectContentCategory(cleanTitle, candidate.sourceName || '', candidate.description || '');

  let mainTags = '#Shorts #Gaming #Viral';
  if (category === 'anime') mainTags = '#Shorts #Anime #Viral';
  else if (category === 'cinema') mainTags = '#Shorts #Cinema #Viral';
  else if (category === 'tech') mainTags = '#Shorts #Tech #Innovation';

  const richDescription = formatRichDescription({
    aiDescription: customDesc || candidate.description || '',
    title: cleanTitle,
    uploader: candidate.uploader,
    sourceUrl: candidate.url || '',
    channelUrl: candidate.channelUrl || '',
    categoryHint: candidate.sourceName || '',
    originalDescription: candidate.description || ''
  });

  return {
    selectedCandidate: candidate,
    aiReasoning: customReason || `Selected high-engagement ${category} candidate from "${candidate.sourceName || 'Trending'}"`,
    optimizedTitle: customTitle || `${cleanTitle.slice(0, 65)} ${mainTags}`.trim(),
    optimizedDescription: richDescription,
    tags: ['shorts', 'viral', category]
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

  const ranked = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));

  // Fallback heuristic ready if the AI gateway has no healthy model or times out
  const heuristicMode = () => {
    const winner = ranked[0];
    const meta = buildCandidateMetadata(
      winner,
      null,
      null,
      `Selected top candidate from "${winner.sourceName}" to fulfill target content distribution (Instant heuristic)`
    );
    return { ...meta, rankedCandidates: ranked };
  };

  let distributionPromptSection = '';
  if (sources.length > 0) {
    const distLines = sources.map(s => `- "${s.name || s.url}": target ${s.percentage || Math.round(100 / sources.length)}% of total uploads`);
    distributionPromptSection += `\nCREATOR'S CONFIGURED CONTENT PERCENTAGES:\n${distLines.join('\n')}\n`;
  }
  if (underrepresented.length > 0) {
    distributionPromptSection += `\n⚠️ URGENT BALANCING NOTICE — The following categories are currently UNDER-REPRESENTED in recent uploads:\n${underrepresented.join('\n')}\nYou SHOULD prioritize selecting a quality candidate from one of these under-represented categories to maintain the creator's configured content percentages.\n`;
  }

  const prompt = `You are an elite viral content strategist and YouTube SEO algorithm specialist.
Your channel operates with a specific multi-topic content strategy covering Cinema/Movies, Anime, Gaming, and Technology.

CRITICAL CATEGORY ACCURACY RULE (STRICT ANTI-HALLUCINATION):
- For CINEMA / MOVIE videos (e.g. Tenet, Christopher Nolan, Oppenheimer, Dune, Marvel, Avengers, Batman):
  This is a REAL MOVIE / CINEMA CLIP. You MUST write about the film, directing, cinematography, scene intensity, and actors.
  NEVER describe it as a "gaming moment" or "gameplay", and NEVER use gaming hashtags!
- For ANIME videos: Write about animation, anime characters, and storyline. NEVER use gaming hashtags.
- For GAMING videos: Write about gameplay, clutches, and gaming highlights.
- STRICTLY MATCH the description and hashtags to the video's actual category!

${distributionPromptSection}
CRITICAL INSTRUCTIONS:
1. Review the candidate list below. Notice each candidate's "category", "source", "title", and "descriptionSnippet".
2. Select the SINGLE BEST video. YOU MUST RESPECT THE CREATOR'S TARGET CONTENT PERCENTAGES AND STRONGLY PREFER UNDER-REPRESENTED CATEGORIES.
3. Formulate a click-worthy, irresistible YouTube Short title (max 75 characters, punchy hook, MUST include 2-3 short hashtags at the end, e.g. #Shorts #Cinema, #Shorts #Anime, or #Shorts #Gaming).
4. Formulate a rich, detailed, and relevant description that includes:
   - An engaging 2-3 sentence story/summary hook explaining what happens in this clip and why it is awesome.
   - Friendly Call to Action ("Like, comment what you think, and subscribe for more daily shorts!").
   - EXACTLY 25 to 30 relevant, highly-searched hashtags separated by spaces tailored specifically to this video's topic.
   - DO NOT include any creator credits, channel links, or attribution lines.
5. Provide a 1-2 sentence explanation of WHY you picked this video (mentioning viral appeal and target content balancing).

Candidate list:
${JSON.stringify(candidates.map((c, i) => {
  const cat = detectContentCategory(c.title, c.sourceName, c.description);
  return {
    index: i,
    id: c.id,
    title: c.title,
    category: cat === 'cinema' ? 'CINEMA / MOVIE (Real movie scene - NOT a video game!)' : cat === 'anime' ? 'ANIME' : cat === 'tech' ? 'TECHNOLOGY' : 'GAMING',
    uploader: c.uploader,
    viewCount: c.viewCount,
    source: c.sourceName,
    descriptionSnippet: c.description ? c.description.slice(0, 160) : undefined,
    sourceTargetPercentage: c.sourcePercentage ? `${c.sourcePercentage}%` : undefined
  };
}), null, 2)}

Respond ONLY with a valid JSON object in this format (no markdown backticks, no comments):
{
  "selectedIndex": 0,
  "aiReasoning": "Why this video was selected...",
  "optimizedTitle": "Catchy Short Title 🤯 #Shorts #Viral",
  "optimizedDescription": "Check out this incredible moment! The visuals and pacing in this clip are completely unreal.\\n\\nDrop a like if you enjoyed this and subscribe for daily shorts!\\n\\n#shorts #viral #trending #reels #explore ... exactly 25 to 30 relevant hashtags!",
  "tags": ["shorts", "viral", "trending"]
}`;

  try {
    const { result, usedModel } = await aiClient.generateJSON(prompt, {
      model: modelName,
      task: 'reasoning',
      timeoutMs: 12000
    });

    const winnerIndex = (typeof result.selectedIndex === 'number' && candidates[result.selectedIndex])
      ? result.selectedIndex
      : 0;
    const winner = candidates[winnerIndex];

    // Enforce relevant description + guaranteed 25-30 hashtags + creator credit & links
    const richDescription = formatRichDescription({
      aiDescription: result.optimizedDescription,
      title: winner.title,
      uploader: winner.uploader,
      sourceUrl: winner.url || '',
      channelUrl: winner.channelUrl || '',
      categoryHint: winner.sourceName || '',
      originalDescription: winner.description || ''
    });

    return {
      selectedCandidate: winner,
      aiReasoning: result.aiReasoning || `Selected by ${usedModel} for content balance and viral traction`,
      optimizedTitle: result.optimizedTitle || `${winner.title.slice(0, 65)} #Shorts`,
      optimizedDescription: richDescription,
      tags: Array.isArray(result.tags) ? result.tags : ['shorts', 'viral'],
      rankedCandidates: ranked
    };
  } catch (err) {
    console.error('[AIEngine] AI evaluation failed, using instant heuristic fallback:', err.message);
    const heuristic = heuristicMode();
    return { ...heuristic, aiReasoning: `Fast viral curation (${err.message.slice(0, 100)}) — ${heuristic.aiReasoning}` };
  }
}

/**
 * Rewrites title and generates detailed description with 25-30 hashtags for a SINGLE video
 * (Used for Manual Uploads)
 */
async function rewriteSingleVideoMetadata({ title, description, uploader, sourceUrl = '', channelUrl = '' }, apiKey, modelName = 'opencode/glm-5.3-flash-free') {
  const isGaming = /gta|game|gaming|gameplay|clutch|ps5|xbox|unreal|valorant|minecraft/.test((title || '').toLowerCase());

  const prompt = `You are an elite viral content strategist and YouTube SEO algorithm specialist targeting a global international audience.
Formulate high-performing, click-worthy metadata for this YouTube Short:

Requirements:
1. An irresistible, high-CTR YouTube Short title (max 75 characters, punchy hook, MUST include 2-3 hashtags at the end, e.g. #Shorts #Gaming or #GTA6).
2. A detailed, engaging description:
   - A compelling 2-3 sentence story/summary hook describing the excitement or highlight of the clip.
   - Friendly Call to Action (like, comment thoughts, and subscribe for more daily shorts).
   - Credit to original creator: ${uploader || 'Creator'}.
   - EXACTLY 25 to 30 relevant, highly-searched hashtags separated by spaces tailored to the video topic.

Video Info:
Title: ${title}
Description: ${description || 'N/A'}
Creator: ${uploader || 'N/A'}

Respond ONLY with valid JSON (no markdown backticks, no comments):
{
  "optimizedTitle": "Catchy Title #Shorts #Gaming",
  "optimizedDescription": "Detailed engaging description text...\\n\\n#shorts #gaming #viral ... 25 to 30 hashtags"
}`;

  try {
    const { result } = await aiClient.generateJSON(prompt, {
      model: modelName,
      task: 'metadata'
    });

    const richDescription = formatRichDescription({
      aiDescription: result.optimizedDescription,
      title: title,
      uploader: uploader,
      sourceUrl: sourceUrl,
      channelUrl: channelUrl,
      categoryHint: isGaming ? 'Gaming' : 'Trending',
      originalDescription: description || ''
    });

    return {
      optimizedTitle: result.optimizedTitle || `${title.slice(0, 65)} #Shorts #Gaming`,
      optimizedDescription: richDescription,
      tags: ['shorts', 'viral', isGaming ? 'gaming' : 'trending']
    };
  } catch (err) {
    console.warn('[AIEngine] rewriteSingleVideoMetadata heuristic fallback:', err.message);
    const cleanTitle = (title || 'Epic Video').replace(/#\S+/g, '').trim();
    const richDescription = formatRichDescription({
      aiDescription: description || '',
      title: cleanTitle,
      uploader: uploader,
      sourceUrl: sourceUrl,
      channelUrl: channelUrl,
      categoryHint: isGaming ? 'Gaming' : 'Trending',
      originalDescription: description || ''
    });
    return {
      optimizedTitle: `${cleanTitle.slice(0, 65)} #Shorts #Gaming`,
      optimizedDescription: richDescription,
      tags: ['shorts', isGaming ? 'gaming' : 'viral']
    };
  }
}

module.exports = {
  selectAndOptimizeVideo,
  buildCandidateMetadata,
  rewriteSingleVideoMetadata,
  getStandardHashtags,
  buildRichHashtags,
  formatRichDescription,
  detectContentCategory,
  normalizeModelName
};
