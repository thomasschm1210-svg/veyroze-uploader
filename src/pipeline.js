/**
 * Pipeline v3 — orchestriert alle Verarbeitungsschritte für einen Lauf.
 *
 * Schritte pro Gruppe:
 *   1. Duplikate herausfiltern
 *   2. Bilder komprimieren
 *   3. OCR + Analyse
 *   4. Routing: verarbeitet / review / fehler
 *   5. CSV-Einträge sammeln
 */

import path   from 'path';
import pLimit from 'p-limit';

import { log }             from './logger.js';
import { Progress }        from './progress.js';
import { securityCheck }   from './security/index.js';
import { checkDuplicate }  from './deduplicator.js';
import { compressGroup }   from './compressor.js';
import { analyzeProduct }  from './analyzeProduct.js';
import { mockKiAnalyze }   from './ki.js';
import { exportToCSV }     from './csvExport.js';
import { FileRouter, REVIEW_THRESHOLD } from './fileRouter.js';
import { RunLogger }       from './runLogger.js';

// Maximale parallele Gruppen-Verarbeitungen (OCR ist CPU-intensiv)
const CONCURRENCY = 2;

/**
 * Verarbeitet alle Gruppen eines Laufs.
 *
 * @param {string[][]} groups   Array von Datei-Arrays (eine Gruppe = ein Produkt)
 * @param {string}     baseDir  Basisordner (input/)
 * @param {object}     opts     { separators: string[] }  Trennbild-Pfade zum Aufräumen
 * @returns {{ csvPath, logPath, stats }}
 */
export async function runPipeline(groups, baseDir, opts = {}) {
  const ProgressClass = opts.ProgressClass ?? Progress;
  const ts     = Date.now();
  const router = new FileRouter(baseDir);
  const logger = new RunLogger(router.logPath(ts));

  // Trennbilder aufräumen
  for (const sep of (opts.separators ?? [])) {
    try {
      router._moveOne(sep, path.join(router.verarbeitet, path.basename(sep)));
    } catch { /* ignorieren */ }
  }

  // Alle Bilder zählen für Fortschrittsbalken
  const allImages = groups.flat();
  logger.stats.totalImages = allImages.length;
  logger.info(`Start: ${groups.length} Gruppe(n), ${allImages.length} Bild(er)`);

  const secUpload = await securityCheck({ phase: 'upload', imageFiles: allImages.map(p => ({ path: p })) });
  if (secUpload.block) throw new Error(secUpload.body.error.message);

  // ── Phase 1: Duplikate herausfiltern ────────────────────────────────────────
  log.header(`PHASE 1 / 4  Duplikate prüfen (${allImages.length} Bilder)`);
  const prog1 = new ProgressClass(allImages.length, 'Duplikate');
  prog1.setPhase('Duplikate');

  const cleanGroups = [];   // Gruppen nach Duplikat-Entfernung

  for (const group of groups) {
    const clean = [];
    for (const f of group) {
      const { isDuplicate, originalPath } = checkDuplicate(f);
      if (isDuplicate) {
        router.moveToDuplicate(f, originalPath);
        logger.duplicate(f, originalPath);
        log.warn(`  Duplikat übersprungen: ${path.basename(f)}`);
      } else {
        clean.push(f);
      }
      prog1.tick(path.basename(f));
    }
    if (clean.length > 0) cleanGroups.push(clean);
  }
  prog1.done();

  // ── Phase 2: Komprimieren ───────────────────────────────────────────────────
  log.header(`PHASE 2 / 4  Bilder komprimieren (${cleanGroups.length} Gruppen)`);
  const prog2 = new ProgressClass(cleanGroups.length, 'Komprimieren');
  prog2.setPhase('Komprimieren');
  let totalSavedMB = 0;

  for (const group of cleanGroups) {
    const stats = await compressGroup(group);
    totalSavedMB += parseFloat(stats.savedMB);
    prog2.tick(`gespart: ${stats.savedMB} MB`);
  }
  prog2.done();
  logger.stats.savedMB = totalSavedMB.toFixed(1);
  log.success(`Komprimierung: ${totalSavedMB.toFixed(1)} MB gespart`);

  // ── Phase 3: Analyse (parallelisiert) ───────────────────────────────────────
  log.header(`PHASE 3 / 4  OCR + Analyse (${cleanGroups.length} Produkte)`);
  const prog3   = new ProgressClass(cleanGroups.length, 'Analyse');
  prog3.setPhase('Analyse');
  const limit   = pLimit(CONCURRENCY);

  const tasks = cleanGroups.map((group, i) =>
    limit(async () => {
      const groupLabel = `produkt-${String(i + 1).padStart(3, '0')}`;
      let product;

      try {
        product = await analyzeProduct(group);
      } catch (err) {
        // Alle Bilder dieser Gruppe → _fehler/
        for (const f of group) {
          router.moveToError(f, err.message);
          logger.errorItem(f, err.message);
        }
        prog3.tick(`[FEHLER] Gruppe ${i + 1}`);
        return null;
      }

      const isLowConfidence = product._confidence < REVIEW_THRESHOLD;
      let finalPaths;

      if (isLowConfidence) {
        finalPaths = router.moveToReview(group, groupLabel, product._confidence);
        logger.reviewItem(i + 1, product._confidence);
      } else {
        finalPaths = router.moveToProcessed(group, groupLabel);
        logger.product(i + 1, product, group, groupLabel);
      }

      prog3.tick(`${product.brand} ${product.model || ''} (${product._confidence}%)`);
      return { product, finalPaths, groupLabel, groupIndex: i + 1, isLowConfidence };
    })
  );

  const results = (await Promise.all(tasks)).filter(Boolean);
  prog3.done();

  // ── Phase 4: KI-Analyse ─────────────────────────────────────────────────────
  log.header(`PHASE 4 / 5  KI-Analyse (${results.length} Produkte)`);
  const prog4 = new ProgressClass(results.length || 1, 'KI-Analyse');
  prog4.setPhase('KI-Analyse');
  const products = [];

  for (const r of results) {
    const ocrText = [r.product?.brand, r.product?.model, r.product?.size].filter(Boolean).join(' ');
    const secKi   = await securityCheck({ phase: 'ki', ocrText });
    if (secKi.block) {
      log.warn(`  KI übersprungen (Sicherheitsprüfung): ${r.groupLabel}`);
      prog4.tick(r.groupLabel);
      continue;
    }

    const ki = await mockKiAnalyze(r.finalPaths, { folderName: opts.folderName || '' });
    const productImages = ki.product_images?.length ? ki.product_images : r.finalPaths;
    products.push({
      index:     r.groupIndex,
      label:     r.groupLabel,
      thumbnail: productImages[0] || null,
      images:    productImages,
      ki,
      isReview:  r.isLowConfidence,
    });
    prog4.tick(ki.titel_vorschlag);
  }
  prog4.done();

  // ── Phase 5: CSV-Export ─────────────────────────────────────────────────────
  log.header('PHASE 5 / 5  CSV-Export');
  let csvPath = null;

  if (products.length > 0) {
    csvPath = router.csvPath(ts);
    exportToCSV(products, csvPath);
    log.success(`CSV: ${products.length} Produkte → ${path.basename(csvPath)}`);
    log.dim(`Pfad: ${csvPath}`);
  } else {
    log.warn('Keine CSV-fähigen Produkte (alle in Review oder Fehler)');
  }

  // ── Abschluss ───────────────────────────────────────────────────────────────
  const stats = logger.finalize(csvPath);

  _printFinalSummary(results, stats, csvPath, router);

  return { csvPath, logPath: logger.path, stats, products };
}

function _printFinalSummary(results, stats, csvPath, router) {
  const G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m', B = '\x1b[1m', C = '\x1b[36m', X = '\x1b[0m';
  const line = '═'.repeat(56);

  console.log(`\n${B}${C}${line}${X}`);
  console.log(`${B}${C}  VEYROZE UPLOADER v3 — ABSCHLUSS${X}`);
  console.log(`${B}${C}${line}${X}`);

  for (const r of results) {
    if (!r) continue;
    const { product, groupLabel, isLowConfidence } = r;
    const title = [product.brand, product.model, product.size].filter(Boolean).join(' ') || groupLabel;
    const conf  = product._confidence;
    const color = conf >= 70 ? G : conf >= REVIEW_THRESHOLD ? Y : R;
    const tag   = isLowConfidence ? `${Y}[REVIEW]${X}` : `${G}[OK]    ${X}`;
    console.log(`  ${tag} ${title.padEnd(32)} ${color}${conf}%${X}  ${product.suggested_price} EUR`);
  }

  console.log(`${B}${C}${line}${X}`);
  console.log(`  ${B}Verarbeitet:${X}  ${G}${stats.processed}${X}`);
  console.log(`  ${B}Review:     ${X}  ${Y}${stats.reviewItems}${X}  → ${router.review}`);
  console.log(`  ${B}Fehler:     ${X}  ${R}${stats.errors}${X}  → ${router.fehler}`);
  console.log(`  ${B}Duplikate:  ${X}  ${stats.duplicates}  → ${router.duplikate}`);
  console.log(`  ${B}Gespart:    ${X}  ${stats.savedMB} MB durch Komprimierung`);
  if (csvPath) {
    console.log(`${B}${C}${line}${X}`);
    console.log(`  ${B}CSV:${X} ${G}${csvPath}${X}`);
    console.log(`  ${B}LOG:${X} ${router.logs}`);
    console.log(`\n  Shopify: Admin → Produkte → Importieren → CSV auswählen`);
  }
  console.log(`${B}${C}${line}${X}\n`);
}
