/**
 * Produkt-Analyse Pipeline — 100% lokal, kein Cloud-API.
 *
 * Pipeline:
 *   1. EXIF-Metadaten lesen (Aufnahmedatum, Kamera)
 *   2. OCR aller Produktbilder (Etiketten, Preisschilder, Logos)
 *   3. Regelbasierter Parser → strukturierte Produktdaten
 *
 * Erweiterungspunkt: analyzeProduct() kann durch eine KI-Version
 * ersetzt werden (gleiche Signatur, gleiches Return-Format).
 */

import { extractGroupText } from './ocr.js';
import { parseProductText }  from './parser.js';
import exifr                 from 'exifr';
import path                  from 'path';

export async function analyzeProduct(imageFiles) {
  // EXIF aus erstem Bild lesen (für Metadaten, nicht für Produkt-Erkennung)
  const exif = await readExif(imageFiles[0]);

  // OCR über alle Bilder der Gruppe
  const ocrText = await extractGroupText(imageFiles);

  // Dateiname als zusätzlichen Hinweis nutzen
  const firstFilename = path.basename(imageFiles[0], path.extname(imageFiles[0]));

  // Parser
  const product = parseProductText(ocrText, firstFilename);

  // Zusatzfeld: Aufnahmezeitpunkt wenn vorhanden
  if (exif?.DateTimeOriginal) {
    product._capturedAt = exif.DateTimeOriginal.toISOString();
  }

  return product;
}

async function readExif(imagePath) {
  try {
    return await exifr.parse(imagePath, { pick: ['DateTimeOriginal', 'Make', 'Model'] });
  } catch {
    return null;
  }
}
