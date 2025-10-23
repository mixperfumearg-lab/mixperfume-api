// api/subscribe-capture.js  — REST + mapeo de provincias AR + errores detallados

function setCORS(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function normalizePhone(arPhone) {
  const digits = String(arPhone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("54")) return `+${digits}`;
  if (digits.length >= 10) return `+54${digits}`;
  return `+${digits}`;
}

// Provincias AR aceptadas por Shopify (nombre + province_code)
const AR_PROVINCES = [
  { code: "C", name: "Ciudad Autónoma de Buenos Aires", aliases: ["caba","capital federal","ciudad autonoma de buenos aires","capital"] },
  { code: "B", name: "Buenos Aires", aliases: ["bs as","buenos aires"] },
  { code: "K", name: "Catamarca", aliases: ["catamarca"] },
  { code: "H", name: "Chaco", aliases: ["chaco"] },
  { code: "U", name: "Chubut", aliases: ["chubut"] },
  { code: "X", name: "Córdoba", aliases: ["cordoba","córdoba"] },
  { code: "W", name: "Corrientes", aliases: ["corrientes"] },
  { code: "E", name: "Entre Ríos", aliases: ["entre rios","entre ríos"] },
  { code: "P", name: "Formosa", aliases: ["formosa"] },
  { code: "Y", name: "Jujuy", aliases: ["jujuy"] },
  { code: "L", name: "La Pampa", aliases: ["la pampa"] },
  { code: "F", name: "La Rioja", aliases: ["la rioja"] },
  { code: "M", name: "Mendoza", aliases: ["mendoza"] },
  { code: "N", name: "Misiones", aliases: ["misiones"] },
  { code: "Q", name: "Neuquén", aliases: ["neuquen","neuquén"] },
  { code: "R", name: "Río Negro", aliases: ["rio negro","río negro"] },
  { code: "A", name: "Salta", aliases: ["salta"] },
  { code: "J", name: "San Juan", aliases: ["san juan"] },
  { code: "D", name: "San Luis", aliases: ["san luis"] },
  { code: "Z", name: "Santa Cruz", aliases: ["santa cruz"] },
  { code: "S", name: "Santa Fe", aliases: ["santa fe"] },
  { code: "G", name: "Santiago del Estero", aliases: ["santiago del estero"] },
  { code: "V", name: "Tierra del Fuego", aliases: ["tierra del fuego"] },
  { code: "T", name: "Tucumán", aliases: ["tucuman","tucumán"] },
];

// Devuelve { code, name } a partir de lo que escribió el usuario
function mapARProvince(input) {
  if (!input) return null;
  const s = String(input).toLowerCase().trim();
  for (const p of AR_PROVINCES) {
    if (p.aliases.includes(s) || p.name.toLowerCase() === s || p.code.toLowerCase() === s) {
      return { code: p.code, name: p.name };
    }
  }
  // fallback: si puso CABA, Capital, etc.
  if (/^(caba|capital( federal)?)$/.test(s)) {
    return { code: "C", name: "Ciudad Autónoma de Buenos Aires" };
  }
  return null; // dejemos que Shopify nos diga si no calza
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const allowList = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const isAllowed = allowList.length === 0 || allowList.includes(origin);

  setCORS(res, isAllowed ? origin : (allowList[0] || "*"));
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!isAllowed) return res.status(403).json({ error: "Forbidden origin (CORS)" });
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const {
    email, firstName, lastName, phone,
    address1, address2, city, province, zip,
    country = "AR",
    plan, categoria, price
  } = req.body || {};

  if (!email || !firstName || !lastName || !phone || !address1 || !city || !province || !zip) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }

  const safePhone = normalizePhone(phone);

  // mapeo de provincia
  let provName = province;
  let provCode = undefined;
  if ((country || "").toUpperCase() === "AR") {
    const m = mapARProvince(province);
    if (m) { provName = m.name; provCode = m.code; }
  }

  const customerPayload = {
    customer: {
      email,
      first_name: firstName,
      last_name: lastName,
      phone: safePhone,
      tags: [
        "Suscripción MixPerfume",
        plan ? `Plan: ${plan}` : null,
        categoria ? `Cat: ${categoria}` : null
      ].filter(Boolean).join(", "),
      note: `Alta suscripción desde web — Plan: ${plan || "-"} | Cat: ${categoria || "-"} | Precio: ${price || "-"} | ${new Date().toLocaleString("es-AR")}`,
      addresses: [{
        address1,
        address2,
        city,
        province: provName,
        province_code: provCode,  // ❤️ clave para AR
        zip,
        country,
        phone: safePhone,
        default: true
      }]
    }
  };

  const domain = process.env.SHOPIFY_STORE_DOMAIN; // z1aj11-0i.myshopify.com
  const token  = process.env.SHOPIFY_ADMIN_TOKEN;  // shpat_...

  async function shopify(path, init = {}) {
    const url = `https://${domain}/admin/api/2024-07${path}`;
    const resp = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
        ...(init.headers || {})
      }
    });
    const text = await resp.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { _parseError: text }; }
    return { status: resp.status, json, raw: text };
  }

  // 1) Intentar CREAR
  const create = await shopify("/customers.json", {
    method: "POST",
    body: JSON.stringify(customerPayload)
  });

  if (create.status === 201 && create.json?.customer?.id) {
    return res.status(200).json({ ok: true, action: "created", customer: create.json.customer });
  }

  // 2) Si ya existe por email → BUSCAR + ACTUALIZAR
  const looksTaken = create.status === 422 && JSON.stringify(create.json || {}).toLowerCase().includes("email");
  if (looksTaken) {
    const search = await shopify(`/customers/search.json?query=${encodeURIComponent(`email:${email}`)}`);
    const found  = Array.isArray(search.json?.customers) ? search.json.customers[0] : null;
    if (!found?.id) {
      return res.status(500).json({ error: "No se pudo localizar el cliente existente", detail: search });
    }

    const updatePayload = {
      customer: {
        id: found.id,
        first_name: firstName,
        last_name: lastName,
        phone: safePhone,
        note: customerPayload.customer.note,
        tags: Array.from(new Set(
          `${found.tags || ""}, ${customerPayload.customer.tags}`.split(",")
            .map(t => t.trim()).filter(Boolean)
        )).join(", "),
        addresses: [{
          address1, address2, city,
          province: provName,
          province_code: provCode,
          zip, country, phone: safePhone, default: true
        }]
      }
    };

    const update = await shopify(`/customers/${found.id}.json`, {
      method: "PUT",
      body: JSON.stringify(updatePayload)
    });

    if ((update.status === 200 || update.status === 201) && update.json?.customer?.id) {
      return res.status(200).json({ ok: true, action: "updated", customer: update.json.customer });
    }

    return res.status(500).json({
      error: "Fallo al actualizar el cliente",
      request: updatePayload,
      response: update
    });
  }

  // 3) Otro error: devolvemos el detalle completo que mandó Shopify
  return res.status(500).json({
    error: "No se pudo crear el cliente",
    request: customerPayload,
    response: create
  });
}
