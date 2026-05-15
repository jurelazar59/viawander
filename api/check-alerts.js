// Daily cron job that checks stored price alerts and emails users when prices move.
//
// Triggered by Vercel Cron (see vercel.json: "0 8 * * *" — 08:00 UTC every day).
// Can also be hit manually via GET /api/check-alerts?secret=CRON_SECRET for testing.

import { createClient } from '@supabase/supabase-js';

const CLAUDE_URL  = 'https://api.anthropic.com/v1/messages';
const RESEND_URL  = 'https://api.resend.com/emails';
const CHECK_HOURS = 20;
const NOTIFY_DAYS = 7;

// ── Structured logger — output is JSON so Vercel log drain can filter by event ──
function log(level, event, data = {}) {
  const entry = { ts: new Date().toISOString(), level, event, ...data };
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](JSON.stringify(entry));
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// ── Price assessment via Claude ───────────────────────────────────────────────
async function assessPrices(alert, apiKey, now) {
  const baseline     = alert.baseline_prices || {};
  const baselineText = Object.entries(baseline)
    .map(([k, v]) => `${k}: ${v.name || '?'} at ${v.price || '?'}`)
    .join('; ') || 'not available';

  const daysUntil  = alert.date_from
    ? Math.round((new Date(alert.date_from) - now) / 86_400_000)
    : null;
  const createdAgo = Math.round((now - new Date(alert.created_at)) / 86_400_000);

  const prompt = `You are a travel price intelligence assistant.
Destination: ${alert.destination}
Travel dates: ${alert.date_from || 'flexible'} → ${alert.date_to || 'flexible'}
Days until travel: ${daysUntil !== null ? daysUntil : 'unknown'}
Budget tier: ${alert.tier || 'mid'}
Tracking: ${(alert.types || ['accommodation']).join(' + ')}
Alert created: ${createdAgo} days ago
Baseline prices when alert was set: ${baselineText}

Using your knowledge of seasonal demand, booking curves, and typical price patterns for this destination:
— Have accommodation prices likely risen, fallen, or stayed similar over the past ${createdAgo} days?
— Have flight prices likely risen, fallen, or stayed similar?
— Is there any notable shift a traveller should act on?

Return ONLY valid JSON (no markdown, no explanation):
{"accommodation_change_pct":0,"flights_change_pct":0,"notable_change":false,"summary":"One sentence a traveller can act on.","confidence":"low|medium|high"}

Rules: negative = cheaper, positive = more expensive. Set notable_change:true only for genuine shifts >5%. Be conservative.`;

  const r = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5',
      max_tokens:  256,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const d     = await r.json();
  const raw   = ((d.content || []).map(b => b.text || '').join('')).trim();
  const clean = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    log('error', 'assess_prices_parse_failed', { alertId: alert.id, raw: clean.slice(0, 200) });
    // Return a safe no-op assessment rather than crashing the whole cron run
    return { notable_change: false, accommodation_change_pct: 0, flights_change_pct: 0, summary: 'Unable to assess prices at this time.', confidence: 'low' };
  }
}

// ── Threshold check ───────────────────────────────────────────────────────────
function meetsThreshold(assessment, threshold) {
  if (!assessment.notable_change) return false;
  if (threshold === 'any') return true;
  const drop = -Math.min(
    assessment.accommodation_change_pct || 0,
    assessment.flights_change_pct       || 0,
    0,
  );
  return drop >= parseInt(threshold, 10);
}

// ── Email ─────────────────────────────────────────────────────────────────────
async function sendAlertEmail(alert, assessment, resendKey) {
  const accomPct  = assessment.accommodation_change_pct || 0;
  const flightPct = assessment.flights_change_pct       || 0;
  const direction = Math.min(accomPct, flightPct) < 0 ? 'dropped' : 'changed';
  const subject   = `Price alert: ${alert.destination} prices have ${direction} — Via`;

  const dateRange = (alert.date_from && alert.date_to)
    ? `${fmt(alert.date_from)} – ${fmt(alert.date_to)}`
    : alert.date_from ? `From ${fmt(alert.date_from)}` : '';

  function pctBadge(pct) {
    if (Math.abs(pct) < 1) return '<span style="color:#6b7280">No change</span>';
    const color  = pct < 0 ? '#2a7a4b' : '#c0392b';
    const prefix = pct < 0 ? '↓ ' : '↑ ';
    return `<span style="color:${color};font-weight:700">${prefix}${Math.round(Math.abs(pct))}%</span>`;
  }

  const trackingAccom   = (alert.types || []).includes('accommodation');
  const trackingFlights = (alert.types || []).includes('flights');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F2EBD9;font-family:'Georgia',serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2EBD9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <tr>
    <td style="background:#1C1510;padding:28px 36px;border-radius:4px 4px 0 0">
      <div style="font-family:'Georgia',serif;font-size:28px;font-weight:900;color:#F2EBD9;letter-spacing:-.04em">via.</div>
      <div style="font-size:11px;color:rgba(242,235,217,.5);letter-spacing:.15em;text-transform:uppercase;margin-top:4px">Price alert</div>
    </td>
  </tr>

  <tr>
    <td style="background:#6B2737;padding:24px 36px">
      <div style="font-size:11px;color:rgba(242,235,217,.65);letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px">Price movement detected</div>
      <div style="font-family:'Georgia',serif;font-size:24px;font-weight:700;color:#FAF6EE;line-height:1.25;margin-bottom:8px">${alert.destination}</div>
      ${dateRange ? `<div style="font-size:12px;color:rgba(242,235,217,.75)">${dateRange}</div>` : ''}
    </td>
  </tr>

  <tr>
    <td style="background:#FAF6EE;padding:28px 36px">
      <p style="font-size:15px;color:#1C1510;line-height:1.7;margin:0 0 24px">${assessment.summary}</p>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px">
        ${trackingAccom ? `
        <tr style="border-bottom:1px solid #E8DEC8">
          <td style="padding:12px 0;font-size:13px;color:#3D3228">Hotels</td>
          <td style="padding:12px 0;text-align:right;font-size:14px">${pctBadge(accomPct)}</td>
        </tr>` : ''}
        ${trackingFlights ? `
        <tr style="border-bottom:1px solid #E8DEC8">
          <td style="padding:12px 0;font-size:13px;color:#3D3228">Flights</td>
          <td style="padding:12px 0;text-align:right;font-size:14px">${pctBadge(flightPct)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:12px 0;font-size:11px;color:#9ca3af;font-style:italic" colspan="2">AI price intelligence — based on seasonal patterns, booking curves, and destination demand. Not sourced from live booking APIs.</td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px">
        <tr><td>
          <a href="https://viawander.co" style="display:inline-block;background:#1C1510;color:#FAF6EE;font-family:Georgia,serif;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:14px 28px;border-radius:2px;text-decoration:none;box-shadow:3px 3px 0 #6B2737">Check prices now →</a>
        </td></tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="background:#1C1510;padding:20px 36px;border-radius:0 0 4px 4px">
      <div style="font-size:11px;color:rgba(242,235,217,.4);line-height:1.7">
        You set this alert on viawander.co for <strong style="color:rgba(242,235,217,.6)">${alert.destination}</strong>.<br>
        Alerts run once daily. Maximum one email per week per alert.<br>
        <a href="https://viawander.co/api/unsubscribe-alert?id=${alert.id}&token=${alert.unsub_token || ''}" style="color:rgba(242,235,217,.4);text-decoration:underline">Unsubscribe from this alert</a>
      </div>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const emailRes = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from:    'Via Travel <hello@viawander.co>',
      to:      [alert.email],
      subject,
      html,
    }),
  });

  if (!emailRes.ok) {
    const errBody = await emailRes.json().catch(() => ({}));
    // Throw so the caller can skip marking last_notified and retry tomorrow
    throw new Error(`Resend ${emailRes.status}: ${errBody.message || JSON.stringify(errBody)}`);
  }
}

function fmt(iso) {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const headerSecret = (req.headers.authorization || '').replace('Bearer ', '');
    const urlSecret    = new URL(req.url, 'https://x').searchParams.get('secret');
    if (headerSecret !== cronSecret && urlSecret !== cronSecret) {
      return res.status(401).end('Unauthorized');
    }
  }

  const apiKey    = process.env.ANTHROPIC_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const supa      = getSupabase();

  if (!apiKey)  return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  if (!supa)    return res.status(200).json({ skipped: true, reason: 'Supabase not configured' });

  const now = new Date();
  const cutoff = new Date(now - CHECK_HOURS * 3_600_000).toISOString();

  // Fetch alerts due for a check
  const { data: alerts, error } = await supa
    .from('price_alerts')
    .select('*')
    .eq('active', true)
    .or(`last_checked.is.null,last_checked.lt.${cutoff}`);

  if (error) return res.status(500).json({ error: error.message });
  if (!alerts?.length) return res.status(200).json({ checked: 0, message: 'No alerts due' });

  const results = [];

  for (const alert of alerts) {
    try {
      const assessment = await assessPrices(alert, apiKey, now);

      const notifiedRecently = alert.last_notified &&
        (now - new Date(alert.last_notified)) / 86_400_000 < NOTIFY_DAYS;

      const shouldNotify =
        meetsThreshold(assessment, alert.threshold || '10') &&
        !notifiedRecently &&
        !!resendKey;

      const updates = { last_checked: now.toISOString() };
      if (shouldNotify) {
        await sendAlertEmail(alert, assessment, resendKey);
        updates.last_notified = now.toISOString();
      }

      await supa.from('price_alerts').update(updates).eq('id', alert.id);
      results.push({ id: alert.id, dest: alert.destination, shouldNotify, assessment });

    } catch (err) {
      log('error', 'check_alert_failed', { alertId: alert.id, dest: alert.destination, error: err.message });
      results.push({ id: alert.id, error: err.message });
    }
  }

  res.status(200).json({ checked: alerts.length, results });
}
