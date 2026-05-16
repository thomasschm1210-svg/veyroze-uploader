import fs   from 'fs';
import path from 'path';
import { detectSeparatorsBatch } from './ki.js';

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

export function isImageFile(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function groupImages(inputFolder) {
  const files = fs.readdirSync(inputFolder)
    .filter(f => !f.startsWith('_') && !f.startsWith('.') && isImageFile(f))
    .sort()
    .map(f => path.join(inputFolder, f));
  if (files.length === 0) return { groups: [], separators: [], skus: [] };
  return { groups: [files], separators: [], skus: [null] };
}

export async function groupImagesBySeparator(imagePaths, progressCallback) {
  if (!imagePaths.length) return [];

  // Die Upload-Reihenfolge ist die Wahrheit: der Kunde legt die Tüte bewusst
  // als erstes Foto pro Produkt rein. EXIF-Timestamps sind unzuverlässig
  // (Edits, später nachgeschriebene Tüten) und würden die Produktgrenzen zerstören.
  const sequence = imagePaths;

  progressCallback?.(0, sequence.length, 'Sende an Gemini…');

  let processed = 0;
  const results = (await detectSeparatorsBatch(sequence, (chunksDone, totalChunks, lastSize) => {
    processed += lastSize;
    progressCallback?.(
      processed,
      sequence.length,
      `Batch ${chunksDone}/${totalChunks} (${processed}/${sequence.length} Bilder)`,
    );
  })) || sequence.map(() => ({ isSeparator: false, sku: null }));

  const trennerCount = results.filter(r => r.isSeparator).length;
  progressCallback?.(sequence.length, sequence.length, `${trennerCount} Trennbild(er) gefunden`);

  const groups = [];
  let current  = null;
  let unknown  = 0;
  const newUnknownSku = () => `UNKNOWN_${String(++unknown).padStart(3, '0')}`;

  for (let i = 0; i < sequence.length; i++) {
    const r = results[i];
    if (r.isSeparator) {
      // Tüten-Foto bleibt im Produkt — KI braucht es, um die SKU zu verifizieren
      current = {
        sku: r.sku,
        bagImage: sequence[i],
        productImages: [sequence[i]],
        groupIndex: groups.length,
      };
      groups.push(current);
    } else {
      if (!current) {
        current = {
          sku: newUnknownSku(),
          bagImage: null,
          productImages: [],
          groupIndex: groups.length,
        };
        groups.push(current);
      }
      current.productImages.push(sequence[i]);
    }
  }

  return groups;
}
