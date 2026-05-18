// Dry-Run für Shopify-Upload: fängt alle fetch-Calls ab und validiert
// gegen die Anforderungen aus den Kunden-Screenshots.
// Aufruf: node test/shopify-dryrun.js

import { createShopifyDraft } from '../src/shopify.js';

const calls = [];

globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method || 'GET';
  const body   = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ method, url, body });

  // Mock-Responses je nach Endpoint
  if (url.includes('/products.json') && method === 'POST') {
    return mockRes({ product: { id: 12345, variants: [{ inventory_item_id: 67890 }] } });
  }
  if (url.includes('/locations.json')) {
    return mockRes({ locations: [
      { id: 111, name: 'Veyroze UG' },
      { id: 222, name: 'Lager Bamberg' },
    ]});
  }
  if (url.includes('/inventory_levels/set.json')) return mockRes({ inventory_level: {} });
  if (url.includes('/inventory_items/')) return mockRes({ inventory_item: {} });
  if (url.includes('/custom_collections.json')) {
    return mockRes({ custom_collections: [
      { id: 1001, title: 'Jeans' },
      { id: 1002, title: 'W30' },
      { id: 1003, title: 'W31' },
    ]});
  }
  if (url.includes('/collects.json')) return mockRes({ collect: { id: 999 } });
  if (url.includes('/images.json')) return mockRes({ image: { id: 888 } });
  return mockRes({});
};

function mockRes(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const productDiff = {
  titel_vorschlag:    "Levi's bootcut Jeans (W30/L34)",
  beschreibung:       "Levi's 512\n\nSize: W30/L34 👖\n\nDetails: cool denim wash 🔎\nCondition: top 🧼\nFit: bootcut\n\nMeasurements📏:\nLength: 105cm\nWaist: 42cm\nLeg opening: 20cm",
  marke:              "Levi's",
  modell:             "512",
  size_corrected:     "W30/L34",
  condition:          9,
  taxable:            false,
  tags:               ['KI', 'diff', 'W30'],
  sku:                "48010",
  suggested_price:    0,
  collections:        ['Jeans', 'W30'],
  shipping_weight_kg: 0.8,
  country_of_origin:  'Pakistan',
  hs_code:            '6309000',
};

const productPlug = {
  ...productDiff,
  titel_vorschlag: "Levi's slim Jeans (W31/L32)",
  marke:           "Levi's",
  modell:          "511",
  size_corrected:  "W31/L32",
  taxable:         true,
  tags:            ['KI', 'PLUG', 'W31'],
  sku:             "48011",
  collections:     ['Jeans', 'W31'],
};

function check(label, condition, actual) {
  const mark = condition ? '✅' : '❌';
  const val  = actual !== undefined ? `  (= ${JSON.stringify(actual)})` : '';
  console.log(`  ${mark} ${label}${val}`);
  return condition;
}

function findCall(method, urlContains) {
  return calls.find(c => c.method === method && c.url.includes(urlContains));
}

async function runScenario(name, productData) {
  calls.length = 0;
  console.log(`\n${'═'.repeat(70)}\nSZENARIO: ${name}\n${'═'.repeat(70)}`);

  await createShopifyDraft(productData, [], 'test.myshopify.com', 'fake-token');

  console.log(`\n─── HTTP-CALLS (${calls.length}) ───`);
  calls.forEach((c, i) => {
    console.log(`\n[${i + 1}] ${c.method} ${c.url.replace('https://test.myshopify.com/admin/api/2025-04/', '')}`);
    if (c.body) console.log(JSON.stringify(c.body, null, 2).split('\n').map(l => '    ' + l).join('\n'));
  });

  console.log(`\n─── CHECKLISTE ───`);
  const productCall = findCall('POST', '/products.json');
  const p = productCall?.body?.product;
  const v = p?.variants?.[0];

  check('Produktstatus: draft',       p?.status === 'draft', p?.status);
  check('Anbieter: veyroze',          p?.vendor === 'veyroze', p?.vendor);
  check('Product Type: Jeans',        p?.product_type === 'Jeans', p?.product_type);
  check('Titel enthält (W../L..)',    /\(W\d+\/L\d+\)/.test(p?.title || ''), p?.title);
  check('Beschreibung mit 👖',        (p?.body_html || '').includes('👖'));
  check('Beschreibung mit 🔎',        (p?.body_html || '').includes('🔎'));
  check('Beschreibung mit 🧼',        (p?.body_html || '').includes('🧼'));
  check('Beschreibung mit 📏',        (p?.body_html || '').includes('📏'));
  check('Beschreibung hat Length:',   (p?.body_html || '').includes('Length:'));
  check('Beschreibung hat Waist:',    (p?.body_html || '').includes('Waist:'));
  check('Beschreibung hat Leg opening:', (p?.body_html || '').includes('Leg opening:'));
  check('Tags enthält KI',            (p?.tags || '').includes('KI'));
  check('Tags enthält ' + (productData.taxable ? 'PLUG' : 'diff'),
                                      (p?.tags || '').includes(productData.taxable ? 'PLUG' : 'diff'));
  check('SKU gesetzt',                Boolean(v?.sku), v?.sku);
  check('inventory_management: shopify', v?.inventory_management === 'shopify', v?.inventory_management);
  check('inventory_policy: deny',     v?.inventory_policy === 'deny', v?.inventory_policy);
  check('taxable korrekt (' + productData.taxable + ')', v?.taxable === productData.taxable, v?.taxable);
  check('weight: 0.8',                v?.weight === 0.8, v?.weight);
  check('weight_unit: kg',            v?.weight_unit === 'kg', v?.weight_unit);
  check('option1 = Größe',            v?.option1 === productData.size_corrected, v?.option1);

  const invLevel = findCall('POST', '/inventory_levels/set.json');
  check('Inventory Level: Veyroze UG = 1',
        invLevel?.body?.location_id === 111 && invLevel?.body?.available === 1,
        invLevel?.body);

  const invItem = findCall('PUT', '/inventory_items/');
  check('Country Code: PK',           invItem?.body?.inventory_item?.country_code_of_origin === 'PK',
                                      invItem?.body?.inventory_item?.country_code_of_origin);
  check('HS-Code: 6309000',           invItem?.body?.inventory_item?.harmonized_system_code === '6309000',
                                      invItem?.body?.inventory_item?.harmonized_system_code);

  const collectCalls = calls.filter(c => c.url.includes('/collects.json') && c.method === 'POST');
  check('Collection "Jeans" gesetzt', collectCalls.some(c => c.body?.collect?.collection_id === 1001));
  check('Collection W-Size gesetzt',  collectCalls.some(c =>
        c.body?.collect?.collection_id === (productData.taxable ? 1003 : 1002)));

  console.log(`\n─── OFFENE PUNKTE (nicht implementiert) ───`);
  console.log(`  ⚠️  Kategorie-Metafeld "Größe" (Shopify-Taxonomie) — benötigt Live-Shop`);
}

console.log('\n🧪 Shopify Dry-Run Test\n');
await runScenario('Diff-Produkt (Levi\'s 512 W30/L34)', productDiff);
await runScenario('Plug-Produkt (Levi\'s 511 W31/L32)', productPlug);
console.log(`\n${'═'.repeat(70)}\nFertig — alle Calls oben sind exakt das, was an Shopify geschickt würde.\n${'═'.repeat(70)}\n`);
