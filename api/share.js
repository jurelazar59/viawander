// Stores and retrieves shared itinerary payloads in Supabase.
// POST { payload } → { id }   (short share ID, used as ?s=<id> in the URL)
// GET  ?id=<id>   → { payload }
//
// Supabase table required (run once in Supabase SQL editor):
//   create table if not exists shared_trips (
//     id         uuid primary key default gen_random_uuid(),
//     payload    jsonb not null,
//     created_at timestamptz default now()
//   );
//   alter table shared_trips enable row level security;
//   create policy "public read" on shared_trips for select using (true);
//   create policy "service insert" on shared_trips for insert with check (true);

import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const supa = getSupabase();
  if (!supa) return res.status(500).json({ error: 'Supabase not configured' });

  // ── GET: retrieve payload by id ──────────────────────────────────────────────
  if (req.method === 'GET') {
    const id = new URL(req.url, 'https://x').searchParams.get('id');
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const { data, error } = await supa
      .from('shared_trips')
      .select('payload')
      .eq('id', id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({ payload: data.payload });
  }

  // ── POST: store payload, return id ───────────────────────────────────────────
  if (req.method === 'POST') {
    const { payload } = req.body || {};
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Missing payload' });
    }
    // Sanity-check size: reject payloads > 256 KB
    const payloadStr = JSON.stringify(payload);
    if (payloadStr.length > 256 * 1024) {
      return res.status(413).json({ error: 'Payload too large' });
    }
    const { data, error } = await supa
      .from('shared_trips')
      .insert({ payload })
      .select('id')
      .single();
    if (error || !data) {
      console.error('[via] share insert error:', error);
      return res.status(500).json({ error: 'Could not store share' });
    }
    return res.status(200).json({ id: data.id });
  }

  res.status(405).end('Method Not Allowed');
}
