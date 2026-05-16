// Creates a Stripe Checkout Session for the Via Plus one-time payment (€9).
// Returns { url } — the frontend redirects the browser there.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { email, name } = req.body || {};
  if (!email) return res.status(400).end('Missing email');

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return res.status(500).end('Stripe not configured');

  // Derive the site origin for success/cancel redirect URLs.
  // In production Vercel sets x-forwarded-host; locally origin header is available.
  const host   = req.headers['x-forwarded-host'] || req.headers.host || 'viawander.co';
  const scheme = host.startsWith('localhost') ? 'http' : 'https';
  const origin = `${scheme}://${host}`;

  // Build the form-encoded body that Stripe's v1 REST API expects
  const params = new URLSearchParams();
  params.append('mode',                                              'payment');
  params.append('payment_method_types[]',                           'card');
  params.append('customer_email',                                    email);
  params.append('line_items[0][price_data][currency]',              'eur');
  params.append('line_items[0][price_data][unit_amount]',           '900');   // €9.00
  params.append('line_items[0][price_data][product_data][name]',   'Via Plus');
  params.append('line_items[0][price_data][product_data][description]',
    'Unlimited saves · PDF export · Priority generation — pay once, keep forever.');
  params.append('line_items[0][quantity]',                          '1');
  params.append('success_url',
    `${origin}/?upgrade=success&session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url',  `${origin}/?upgrade=cancelled`);
  params.append('metadata[email]', email);
  params.append('metadata[name]',  name || '');

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method:  'POST',
    headers: {
      'Authorization':  `Bearer ${secretKey}`,
      'Content-Type':   'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await r.json();

  if (!r.ok) {
    console.error('[via] Stripe checkout error:', data.error);
    return res.status(500).json({ error: data.error?.message || 'Stripe error' });
  }

  res.status(200).json({ url: data.url });
}
