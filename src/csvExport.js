import fs from 'fs';

const HEADERS = [
  'Handle',
  'Title',
  'Body (HTML)',
  'Vendor',
  'Product Category',
  'Type',
  'Tags',
  'Published',
  'Option1 Name',
  'Option1 Value',
  'Variant SKU',
  'Variant Price',
  'Variant Compare At Price',
  'Variant Inventory Qty',
  'Variant Inventory Policy',
  'Variant Fulfillment Service',
  'Variant Requires Shipping',
  'Image Src',
  'Image Position',
  'Image Alt Text',
  'Status',
];

function toHandle(title) {
  return title
    .toLowerCase()
    .replace(/[äöü]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue' }[c]))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function csvCell(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n'))
    return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function buildRow(fields) {
  return HEADERS.map(h => csvCell(fields[h] ?? '')).join(',');
}

/**
 * Exports KI-analyzed products to Shopify-compatible CSV.
 * @param {Array<{ki, images, index}>} products  from pipeline Phase 4
 * @param {string} outputPath
 */
export function exportToCSV(products, outputPath) {
  const rows = [HEADERS.map(csvCell).join(',')];

  for (const { ki, images, index } of products) {
    const title  = ki.titel_vorschlag || `Produkt ${index}`;
    const handle = toHandle(title);
    const sku    = ki.sku || '';
    const tags   = Array.isArray(ki.tags) ? ki.tags.join(', ') : (ki.tags || '');
    const size   = ki.size_corrected || ki.size_label || ki.groesse || '';
    const body   = `<p>${(ki.beschreibung || '').replace(/\n/g, '<br>')}</p>`;

    rows.push(buildRow({
      'Handle':                       handle,
      'Title':                        title,
      'Body (HTML)':                  body,
      'Vendor':                       ki.marke || '',
      'Product Category':             'Apparel & Accessories > Clothing > Pants',
      'Type':                         'Jeans',
      'Tags':                         tags,
      'Published':                    'FALSE',
      'Option1 Name':                 'Größe',
      'Option1 Value':                size || 'One Size',
      'Variant SKU':                  sku,
      'Variant Price':                '',
      'Variant Compare At Price':     '',
      'Variant Inventory Qty':        '1',
      'Variant Inventory Policy':     'deny',
      'Variant Fulfillment Service':  'manual',
      'Variant Requires Shipping':    'TRUE',
      'Image Src':                    images[0] || '',
      'Image Position':               '1',
      'Image Alt Text':               title,
      'Status':                       'draft',
    }));

    images.slice(1).forEach((src, i) => {
      rows.push(buildRow({
        'Handle':         handle,
        'Image Src':      src,
        'Image Position': String(i + 2),
        'Image Alt Text': `${title} — Bild ${i + 2}`,
      }));
    });
  }

  fs.writeFileSync(outputPath, rows.join('\n'), 'utf8');
  return outputPath;
}
