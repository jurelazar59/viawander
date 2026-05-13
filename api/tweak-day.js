const SYSTEM = `You are Via — an AI travel planner. You receive an existing single day from a trip itinerary and a modification request. You respond with ONLY the updated day as a valid JSON object — no markdown, no backticks, no commentary. Preserve the exact same JSON structure and all fields. Only change what the traveller explicitly requested. Keep restaurant names, accommodation, and swap options realistic and specific to the destination.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).end('Missing prompt');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).end('API not configured');

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5',
      max_tokens:  2500,
      system:      SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await upstream.text();
  res.status(upstream.status).setHeader('Content-Type', 'application/json').send(data);
}
