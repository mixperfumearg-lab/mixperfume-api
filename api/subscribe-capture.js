export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const {
    email, firstName, lastName, phone,
    address1, address2, city, province, zip, country = 'AR'
  } = req.body || {};

  if (!email || !firstName || !lastName || !phone || !address1 || !city || !province || !zip) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const mutation = `
    mutation upsertCustomer($input: CustomerInput!) {
      customerUpsert(customer: $input) {
        customer { id email firstName lastName }
        userErrors { field message }
      }
    }
  `;

  const input = {
    email, firstName, lastName, phone,
    addresses: [{ address1, address2, city, province, zip, country, phone }],
    tags: ["Suscripción MixPerfume"]
  };

  const response = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN
    },
    body: JSON.stringify({ query: mutation, variables: { input } })
  });

  const data = await response.json();
  const errors = data?.data?.customerUpsert?.userErrors;
  if (errors?.length) return res.status(400).json({ error: errors });

  return res.status(200).json({ ok: true, customer: data?.data?.customerUpsert?.customer });
}
