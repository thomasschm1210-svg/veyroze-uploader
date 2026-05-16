import fs from 'fs';
import path from 'path';

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

// Lädt ein Bild als Base64 zur Shopify-Produkt-Galerie hoch
async function uploadProductImage(shop, token, productId, imagePath) {
  const base64 = fs.readFileSync(imagePath).toString('base64');
  const filename = path.basename(imagePath);
  const data = await shopifyRequest(shop, token, 'POST', `products/${productId}/images.json`, {
    image: { attachment: base64, filename }
  });
  return data.image;
}

async function getLocationId(shop, token, name) {
  const data = await shopifyRequest(shop, token, 'GET', 'locations.json');
  return data.locations?.find(l => l.name === name)?.id ?? null;
}

// Erstellt ein Draft-Produkt in Shopify und lädt alle Bilder hoch
export async function createShopifyDraft(productData, imageFiles, shop, token) {
  const {
    titel_vorschlag, beschreibung,
    marke, modell, size_corrected, condition, taxable,
    tags, sku, suggested_price,
  } = productData;

  const title    = titel_vorschlag || [marke, modell, size_corrected].filter(Boolean).join(' ') || 'Jeans';
  const bodyHtml = beschreibung ? beschreibung.replace(/\n/g, '<br>') : '';
  const price    = suggested_price ? parseFloat(suggested_price).toFixed(2) : '0.00';
  const tagStr   = Array.isArray(tags) ? tags.join(', ') : (tags || '');

  const created = await shopifyRequest(shop, token, 'POST', 'products.json', {
    product: {
      title,
      body_html: bodyHtml,
      vendor: marke || '',
      product_type: 'Jeans',
      status: 'draft',
      tags: tagStr,
      variants: [{
        price,
        sku: sku || '',
        inventory_management: 'shopify',
        option1: size_corrected || 'Default',
        taxable: false,
      }]
    }
  });

  const productId       = created.product.id;
  const inventoryItemId = created.product.variants[0]?.inventory_item_id;
  console.log(`  Shopify Draft erstellt: ${title} (ID: ${productId})`);

  // Inventar auf 1 setzen für Standort "Veyroze UG"
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
      console.warn(`  Inventar-Standort "Veyroze UG" nicht gefunden`);
    }
  } catch (e) {
    console.warn(`  Inventar-Set fehlgeschlagen: ${e.message}`);
  }

  // Bilder hochladen
  for (const imgPath of imageFiles) {
    try {
      await uploadProductImage(shop, token, productId, imgPath);
      console.log(`  Bild hochgeladen: ${path.basename(imgPath)}`);
    } catch (e) {
      console.warn(`  Bild-Upload fehlgeschlagen (${path.basename(imgPath)}): ${e.message}`);
    }
  }

  return {
    id: productId,
    title,
    price,
    url: `https://${shop}/admin/products/${productId}`
  };
}
