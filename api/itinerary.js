import { kv } from '@vercel/kv';

// ── System prompt (stable across all requests) ────────────────────────────────
const SYSTEM = `You are Via — a sophisticated AI travel planner with deep local knowledge. You always respond with a single valid JSON object and absolutely nothing else. No markdown fences, no backticks, no prose before or after the JSON. Every field in the schema must be present. Restaurant, hotel, and activity names must be authentic and specific to the destination — never generic placeholders. Your prose is warm, personal, and concrete — like advice from a well-travelled friend who knows the city, not a brochure.`;

// ── Deterministic cache key from stable trip params ───────────────────────────
function makeCacheKey(p) {
  const str = JSON.stringify({
    dest:   (p.dest   || '').toLowerCase().trim(),
    days:    p.days,
    budget:  p.budget,
    vibes:  [...(p.vibes  || [])].sort().join(','),
    comp:    p.comp,
    lang:    p.lang,
    pace:   (p.pace   || 'balanced'),
  });
  // djb2-style hash — no crypto dependency needed
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  }
  return 'via:itin:v2:' + Math.abs(h).toString(36);
}

// ── Whether Vercel KV is wired up ─────────────────────────────────────────────
function kvAvailable() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { prompt, cacheParams } = req.body || {};
  if (!prompt) return res.status(400).end('Missing prompt');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).end('API not configured');

  // ── 1. Cache read ────────────────────────────────────────────────────────────
  let cacheKey = null;
  if (kvAvailable() && cacheParams) {
    try {
      cacheKey = makeCacheKey(cacheParams);
      const cached = await kv.get(cacheKey);
      if (cached) {
        res.setHeader('X-Via-Cache', 'HIT');
        res.setHeader('Content-Type', 'application/json');
        // Wrap the cached itinerary string back into Anthropic response shape
        return res.status(200).json({
          content: [{ type: 'text', text: cached }],
        });
      }
    } catch (kvErr) {
      // KV unavailable — proceed without cache, don't break the request
      console.warn('[via] KV read error:', kvErr.message);
      cacheKey = null;
    }
  }

  // ── 2. Call Anthropic ────────────────────────────────────────────────────────
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5',
      max_tokens:  8000,
      system:      SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const rawBody = await upstream.text();

  // ── 3. Cache write (only on success) ─────────────────────────────────────────
  if (upstream.ok && cacheKey) {
    try {
      // Extract the text content and store just the itinerary JSON string
      const parsed = JSON.parse(rawBody);
      const itinText = (parsed.content || []).map(b => b.text || '').join('').trim();
      if (itinText) {
        await kv.set(cacheKey, itinText, { ex: 86400 }); // 24 h TTL
      }
    } catch (kvErr) {
      console.warn('[via] KV write error:', kvErr.message);
    }
  }

  res.setHeader('X-Via-Cache', 'MISS');
  res.status(upstream.status).setHeader('Content-Type', 'application/json').send(rawBody);
}
