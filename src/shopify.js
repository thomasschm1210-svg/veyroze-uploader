import fs from 'fs';
import path from 'path';

const COUNTRY_ISO = {
  'Pakistan': 'PK', 'China': 'CN', 'Bangladesch': 'BD', 'Indien': 'IN',
  'Mexiko': 'MX', 'Türkei': 'TR', 'Vietnam': 'VN', 'Indonesien': 'ID',
  'Thailand': 'TH', 'Malaysia': 'MY', 'Kambodscha': 'KH', 'Myanmar': 'MM',
  'Sri Lanka': 'LK', 'Philippinen': 'PH', 'Südkorea': 'KR', 'Japan': 'JP',
  'Taiwan': 'TW', 'USA': 'US', 'Deutschland': 'DE', 'Frankreich': 'FR',
  'Italien': 'IT', 'Spanien': 'ES', 'Portugal': 'PT', 'Polen': 'PL',
  'Rumänien': 'RO', 'Bulgarien': 'BG', 'Kroatien': 'HR', 'Ungarn': 'HU',
  'Tschechien': 'CZ', 'Serbien': 'RS', 'Ukraine': 'UA', 'Marokko': 'MA',
  'Ägypten': 'EG', 'Tunesien': 'TN', 'Äthiopien': 'ET', 'Kenia': 'KE',
  'Nigeria': 'NG', 'Madagaskar': 'MG', 'Jordanien': 'JO', 'Syrien': 'SY',
  'Iran': 'IR', 'Peru': 'PE', 'Kolumbien': 'CO', 'Brasilien': 'BR',
  'Bolivien': 'BO',
};

function toIsoCode(germanName) {
  return COUNTRY_ISO[germanName] ?? null;
}

async function shopifyRequest(shop, token, method, endpoint, body = null) {
  const url = `https://${shop}/admin/api/2025-04/${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Shopify API ${res.status}: ${err}`);
  }
  return res.json();
}

async function uploadProductImage(shop, token, productId, imagePath, position) {
  const base64 = fs.readFileSync(imagePath).toString('base64');
  const filename = path.basename(imagePath);
  const image = { attachment: base64, filename };
  if (Number.isInteger(position) && position > 0) image.position = position;
  const data = await shopifyRequest(shop, token, 'POST', `products/${productId}/images.json`, { image });
  return data.image;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

let locationsCache = null;
let locationsCacheAt = 0;

async function getLocationId(shop, token, name) {
  if (!locationsCache || Date.now() - locationsCacheAt > CACHE_TTL_MS) {
    const data = await shopifyRequest(shop, token, 'GET', 'locations.json');
    locationsCache   = data.locations || [];
    locationsCacheAt = Date.now();
  }
  return locationsCache.find(l => l.name === name)?.id ?? null;
}

let collectionsCache = null;
let collectionsCacheAt = 0;

async function getCollections(shop, token) {
  if (collectionsCache && Date.now() - collectionsCacheAt < CACHE_TTL_MS) {
    return collectionsCache;
  }
  // Shop hat sowohl Custom- (manuell) als auch Smart-Collections (regelbasiert)
  const [custom, smart] = await Promise.all([
    shopifyRequest(shop, token, 'GET', 'custom_collections.json?limit=250').catch(() => ({ custom_collections: [] })),
    shopifyRequest(shop, token, 'GET', 'smart_collections.json?limit=250').catch(() => ({ smart_collections: [] })),
  ]);
  const customs = (custom.custom_collections || []).map(c => ({ ...c, __smart: false }));
  const smarts  = (smart.smart_collections  || []).map(c => ({ ...c, __smart: true  }));
  collectionsCache   = [...customs, ...smarts];
  collectionsCacheAt = Date.now();
  return collectionsCache;
}

async function addToCollections(shop, token, productId, collectionNames, warnings = []) {
  if (!collectionNames?.length) return;
  let allCollections;
  try {
    allCollections = await getCollections(shop, token);
  } catch (e) {
    warnings.push(`Kollektionen nicht abrufbar: ${e.message}`);
    return;
  }
  await Promise.all(collectionNames.map(async (name) => {
    const col = allCollections.find(c => c.title === name);
    if (!col) { warnings.push(`Kollektion "${name}" nicht gefunden`); return; }
    // Smart Collections sind regelbasiert — kein collect-POST möglich/nötig
    if (col.__smart) { console.log(`  Kollektion "${name}" (smart, automatisch)`); return; }
    try {
      await shopifyRequest(shop, token, 'POST', 'collects.json', {
        collect: { product_id: productId, collection_id: col.id }
      });
      console.log(`  Kollektion gesetzt: ${name}`);
    } catch (e) {
      warnings.push(`Kollektion "${name}" fehlgeschlagen: ${e.message}`);
    }
  }));
}

export async function createShopifyDraft(productData, imageFiles, shop, token) {
  const {
    titel_vorschlag, beschreibung,
    marke, modell, size_corrected, taxable,
    tags, sku, suggested_price,
    shipping_weight_kg, country_of_origin, hs_code, collections,
  } = productData;

  const title    = titel_vorschlag || [marke, modell, size_corrected].filter(Boolean).join(' ') || 'Jeans';
  const bodyHtml = beschreibung ? beschreibung.replace(/\n/g, '<br>') : '';
  const price    = suggested_price ? parseFloat(suggested_price).toFixed(2) : '0.00';
  const tagStr   = Array.isArray(tags) ? tags.join(', ') : (tags || '');

  const created = await shopifyRequest(shop, token, 'POST', 'products.json', {
    product: {
      title,
      body_html: bodyHtml,
      vendor: 'veyroze',
      product_type: 'Jeans',
      status: 'draft',
      tags: tagStr,
      variants: [{
        price,
        sku: sku || '',
        inventory_management: 'shopify',
        inventory_policy: 'deny',
        option1: size_corrected || 'Default',
        taxable: taxable ?? false,
        weight: shipping_weight_kg ?? 0.8,
        weight_unit: 'kg',
      }]
    }
  });

  const productId       = created.product.id;
  const inventoryItemId = created.product.variants[0]?.inventory_item_id;
  console.log(`  Shopify Draft erstellt: ${title} (ID: ${productId})`);

  const warnings = [];

  const setInventory = async () => {
    try {
      const locationId = await getLocationId(shop, token, 'Veyroze UG');
      if (locationId && inventoryItemId) {
        await shopifyRequest(shop, token, 'POST', 'inventory_levels/set.json', {
          inventory_item_id: inventoryItemId,
          location_id:       locationId,
          available:         1,
        });
        console.log(`  Inventar gesetzt: 1 × Veyroze UG`);
      } else {
        warnings.push('Inventar-Standort "Veyroze UG" nicht gefunden');
      }
    } catch (e) {
      warnings.push(`Inventar-Set fehlgeschlagen: ${e.message}`);
    }
  };

  const setInventoryItem = async () => {
    if (!inventoryItemId) return;
    try {
      const countryCode = toIsoCode(country_of_origin);
      const update = {};
      if (countryCode) update.country_code_of_origin = countryCode;
      if (hs_code)     update.harmonized_system_code = hs_code;
      if (!Object.keys(update).length) return;
      await shopifyRequest(shop, token, 'PUT', `inventory_items/${inventoryItemId}.json`, {
        inventory_item: update
      });
      console.log(`  Inventory-Item: ${countryCode || '—'} / HS ${hs_code || '—'}`);
    } catch (e) {
      warnings.push(`HS-Code/Herkunftsland fehlgeschlagen: ${e.message}`);
    }
  };

  const setCollections = async () => {
    await addToCollections(shop, token, productId, collections, warnings);
  };

  const uploadImages = async () => {
    // position explizit setzen — parallele Uploads würden sonst beliebige Reihenfolge ergeben
    await Promise.all(imageFiles.map(async (imgPath, i) => {
      try {
        await uploadProductImage(shop, token, productId, imgPath, i + 1);
        console.log(`  Bild hochgeladen [${i + 1}]: ${path.basename(imgPath)}`);
      } catch (e) {
        warnings.push(`Bild-Upload fehlgeschlagen (${path.basename(imgPath)}): ${e.message}`);
      }
    }));
  };

  // Alle 4 Post-Product-Schritte parallel — sparen ~70% Zeit gegenüber sequenziell
  await Promise.all([setInventory(), setInventoryItem(), setCollections(), uploadImages()]);

  warnings.forEach(w => console.warn(`  ${w}`));

  return {
    id: productId,
    title,
    price,
    url: `https://${shop}/admin/products/${productId}`,
    warnings,
  };
}
