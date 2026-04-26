import fs from 'fs';
import path from 'path';

async function shopifyRequest(shop, token, method, endpoint, body = null) {
  const url = `https://${shop}/admin/api/2024-04/${endpoint}`;
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

// Erstellt ein Draft-Produkt in Shopify und lädt alle Bilder hoch
export async function createShopifyDraft(productData, imageFiles, shop, token) {
  const { brand, model, size, category, condition, color, features, description, suggested_price } = productData;

  const title = [brand, model, size].filter(Boolean).join(' ');
  const bodyHtml = `
<p>${description}</p>
<ul>
${features.map(f => `<li>${f}</li>`).join('\n')}
</ul>
<p><strong>Zustand:</strong> ${condition} | <strong>Farbe:</strong> ${color}</p>
`.trim();

  // Produkt als Draft anlegen (published: false)
  const created = await shopifyRequest(shop, token, 'POST', 'products.json', {
    product: {
      title,
      body_html: bodyHtml,
      vendor: brand,
      product_type: category,
      status: 'draft',
      tags: [brand, category, condition, color, size].filter(Boolean).join(', '),
      variants: [{
        price: suggested_price.toFixed(2),
        inventory_management: 'shopify',
        inventory_quantity: 1,
        option1: size || 'Default'
      }]
    }
  });

  const productId = created.product.id;
  console.log(`  Shopify Draft erstellt: ${title} (ID: ${productId})`);

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
    price: suggested_price,
    url: `https://${shop}/admin/products/${productId}`
  };
}
