import path   from 'path';
import pLimit from 'p-limit';

import { log }            from './logger.js';
import { Progress }       from './progress.js';
import { securityCheck }  from './security/index.js';
import { checkDuplicate } from './deduplicator.js';
import { compressGroup }  from './compressor.js';
import { mockKiAnalyze }  from './ki.js';
import { exportToCSV }    from './csvExport.js';
import { FileRouter }     from './fileRouter.js';
import { RunLogger }      from './runLogger.js';

const CONCURRENCY = 2;

export async function runPipeline(groups, baseDir, opts = {}) {
  const ProgressClass = opts.ProgressClass ?? Progress;
  const ts     = Date.now();
  const router = new FileRouter(baseDir);
  const logger = new RunLogger(router.logPath(ts));

  for (const sep of (opts.separators ?? [])) {
    try {
      router._moveOne(sep, path.join(router.verarbeitet, path.basename(sep)));
    } catch { /* ignorieren */ }
  }

  const allImages = groups.flat();
  logger.stats.totalImages = allImages.length;
  logger.info(`Start: ${groups.length} Gruppe(n), ${allImages.length} Bild(er)`);

  const secUpload = await securityCheck({ phase: 'upload', imageFiles: allImages.map(p => ({ path: p })) });
  if (secUpload.block) throw new Error(secUpload.body.error.message);

  // ── Phase 1: Duplikate herausfiltern ────────────────────────────────────────
  log.header(`PHASE 1 / 4  Duplikate prüfen (${allImages.length} Bilder)`);
  const prog1 = new ProgressClass(allImages.length, 'Duplikate');
  prog1.setPhase('Duplikate');
  const cleanGroups = [];

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

  // ── Phase 3: KI-Analyse ─────────────────────────────────────────────────────
  log.header(`PHASE 3 / 4  KI-Analyse (${cleanGroups.length} Produkte)`);
  const prog3  = new ProgressClass(cleanGroups.length || 1, 'KI-Analyse');
  prog3.setPhase('KI-Analyse');
  const limit  = pLimit(CONCURRENCY);
  const products = [];

  const tasks = cleanGroups.map((group, i) =>
    limit(async () => {
      const groupLabel = `produkt-${String(i + 1).padStart(3, '0')}`;

      const secKi = await securityCheck({ phase: 'ki', ocrText: '' });
      if (secKi.block) {
        log.warn(`  KI übersprungen (Sicherheitsprüfung): ${groupLabel}`);
        prog3.tick(groupLabel);
        return null;
      }

      let ki;
      try {
        ki = await mockKiAnalyze(group, { folderName: opts.folderName || '' });
      } catch (err) {
        for (const f of group) {
          router.moveToError(f, err.message);
          logger.errorItem(f, err.message);
        }
        prog3.tick(`[FEHLER] Gruppe ${i + 1}`);
        return null;
      }

      const isReview = ki.confidence === 'low';
      const confPct  = { high: 90, medium: 60, low: 30 }[ki.confidence] ?? 0;
      const finalPaths = isReview
        ? router.moveToReview(group, groupLabel, confPct)
        : router.moveToProcessed(group, groupLabel);

      if (isReview) {
        logger.reviewItem(i + 1, confPct);
      } else {
        logger.product(i + 1, {
          brand: ki.marke, model: ki.modell, size: ki.groesse,
          category: ki.kategorie, color: ki.farbe,
          suggested_price: ki.preis_eur, _confidence: confPct,
        }, group, groupLabel);
      }

      const productImages = ki.product_images?.length ? ki.product_images : finalPaths;
      prog3.tick(ki.titel_vorschlag);

      return {
        index: i + 1,
        label: groupLabel,
        thumbnail: productImages[0] || null,
        images: productImages,
        measurementImages: ki.measurement_images || [],
        ki,
        isReview,
      };
    })
  );

  const settled = (await Promise.all(tasks)).filter(Boolean);
  products.push(...settled);
  prog3.done();

  // ── Phase 4: CSV-Export ─────────────────────────────────────────────────────
  log.header('PHASE 4 / 4  CSV-Export');
  let csvPath = null;

  if (products.length > 0) {
    csvPath = router.csvPath(ts);
    exportToCSV(products, csvPath);
    log.success(`CSV: ${products.length} Produkte → ${path.basename(csvPath)}`);
    log.dim(`Pfad: ${csvPath}`);
  } else {
    log.warn('Keine CSV-fähigen Produkte (alle in Review oder Fehler)');
  }

  const stats = logger.finalize(csvPath);
  _printFinalSummary(products, stats, csvPath, router);

  return { csvPath, logPath: logger.path, stats, products };
}

function _printFinalSummary(products, stats, csvPath, router) {
  const G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m', B = '\x1b[1m', C = '\x1b[36m', X = '\x1b[0m';
  const line = '═'.repeat(56);

  console.log(`\n${B}${C}${line}${X}`);
  console.log(`${B}${C}  VEYROZE UPLOADER v3 — ABSCHLUSS${X}`);
  console.log(`${B}${C}${line}${X}`);

  for (const p of products) {
    const ki    = p.ki || {};
    const title = [ki.marke, ki.modell, ki.groesse].filter(Boolean).join(' ') || p.label;
    const conf  = ki.confidence || '?';
    const color = conf === 'high' ? G : conf === 'medium' ? Y : R;
    const tag   = p.isReview ? `${Y}[REVIEW]${X}` : `${G}[OK]    ${X}`;
    console.log(`  ${tag} ${title.padEnd(32)} ${color}${conf}${X}  ${ki.preis_eur ?? '—'} EUR`);
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
