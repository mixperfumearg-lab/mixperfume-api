// api/subscribe-capture.js

function setCORS(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function normalizePhone(arPhone) {
  // Si viene 1123... lo pasamos a +54 11...
  const digits = String(arPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('54')) return `+${digits}`;
  if (digits.length >= 10) return `+54${digits}`;
  return `+${digits}`; // último recurso
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowList = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const isAllowed = allowList.length === 0 || allowList.includes(origin);

  setCORS(res, isAllowed ? origin : (allowList[0] || '*'));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAllowed) return res.status(403).json({ error: 'Forbidden origin (CORS)' });

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const {
    email, firstName, lastName, phone,
    address1, address2, city, province, zip,
    country = 'AR',
    plan, categoria, price
  } = req.body || {};

  if (!email || !firstName || !lastName || !phone || !address1 || !city || !province || !zip) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const safePhone = normalizePhone(phone);

  // Etiquetas para localizar fácil en Shopify
  const tags = [
    'Suscripción MixPerfume',
    plan ? `Plan: ${plan}` : null,
    categoria ? `Cat: ${categoria}` : null
  ].filter(Boolean);

  const note = `Alta suscripción desde web — Plan: ${plan || '-'} | Cat: ${categoria || '-'} | Precio: ${price || '-'} | ${new Date().toLocaleString('es-AR')}`;

  // Usamos stable: 2024-07 (mejor compatibilidad)
  const mutation = `
    mutation upsertCustomer($input: CustomerInput!) {
      customerUpsert(customer: $input) {
        customer { id email firstName lastName }
        userErrors { field message }
      }
    }
  `;

  const input = {
    email,
    firstName,
    lastName,
    phone: safePhone,
    addresses: [{
      address1,
      address2,
      city,
      province,
      zip,
      country,
      phone: safePhone
    }],
    tags,
    note
  };

  try {
    const resp = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN
      },
      body: JSON.stringify({ query: mutation, variables: { input } })
    });

    const json = await resp.json();
    const upsert = json?.data?.customerUpsert;
    const userErrors = upsert?.userErrors;

    if (userErrors?.length) {
      // Devolvemos los errores de Shopify para verlos en el front
      return res.status(400).json({ error: userErrors });
    }

    const customer = upsert?.customer || null;
    if (!customer?.id) {
      return res.status(500).json({ error: 'Sin respuesta de cliente', raw: json });
    }

    // OK: devolvemos los datos clave para confirmar en el front
    return res.status(200).json({
      ok: true,
      customer
    });
  } catch (e) {
    return res.status(500).json({ error: 'Shopify request failed', detail: String(e) });
  }
}
