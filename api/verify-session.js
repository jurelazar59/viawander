// Verifies a Stripe Checkout Session after the user returns from the payment page.
// Returns { valid: true, email } on confirmed payment, { valid: false } otherwise.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).end('Missing sessionId');

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return res.status(500).end('Stripe not configured');

  const r = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  );

  const session = await r.json();

  if (!r.ok) {
    console.error('[via] Stripe verify error:', session.error);
    return res.status(200).json({ valid: false });
  }

  // Only grant Plus when Stripe confirms payment
  if (session.payment_status !== 'paid') {
    return res.status(200).json({ valid: false });
  }

  const email = session.customer_email
    || session.customer_details?.email
    || session.metadata?.email
    || null;

  res.status(200).json({ valid: true, email });
}
