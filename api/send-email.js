export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { email, name, dest, dateFrom, dateTo, lang, itinData } = req.body || {};
  if (!email || !itinData) return res.status(400).end('Missing fields');

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).end('Email not configured');

  const days = itinData.days || [];
  const title = itinData.title || `Your ${dest} Itinerary`;
  const cost  = itinData.estimated_daily_cost || '';

  const fmtDate = (s) => {
    if (!s) return '';
    return new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // Build day summaries for email
  const dayRows = days.map((d, i) => {
    const lunch    = d.meals?.lunch?.[d.budget_default || 'mid'] || d.meals?.lunch?.mid || {};
    const dinner   = d.meals?.dinner?.[d.budget_default || 'mid'] || d.meals?.dinner?.mid || {};
    const activity = d.activities?.[d.budget_default || 'mid'] || d.activities?.mid || {};
    return `
      <tr>
        <td style="padding:18px 0 10px;border-top:1px solid #E8DEC8">
          <div style="font-family:'Georgia',serif;font-size:13px;font-weight:700;color:#6B2737;letter-spacing:.05em;text-transform:uppercase;margin-bottom:4px">Day ${i + 1}</div>
          <div style="font-family:'Georgia',serif;font-size:18px;font-weight:700;color:#1C1510;margin-bottom:10px;line-height:1.3">${d.title || ''}</div>
          <div style="font-size:13px;color:#3D3228;line-height:1.6;margin-bottom:10px">${d.morning || ''}</div>
          ${lunch.name ? `<div style="background:#FAF6EE;border-left:3px solid #C4892A;padding:8px 12px;margin:8px 0;font-size:12px;color:#1C1510"><strong>Lunch:</strong> ${lunch.name}${lunch.price_pp ? ' · ' + lunch.price_pp : ''}</div>` : ''}
          <div style="font-size:13px;color:#3D3228;line-height:1.6;margin-bottom:10px">${d.afternoon || ''}</div>
          ${dinner.name ? `<div style="background:#FAF6EE;border-left:3px solid #C4892A;padding:8px 12px;margin:8px 0;font-size:12px;color:#1C1510"><strong>Dinner:</strong> ${dinner.name}${dinner.price_pp ? ' · ' + dinner.price_pp : ''}</div>` : ''}
          ${activity.name ? `<div style="background:#FAF6EE;border-left:3px solid #1E3D2F;padding:8px 12px;margin:8px 0;font-size:12px;color:#1C1510"><strong>Activity:</strong> ${activity.name}${activity.price ? ' · ' + activity.price : ''}</div>` : ''}
        </td>
      </tr>`;
  }).join('');

  const greetings = { sl:'Uživaj na potovanju', de:'Genieße deine Reise', it:'Buon viaggio', fr:'Bon voyage', hr:'Uživaj na putovanju', es:'¡Buen viaje', sr:'Srećan put' };
  const farewell = greetings[lang] || 'Enjoy your trip';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F2EBD9;font-family:'Georgia',serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2EBD9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- Header -->
  <tr>
    <td style="background:#1C1510;padding:28px 36px;border-radius:4px 4px 0 0">
      <div style="font-family:'Georgia',serif;font-size:28px;font-weight:900;color:#F2EBD9;letter-spacing:-.04em">via.</div>
      <div style="font-size:11px;color:rgba(242,235,217,.5);letter-spacing:.15em;text-transform:uppercase;margin-top:4px">Travel planned like a friend did it</div>
    </td>
  </tr>

  <!-- Hero band -->
  <tr>
    <td style="background:#6B2737;padding:24px 36px">
      <div style="font-size:11px;color:rgba(242,235,217,.65);letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px">Your itinerary is ready</div>
      <div style="font-family:'Georgia',serif;font-size:26px;font-weight:700;color:#FAF6EE;line-height:1.25;margin-bottom:10px">${title}</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        ${dest ? `<span style="font-size:12px;color:rgba(242,235,217,.8);background:rgba(242,235,217,.1);padding:4px 10px;border-radius:2px">${dest}</span>` : ''}
        ${dateFrom ? `<span style="font-size:12px;color:rgba(242,235,217,.8);background:rgba(242,235,217,.1);padding:4px 10px;border-radius:2px">${fmtDate(dateFrom)}${dateTo ? ' → ' + fmtDate(dateTo) : ''}</span>` : ''}
        ${cost ? `<span style="font-size:12px;color:rgba(242,235,217,.8);background:rgba(242,235,217,.1);padding:4px 10px;border-radius:2px">Est. ${cost}/day</span>` : ''}
      </div>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="background:#FAF6EE;padding:28px 36px">
      <p style="font-size:15px;color:#1C1510;line-height:1.7;margin:0 0 20px">Hi ${name},</p>
      <p style="font-size:15px;color:#3D3228;line-height:1.7;margin:0 0 28px">Your personalised itinerary for <strong>${dest || 'your trip'}</strong> is ready. Here's a summary of each day — open Via on your phone or laptop to see the full plan with restaurants, hotels, swaps, and booking links.</p>

      <table width="100%" cellpadding="0" cellspacing="0">
        ${dayRows}
      </table>

      <!-- CTA -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px">
        <tr>
          <td>
            <a href="https://viawander.co" style="display:inline-block;background:#1C1510;color:#FAF6EE;font-family:Georgia,serif;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:14px 28px;border-radius:2px;text-decoration:none;box-shadow:3px 3px 0 #6B2737">Open full itinerary →</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#1C1510;padding:24px 36px;border-radius:0 0 4px 4px">
      <div style="font-family:'Georgia',serif;font-size:22px;font-weight:700;color:#C4892A;margin-bottom:8px;font-style:italic">${farewell}. ✦</div>
      <div style="font-size:11px;color:rgba(242,235,217,.4);line-height:1.6">You received this because you generated an itinerary on viawander.co.<br>No account needed — just come back whenever you're ready to plan.</div>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: 'Via Travel <hello@viawander.co>',
      to: [email],
      subject: `Your ${dest || 'trip'} itinerary — Via`,
      html,
    }),
  });

  const result = await r.json();
  res.status(r.ok ? 200 : 500).json(result);
}
