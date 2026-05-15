// ── System prompt (stable across all requests) ─────────────────────────────
const SYSTEM = `You are Via — a sophisticated AI travel planner with deep local knowledge. You always respond with a single valid JSON object and absolutely nothing else. No markdown fences, no backticks, no prose before or after the JSON. Every field in the schema must be present. Restaurant, hotel, and activity names must be authentic and specific to the destination — never generic placeholders. Your prose is warm, personal, and concrete — like advice from a well-travelled friend who knows the city, not a brochure.`;

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
  const model     = (days >= 4 || isChunk) ? 'claude-sonnet-4-5' : 'claude-haiku-4-5';
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
