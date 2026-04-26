import sharp  from 'sharp';
import fs     from 'fs';
import path   from 'path';

// Zielgröße für Shopify-Upload: max 2048px längste Seite, JPEG 85%
const MAX_PX   = 2048;
const QUALITY  = 85;
const MIN_SAVE = 0.15;  // Nur komprimieren wenn mind. 15% Ersparnis

/**
 * Komprimiert ein Bild in-place (überschreibt Original).
 * Gibt Statistik zurück: { originalBytes, finalBytes, savedPct, skipped }
 */
export async function compressImage(filePath) {
  const originalBytes = fs.statSync(filePath).size;
  const ext           = path.extname(filePath).toLowerCase();
  const tmpPath       = filePath + '.tmp.jpg';

  try {
    await sharp(filePath)
      .rotate()                                         // EXIF-Rotation korrigieren
      .resize(MAX_PX, MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: QUALITY, progressive: true, mozjpeg: true })
      .toFile(tmpPath);

    const finalBytes = fs.statSync(tmpPath).size;
    const savedPct   = 1 - finalBytes / originalBytes;

    if (savedPct >= MIN_SAVE || ext !== '.jpg' && ext !== '.jpeg') {
      // Ersetze Original
      fs.renameSync(tmpPath, filePath);
      return { originalBytes, finalBytes, savedPct, skipped: false };
    } else {
      // Kaum Ersparnis → Original behalten
      fs.unlinkSync(tmpPath);
      return { originalBytes, finalBytes: originalBytes, savedPct: 0, skipped: true };
    }
  } catch (err) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    throw err;
  }
}

/**
 * Komprimiert alle Bilder einer Gruppe; gibt Gesamtstatistik zurück.
 */
export async function compressGroup(imageFiles) {
  let totalSaved = 0;
  let totalOrig  = 0;

  for (const f of imageFiles) {
    try {
      const { originalBytes, finalBytes, skipped } = await compressImage(f);
      totalOrig  += originalBytes;
      totalSaved += skipped ? 0 : (originalBytes - finalBytes);
    } catch {
      // Einzelfehler ignorieren — Bild bleibt wie es ist
    }
  }

  return {
    originalMB: (totalOrig / 1024 / 1024).toFixed(1),
    savedMB:    (totalSaved / 1024 / 1024).toFixed(1),
    savedPct:   totalOrig > 0 ? Math.round((totalSaved / totalOrig) * 100) : 0,
  };
}
