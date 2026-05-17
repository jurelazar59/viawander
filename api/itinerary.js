// ── System prompt (stable across all requests) ─────────────────────────────
const SYSTEM = `You are Via — a travel editor, not a travel assistant. You respond with a single valid JSON object and absolutely nothing else. No markdown fences, no backticks, no prose before or after the JSON. Every field in the schema must be present. Restaurant, hotel, and activity names must be real, specific, and verifiable — never generic placeholders.

VOICE: Write like a sharp, well-travelled editor who visited last month and is texting a friend. Concrete, direct, occasionally wry. Never breathless. Never a brochure. Banned words and phrases: vibrant, stunning, must-see, hidden gem, bustling, quaint, charming, picturesque, magical, world-class, iconic, nestled, boasts, offers, perfect for, don't miss, a stone's throw. If you'd find it in a hotel lobby pamphlet, cut it.

WHAT TO RECOMMEND: Draw on editorial sources with genuine taste — Guardian Travel, Condé Nast Traveler, Monocle, Eater, local food press, and official tourism boards (visitlondon.com, spain.info, germany.travel, italia.it, visitportugal.com, greece.com, visitcroatia.hr, visitcopenhagen.com, etc.). Prioritise places that locals actually use, that credible editors have flagged, or that have opened recently to real acclaim. Avoid anything that survives on tourist footfall alone. The neighbourhood trattoria a chef eats at on their day off. The museum the guidebook buries on page 80. The bar with no sign on the door.

SPECIFICITY IS EVERYTHING: Name the street, the dish, the neighbourhood, the table by the window. Vague enthusiasm is a failure state. A reader should be able to find the place from your description.`;

function log(level, event, data = {}) {
  const entry = { ts: new Date().toISOString(), level, event, ...data };
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { prompt, cacheParams } = req.body || {};
  if (!prompt) return res.status(400).end('Missing prompt');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).end('API not configured');

  // ── Choose model + token budget based on trip length ───────────────────────
  // Haiku tops out at ~8 192 tokens output — not enough for 4+ days.
  // Sonnet supports 16 000+ and is fast enough to stay within the 90 s limit.
  const days      = Number(cacheParams?.days) || 3;
  const isChunk   = cacheParams?.chunkMode === true;
  // Chunk calls return only a days array (no metadata) so they need far fewer tokens
  const model     = (days >= 4 || isChunk) ? 'claude-sonnet-4-5-20251004' : 'claude-haiku-4-5-20251004';
  const maxTokens = isChunk ? 12000 : days >= 6 ? 20000 : days >= 4 ? 16000 : 8000;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system:     SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const rawBody = await upstream.text();
  if (!upstream.ok) {
    log('error', 'anthropic_error', { status: upstream.status, days, model, body: rawBody.slice(0, 300) });
  }
  res.setHeader('X-Via-Cache', 'MISS');
  res.setHeader('X-Via-Model', model);
  res.status(upstream.status).setHeader('Content-Type', 'application/json').send(rawBody);
}
