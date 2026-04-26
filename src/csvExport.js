/**
 * Shopify CSV-Exporter.
 *
 * Erzeugt eine CSV-Datei im offiziellen Shopify-Produkt-Import-Format.
 * Doku: https://help.shopify.com/en/manual/products/import-export/using-csv
 *
 * Bilder werden als lokale Pfade eingetragen (müssen vor dem Import
 * auf einen öffentlichen Server hochgeladen werden — oder via Shopify-App).
 */

import fs from 'fs';
import path from 'path';

// Shopify CSV-Spalten (Pflicht + wichtigste optionale)
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
  // Anführungszeichen escapen und Zelle in Quotes einschließen wenn nötig
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildRow(fields) {
  return HEADERS.map(h => csvCell(fields[h] ?? '')).join(',');
}

function buildHtml({ description, features }) {
  const list = features.map(f => `<li>${f}</li>`).join('');
  return `<p>${description}</p><ul>${list}</ul>`;
}

/**
 * Fügt Produkte zur CSV hinzu.
 * @param {Array<{product, imageFiles, groupIndex}>} entries
 * @param {string} outputPath  Zielpfad für die CSV-Datei
 */
export function exportToCSV(entries, outputPath) {
  // Header-Zeile: Spalten mit Leerzeichen in Anführungszeichen
  const rows = [HEADERS.map(csvCell).join(',')];

  for (const { product, imageFiles, groupIndex } of entries) {
    const {
      brand, model, size, category, condition,
      color, features, description, suggested_price,
    } = product;

    const title  = [brand, model, size].filter(Boolean).join(' ') || `Produkt ${groupIndex}`;
    const handle = toHandle(title);
    const sku    = `VEY-${String(groupIndex).padStart(4, '0')}`;
    const tags   = [brand, category, condition, color, size].filter(Boolean).join(', ');
    const html   = buildHtml({ description, features });

    // Erste Zeile: Produkt-Stammdaten + erstes Bild
    rows.push(buildRow({
      'Handle':                       handle,
      'Title':                        title,
      'Body (HTML)':                  html,
      'Vendor':                       brand || '',
      'Product Category':             category || '',
      'Type':                         category || '',
      'Tags':                         tags,
      'Published':                    'FALSE',           // Draft
      'Option1 Name':                 'Größe',
      'Option1 Value':                size || 'One Size',
      'Variant SKU':                  sku,
      'Variant Price':                suggested_price.toFixed(2),
      'Variant Compare At Price':     '',
      'Variant Inventory Qty':        '1',
      'Variant Inventory Policy':     'deny',
      'Variant Fulfillment Service':  'manual',
      'Variant Requires Shipping':    'TRUE',
      'Image Src':                    imageFiles[0] || '',
      'Image Position':               '1',
      'Image Alt Text':               title,
      'Status':                       'draft',
    }));

    // Weitere Bilder: nur Handle + Image-Spalten befüllen
    imageFiles.slice(1).forEach((imgPath, i) => {
      rows.push(buildRow({
        'Handle':         handle,
        'Image Src':      imgPath,
        'Image Position': String(i + 2),
        'Image Alt Text': `${title} — Bild ${i + 2}`,
      }));
    });
  }

  fs.writeFileSync(outputPath, rows.join('\n'), 'utf8');
  return outputPath;
}
