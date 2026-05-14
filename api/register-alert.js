// Persists price alert mutations (create / update / delete) to Supabase.
//
// POST body shapes:
//   { action: 'create',  alert: { id, email, destination, … } }
//   { action: 'update',  alert: { id, active: true|false }   }
//   { action: 'delete',  alert: { id }                       }

import { createHmac }  from 'crypto';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY; // service role key — server-side only
  if (!url || !key) return null;
  return createClient(url, key);
}

function makeUnsubToken(alertId, email) {
  const secret = process.env.CRON_SECRET || 'via-unsub-fallback';
  return createHmac('sha256', secret)
    .update(`${alertId}:${email}`)
    .digest('hex')
    .slice(0, 40);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { action, alert } = req.body || {};
  if (!action) return res.status(400).end('Missing action');

  const supa = getSupabase();
  if (!supa) {
    return res.status(200).json({ ok: true, note: 'Supabase not configured' });
  }

  try {
    if (action === 'create') {
      if (!alert?.id) return res.status(400).end('Missing alert.id');
      const row = {
        id:              alert.id,
        email:           alert.email,
        destination:     alert.destination,
        date_from:       alert.dateFrom   || null,
        date_to:         alert.dateTo     || null,
        tier:            alert.tier       || 'mid',
        types:           alert.types      || ['accommodation'],
        threshold:       alert.threshold  || '10',
        active:          true,
        baseline_prices: alert.baselinePrices || null,
        unsub_token:     makeUnsubToken(alert.id, alert.email),
        created_at:      alert.createdAt  || new Date().toISOString(),
      };
      const { error } = await supa.from('price_alerts').upsert(row);
      if (error) throw error;

    } else if (action === 'update') {
      if (!alert?.id) return res.status(400).end('Missing alert.id');
      const { error } = await supa
        .from('price_alerts')
        .update({ active: alert.active })
        .eq('id', alert.id);
      if (error) throw error;

    } else if (action === 'delete') {
      if (!alert?.id) return res.status(400).end('Missing alert.id');
      const { error } = await supa.from('price_alerts').delete().eq('id', alert.id);
      if (error) throw error;

    } else {
      return res.status(400).end('Unknown action');
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[via] register-alert error:', err.message);
    res.status(200).json({ ok: false, error: err.message });
  }
}
