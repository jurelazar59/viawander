export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  const { prompt } = req.body || {};
  if (!prompt) {
    return res.status(400).end('Missing prompt');
  }

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await upstream.text();
  res.status(upstream.status).setHeader('Content-Type', 'application/json').send(data);
}
