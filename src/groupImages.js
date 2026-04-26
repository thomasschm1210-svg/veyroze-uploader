import fs   from 'fs';
import path from 'path';
import { isSeparator } from './separatorDetector.js';

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
 * Liest Ordner ein und gibt Gruppen + Separatoren zurück.
 * @returns {{ groups: string[][], separators: string[] }}
 */
export async function groupImages(inputFolder, separatorKeyword) {
  const files = scanDir(inputFolder);
  if (files.length === 0) return { groups: [], separators: [] };

  const groups     = [];
  const separators = [];
  let current      = [];

  for (const file of files) {
    const sep = await isSeparator(file, separatorKeyword);
    if (sep) {
      separators.push(file);
      if (current.length > 0) { groups.push(current); current = []; }
    } else {
      current.push(file);
    }
  }

  if (current.length > 0) groups.push(current);
  return { groups, separators };
}
