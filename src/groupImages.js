import fs   from 'fs';
import path from 'path';
import { isSeparator } from './separatorDetector.js';
import { detectSeparatorsBatch } from './ki.js';

export { isSeparator };

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

export function isImageFile(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function scanDir(folder) {
  return fs.readdirSync(folder)
    .filter(f => !f.startsWith('_') && !f.startsWith('.') && isImageFile(f))
    .sort()
    .map(f => path.join(folder, f));
}

/**
 * Liest Ordner ein, erkennt Separator-Fotos (SKU-Tüten) via OCR und gruppiert die Bilder.
 * Das Separator-Foto ist das erste Bild der jeweiligen Gruppe (für Gemini-SKU-Erkennung).
 *
 * @returns {{ groups: string[][], separators: string[], skus: (string|null)[] }}
 */
export async function groupImages(inputFolder, separatorKeyword) {
  const files = scanDir(inputFolder);
  if (files.length === 0) return { groups: [], separators: [], skus: [] };

  let detected = await detectSeparatorsBatch(files);
  if (!detected) {
    detected = await Promise.all(files.map(f => isSeparator(f, separatorKeyword)));
  }

  const groups     = [];
  const separators = [];
  const skus       = [];
  let current      = null;

  for (let i = 0; i < files.length; i++) {
    const { isSeparator: isSep, sku } = detected[i];
    if (isSep) {
      current = [files[i]];
      groups.push(current);
      separators.push(files[i]);
      skus.push(sku);
    } else {
      if (!current) { current = []; groups.push(current); }
      current.push(files[i]);
    }
  }

  return { groups, separators, skus };
}
