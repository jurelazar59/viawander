// Handles one-click unsubscribe links sent in price-alert emails.
// GET /api/unsubscribe-alert?id={alertId}&token={hmac}

import { createHmac }  from 'crypto';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function makeToken(alertId, email, secret) {
  return createHmac('sha256', secret)
    .update(`${alertId}:${email}`)
    .digest('hex')
    .slice(0, 40);
}

function page(title, body, color = '#2a7a4b') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Via</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Georgia',serif;background:#F2EBD9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
    .card{background:#FAF6EE;border-radius:8px;padding:2.5rem 3rem;max-width:440px;width:100%;box-shadow:0 4px 24px rgba(28,21,16,.08);text-align:center}
    .icon{font-size:2.5rem;margin-bottom:1rem;color:${color}}
    h1{font-size:1.4rem;font-weight:700;color:#1C1510;margin-bottom:.6rem}
    p{font-size:.95rem;color:#5c4a37;line-height:1.65;margin-bottom:1.4rem}
    a{display:inline-block;background:#1C1510;color:#FAF6EE;font-family:sans-serif;font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:.7rem 1.6rem;border-radius:3px;text-decoration:none}
    .brand{font-size:1.6rem;font-weight:900;color:#1C1510;letter-spacing:-.04em;margin-bottom:1.8rem}
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">via.</div>
    <div class="icon">${color === '#2a7a4b' ? '✓' : '✕'}</div>
    <h1>${title}</h1>
    <p>${body}</p>
    <a href="https://viawander.co">Back to Via</a>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const params  = new URL(req.url, 'https://x').searchParams;
  const alertId = params.get('id');
  const token   = params.get('token');

  if (!alertId || !token) {
    return res.status(400).send(page(
      'Invalid link',
      'This unsubscribe link is missing required parameters. Please use the link from your email.',
      '#c0392b',
    ));
  }

  const supa = getSupabase();
  if (!supa) {
    return res.status(200).send(page(
      'Already unsubscribed',
      'Your alert has been removed. You will no longer receive price notifications.',
    ));
  }

  const { data: alert } = await supa
    .from('price_alerts')
    .select('*')
    .eq('id', alertId)
    .single();

  if (!alert) {
    return res.status(200).send(page(
      'Already unsubscribed',
      'This alert no longer exists. You will not receive any more emails for it.',
    ));
  }

  // Verify token
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const expected = makeToken(alertId, alert.email, secret);
    if (token !== expected) {
      return res.status(400).send(page(
        'Invalid link',
        'This unsubscribe link is not valid. Please use the original link from your email.',
        '#c0392b',
      ));
    }
  }

  await supa.from('price_alerts').update({ active: false }).eq('id', alertId);

  res.status(200).send(page(
    'You\'ve been unsubscribed',
    `We'll no longer send price alerts for <strong>${alert.destination}</strong> to <strong>${alert.email}</strong>. You can re-enable this alert any time by signing in to Via.`,
  ));
}
