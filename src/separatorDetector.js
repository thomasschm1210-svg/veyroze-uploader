import sharp from 'sharp';
import path from 'path';
import { detectSeparatorImage } from './ki.js';
import { detectSkuNumber } from './ocr.js';

const THRESHOLD = 0.55;

export async function isSeparator(filePath, keyword = 'trenner') {
  if (path.basename(filePath).toLowerCase().includes(keyword.toLowerCase()))
    return { isSeparator: true, sku: null };

  // Gemini Vision — zuverlässigste Methode für Frostbeutel mit Marker-Schrift
  const geminiResult = await detectSeparatorImage(filePath);
  if (geminiResult.isSeparator) return geminiResult;

  // OCR-Fallback (greift wenn kein Gemini API Key gesetzt)
  try {
    const sku = await detectSkuNumber(filePath);
    if (sku) return { isSeparator: true, sku };
  } catch { /* weiter */ }

  // Visuelle Heuristik als letzter Fallback (für leere weiße Seiten)
  try {
    const scores = await Promise.all([
      scoreBrightness(filePath),
      scoreColorVariance(filePath),
      scoreEdgeDensity(filePath),
    ]);
    const weighted = scores[0] * 0.4 + scores[1] * 0.3 + scores[2] * 0.3;
    return { isSeparator: weighted >= THRESHOLD, sku: null };
  } catch {
    return { isSeparator: false, sku: null };
  }
}

async function scoreBrightness(filePath) {
  const { data } = await sharp(filePath)
    .resize(64, 64, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const avg = data.reduce((s, v) => s + v, 0) / data.length;
  return Math.max(0, (avg - 160) / 95);
}

async function scoreColorVariance(filePath) {
  const { data } = await sharp(filePath)
    .resize(64, 64, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const len = data.length;
  const mean = data.reduce((s, v) => s + v, 0) / len;
  const variance = data.reduce((s, v) => s + (v - mean) ** 2, 0) / len;
  return Math.max(0, 1 - Math.sqrt(variance) / 20);
}

async function scoreEdgeDensity(filePath) {
  const { data, info } = await sharp(filePath)
    .resize(128, 128, { fit: 'fill' })
    .grayscale()
    .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const edgePixels = data.filter(v => v > 30).length;
  const density = edgePixels / (info.width * info.height);
  return Math.max(0, 1 - density / 0.03);
}
