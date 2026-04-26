/**
 * Lokales OCR mit tesseract.js.
 * Liest Text von Produktbildern (Etiketten, Preisschilder, Größenangaben).
 *
 * Worker wird einmal erstellt und wiederverwendet (minimize.
 * Aufruf von terminate() beim Programmende.
 */

import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import os from 'os';

let worker = null;

async function getWorker() {
  if (!worker) {
    worker = await Tesseract.createWorker('eng+deu', 1, {
      // Kein Logging in die Konsole
      logger: () => {},
    });
    await worker.setParameters({
      tessedit_pageseg_mode: '3', // Auto page segmentation
    });
  }
  return worker;
}

export async function terminateOCR() {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}

// Liest Text aus einem Bild; gibt bereinigten String zurück
export async function extractText(imagePath) {
  // Bild vorverarbeiten: größer skalieren + Kontrast erhöhen → bessere OCR-Ergebnisse
  const tmpPath = path.join(os.tmpdir(), `ocr_${path.basename(imagePath)}.png`);
  try {
    await sharp(imagePath)
      .resize({ width: 1800, withoutEnlargement: false })
      .grayscale()
      .normalise()           // Auto-Kontrast
      .sharpen()
      .png()
      .toFile(tmpPath);

    const w = await getWorker();
    const { data: { text } } = await w.recognize(tmpPath);
    return text.trim();
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

// Extrahiert Text aus bis zu 3 Bildern einer Gruppe (Token-Sparsamkeit)
export async function extractGroupText(imageFiles) {
  const results = [];
  for (const f of imageFiles.slice(0, 3)) {
    try {
      const text = await extractText(f);
      if (text.length > 10) results.push(text);
    } catch {
      // Einzelbild-Fehler ignorieren
    }
  }
  return results.join('\n');
}
