// Extracts a travel destination from any URL (TikTok, Instagram, blogs, etc.)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { url } = req.body || {};
  if (!url) return res.status(400).end('Missing url');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).end('API not configured');

  // ── 1. Fetch the URL ──────────────────────────────────────────────────────
  let content = '';
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ViaBot/1.0; +https://viawander.co)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });

    const html = await r.text();

    // Extract meaningful text signals
    const title    = (html.match(/<title[^>]*>([^<]{1,200})<\/title>/i) || [])[1] || '';
    const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,500})["']/i)
                  || html.match(/<meta[^>]+content=["']([^"']{1,500})["'][^>]+name=["']description["']/i) || [])[1] || '';
    const ogTitle  = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})["']/i)
                  || html.match(/<meta[^>]+content=["']([^"']{1,200})["'][^>]+property=["']og:title["']/i) || [])[1] || '';
    const ogDesc   = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,500})["']/i)
                  || html.match(/<meta[^>]+content=["']([^"']{1,500})["'][^>]+property=["']og:description["']/i) || [])[1] || '';
    const h1       = (html.match(/<h1[^>]*>([^<]{1,200})<\/h1>/i) || [])[1] || '';

    // Strip tags from body excerpt
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 800);

    content = [title, ogTitle, metaDesc, ogDesc, h1, body]
      .map(s => s.trim()).filter(Boolean).join('\n\n').slice(0, 1800);
  } catch (fetchErr) {
    // If we can't fetch (CORS, timeout, etc.) just pass the raw URL text to Claude
    content = `URL: ${url}`;
  }

  // ── 2. Ask Claude to identify the destination ─────────────────────────────
  const r2 = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5',
      max_tokens:  256,
      messages: [{
        role: 'user',
        content: `A user pasted this URL or web content into a travel planner. Extract the main travel destination.

Return ONLY valid JSON (no markdown, no explanation):
{"dest":"City or Country name","dest_display":"City, Country","confidence":"high|medium|low"}

If no travel destination is identifiable, return:
{"dest":null,"confidence":"none"}

Rules:
- "dest" should be a short, clean destination string (e.g. "Kotor", "Montenegro", "Bali", "Croatia")
- "dest_display" should be the full display name (e.g. "Kotor, Montenegro", "Bali, Indonesia")
- Prefer specific city over country when both are clear
- Ignore destinations that are clearly the user's home city in passing references
- confidence "high" = destination is explicitly the subject; "medium" = likely subject; "low" = mentioned but unclear

Content:
${content}`,
      }],
    }),
  });

  const data = await r2.json();
  const raw  = ((data.content || []).map(b => b.text || '').join('')).trim();
  const clean = raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'').trim();

  try {
    res.status(200).json(JSON.parse(clean));
  } catch {
    res.status(200).json({ dest: null, confidence: 'none' });
  }
}
