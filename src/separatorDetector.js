/**
 * Lokale, rein visuelle Trennbild-Erkennung via sharp.
 *
 * Heuristiken (kombiniert):
 *  1. Sehr hohe Helligkeit (leeres weißes Blatt / heller Hintergrund)
 *  2. Sehr niedrige Farbsättigung (fast grau/weiß)
 *  3. Geringer Kontrast (wenig Details → kein Produkt im Vordergrund)
 *  4. Dateiname enthält Keyword
 *
 * Jede Heuristik gibt 0–1 zurück; Score >= THRESHOLD → Trennbild.
 */

import sharp from 'sharp';
import path from 'path';

const THRESHOLD = 0.55; // Mindest-Score für Trennbild-Klassifikation

export async function isSeparator(filePath, keyword = 'trenner') {
  // Dateiname-Schnellcheck
  if (path.basename(filePath).toLowerCase().includes(keyword.toLowerCase())) return true;

  try {
    const scores = await Promise.all([
      scoreBrightness(filePath),
      scoreColorVariance(filePath),
      scoreEdgeDensity(filePath),
    ]);

    // Gewichteter Durchschnitt: Helligkeit 40%, Farbvarianz 30%, Kantendichte 30%
    const weighted = scores[0] * 0.4 + scores[1] * 0.3 + scores[2] * 0.3;
    return weighted >= THRESHOLD;
  } catch {
    return false; // Im Fehlerfall: kein Trennbild annehmen
  }
}

// Score 1: Hohe Helligkeit → Trennbild wahrscheinlich
async function scoreBrightness(filePath) {
  const { data } = await sharp(filePath)
    .resize(64, 64, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const avg = data.reduce((s, v) => s + v, 0) / data.length;
  // avg 200–255 → sehr hell → hoher Score
  return Math.max(0, (avg - 160) / 95);
}

// Score 2: Geringe Farbvarianz → einfarbig → Trennbild wahrscheinlich
async function scoreColorVariance(filePath) {
  const { data } = await sharp(filePath)
    .resize(64, 64, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Standardabweichung der RGB-Werte berechnen
  const len = data.length;
  const mean = data.reduce((s, v) => s + v, 0) / len;
  const variance = data.reduce((s, v) => s + (v - mean) ** 2, 0) / len;
  const stddev = Math.sqrt(variance);

  // stddev 0–20 → fast einfarbig → Score hoch
  return Math.max(0, 1 - stddev / 20);
}

// Score 3: Geringe Kantendichte → kein Produkt → Trennbild wahrscheinlich
async function scoreEdgeDensity(filePath) {
  const { data, info } = await sharp(filePath)
    .resize(128, 128, { fit: 'fill' })
    .grayscale()
    // Sobel-ähnlicher Laplace-Kern via convolve
    .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const edgePixels = data.filter(v => v > 30).length;
  const density = edgePixels / (info.width * info.height);

  // density < 0.03 → kaum Kanten → hoher Score (= Trennbild)
  return Math.max(0, 1 - density / 0.03);
}
