import fs   from 'fs';
import path from 'path';

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
