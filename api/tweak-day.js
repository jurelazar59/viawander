const SYSTEM = `You are Via — an AI travel planner. You receive an existing single day from a trip itinerary and a modification request. You respond with ONLY the updated day as a valid JSON object — no markdown, no backticks, no commentary. Preserve the exact same JSON structure and all fields. Only change what the traveller explicitly requested. Keep restaurant names, accommodation, and swap options realistic and specific to the destination.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  // Support both legacy single-prompt and new messages-array format
  const { prompt, messages } = req.body || {};
  if (!prompt && !messages) return res.status(400).end('Missing prompt or messages');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).end('API not configured');

  // Build the messages array
  const msgs = messages
    ? messages                                // new chat-style: [{role, content}]
    : [{ role: 'user', content: prompt }];    // legacy single-prompt

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251004',
      max_tokens:  2500,
      system:      SYSTEM,
      messages:    msgs,
    }),
  });

  const data = await upstream.text();
  res.status(upstream.status).setHeader('Content-Type', 'application/json').send(data);
}
