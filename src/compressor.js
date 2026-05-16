import sharp  from 'sharp';
import fs     from 'fs';
import path   from 'path';

// Zielgröße für Shopify-Upload: max 2048px längste Seite, JPEG 85%
const MAX_PX        = 2048;
const QUALITY       = 85;
const MIN_SAVE      = 0.15;  // Nur komprimieren wenn mind. 15% Ersparnis
const SKIP_BYTES    = 500 * 1024; // Bereits client-seitig komprimierte JPEGs nicht nochmal anpacken

/**
 * Komprimiert ein Bild in-place (überschreibt Original).
 * Gibt Statistik zurück: { originalBytes, finalBytes, savedPct, skipped }
 */
export async function compressImage(filePath) {
  const originalBytes = fs.statSync(filePath).size;
  const ext           = path.extname(filePath).toLowerCase();

  if ((ext === '.jpg' || ext === '.jpeg') && originalBytes < SKIP_BYTES) {
    return { originalBytes, finalBytes: originalBytes, savedPct: 0, skipped: true };
  }

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
 * Komprimiert alle Bilder einer Gruppe parallel; gibt Gesamtstatistik zurück.
 */
export async function compressGroup(imageFiles) {
  const results = await Promise.all(imageFiles.map(async (f) => {
    try {
      return await compressImage(f);
    } catch {
      return null;
    }
  }));

  let totalSaved = 0;
  let totalOrig  = 0;
  for (const r of results) {
    if (!r) continue;
    totalOrig  += r.originalBytes;
    totalSaved += r.skipped ? 0 : (r.originalBytes - r.finalBytes);
  }

  return {
    originalMB: (totalOrig / 1024 / 1024).toFixed(1),
    savedMB:    (totalSaved / 1024 / 1024).toFixed(1),
    savedPct:   totalOrig > 0 ? Math.round((totalSaved / totalOrig) * 100) : 0,
  };
}
