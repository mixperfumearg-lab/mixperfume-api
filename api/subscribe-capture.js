// api/subscribe-capture.js
function setCORS(res, origin) {
  // Devolvemos CORS correctos y variamos por origen
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowList = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Si no configuraste ALLOWED_ORIGINS, permitimos todo (útil para debug)
  const isAllowed = allowList.length === 0 || allowList.includes(origin);
  setCORS(res, isAllowed ? origin : (allowList[0] || '*'));

  // Preflight CORS
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!isAllowed) {
    return res.status(403).json({ error: 'Forbidden origin (CORS)' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // ---- Validación de campos
  const {
    email, firstName, lastName, phone,
    address1, address2, city, province, zip, country = 'AR'
  } = req.body || {};

  if (!email || !firstName || !lastName || !phone || !address1 || !city || !province || !zip) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  // ---- Mutación Shopify
  const mutation = `
    mutation upsertCustomer($input: CustomerInput!) {
      customerUpsert(customer: $input) {
        customer { id email }
        userErrors { field message }
      }
    }
  `;

  const input = {
    email,
    firstName,
    lastName,
    phone,
    addresses: [{
      address1,
      address2,
      city,
      province,
      zip,
      country,
      phone
    }],
    tags: ["Suscripción MixPerfume"]
  };

  try {
    const resp = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN
      },
      body: JSON.stringify({ query: mutation, variables: { input } })
    });

    const data = await resp.json();
    const errs = data?.data?.customerUpsert?.userErrors;
    if (errs?.length) {
      return res.status(400).json({ error: errs });
    }

    return res.status(200).json({ ok: true, customer: data?.data?.customerUpsert?.customer });
  } catch (e) {
    return res.status(500).json({ error: 'Shopify request failed', detail: String(e) });
  }
}
