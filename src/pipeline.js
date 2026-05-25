import path from 'path';

import { log }                  from './logger.js';
import { Progress }             from './progress.js';
import { securityCheck }        from './security/index.js';
import { checkDuplicate, fileHashAsync, flushRegistry } from './deduplicator.js';
import { compressGroup }        from './compressor.js';
import { mockKiAnalyze }        from './ki.js';
import { exportToCSV }          from './csvExport.js';
import { FileRouter }           from './fileRouter.js';
import { RunLogger }            from './runLogger.js';
import { groupImagesBySeparator } from './groupImages.js';

const KI_CONCURRENCY = 10;

async function withConcurrency(fns, limit) {
  const results = new Array(fns.length);
  let next = 0;
  async function worker() {
    while (next < fns.length) {
      const i = next++;
      results[i] = await fns[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, worker));
  return results;
}

export async function runPipeline(allImages, baseDir, opts = {}) {
  const ProgressClass = opts.ProgressClass ?? Progress;
  const ts     = Date.now();
  const router = new FileRouter(baseDir);
  const logger = new RunLogger(router.logPath(ts));

  const flat = Array.isArray(allImages[0]) ? allImages.flat() : allImages;
  logger.stats.totalImages = flat.length;
  logger.info(`Start: ${flat.length} Bild(er) — Auto-Trennbild-Erkennung aktiv`);

  const secUpload = await securityCheck({ phase: 'upload', imageFiles: flat.map(p => ({ path: p })) });
  if (secUpload.block) throw new Error(secUpload.body.error.message);

  // ── Phase 1: Trennbilder erkennen + Gruppierung ─────────────────────────────
  log.header(`PHASE 1 / 4  Trennbilder erkennen (${flat.length} Bilder)`);
  const progSep = new ProgressClass(flat.length, 'Trennbilder');
  progSep.setPhase('Trennbilder');

  let lastDone = 0;
  const { groups: detected, items: sepItems } = await groupImagesBySeparator(flat, (done, total, name) => {
    const delta = done - lastDone;
    lastDone = done;
    if (delta <= 0) return;
    for (let k = 0; k < delta; k++) {
      progSep.tick(k === delta - 1 ? `${name} (${done}/${total})` : '');
    }
  });
  progSep.done();
  logger.separators(sepItems, detected);
  log.success(`${detected.length} Produkt(e) erkannt`);

  // Sanity-Warnungen für die Konsole — alle Details stehen im Audit-Block im Log
  const totalChunks  = new Set(sepItems.map(it => it.chunkIndex).filter(i => i != null)).size;
  const failedChunks = new Set(sepItems.filter(it => it.chunkFailed).map(it => it.chunkIndex));
  if (failedChunks.size > 0) {
    log.warn(`Trennbild-Erkennung: ${failedChunks.size} Chunk(s) fehlgeschlagen — siehe Log`);
  }
  // Wenn JEDER Chunk gefailed ist und die Ursache ein Quota-Hinweis (429) war → früh abbrechen.
  if (totalChunks > 0 && failedChunks.size === totalChunks) {
    const reasons = sepItems.map(it => it.failReason || '').join(' | ');
    if (/429|Too Many Requests|quota|Tageslimit/i.test(reasons)) {
      throw new Error('Gemini-API Tageslimit erreicht (Free-Tier: 20 Requests/Tag pro Modell). Bitte später erneut versuchen oder Billing in Google AI Studio aktivieren.');
    }
  }
  const suspicious = detected.filter(g => {
    const tCount = g.productImages.filter(p =>
      sepItems.find(it => it.path === p)?.isSeparator
    ).length;
    return tCount !== 1 || String(g.sku).startsWith('UNKNOWN_');
  });
  if (suspicious.length > 0) {
    log.warn(`Trennbild-Erkennung: ${suspicious.length} verdächtige Gruppe(n) — siehe Log`);
  }

  const groups = detected.map(g => g.productImages).filter(g => g.length > 0);
  const skuByGroupIndex = detected.filter(g => g.productImages.length > 0).map(g => g.sku);

  if (groups.length === 0) {
    log.warn('Keine Produktfotos nach Trennbild-Erkennung übrig');
    const stats = logger.finalize(null);
    return { csvPath: null, logPath: logger.path, stats, products: [] };
  }

  // ── Phase 2: Duplikate herausfiltern ────────────────────────────────────────
  const flatForDedup = groups.flat();
  const dupTotal = flatForDedup.length;
  log.header(`PHASE 2 / 4  Duplikate prüfen (${dupTotal} Bilder)`);
  const prog1 = new ProgressClass(dupTotal, 'Duplikate');
  prog1.setPhase('Duplikate');
  const cleanGroups = [];
  const cleanSkus   = [];

  // Hashes parallel berechnen — sync I/O würde den Event-Loop pro Datei blockieren.
  const hashList = await Promise.all(flatForDedup.map(f => fileHashAsync(f).catch(() => null)));
  const hashByFile = new Map(flatForDedup.map((f, i) => [f, hashList[i]]));

  for (let gi = 0; gi < groups.length; gi++) {
    const clean = [];
    for (const f of groups[gi]) {
      const { isDuplicate, originalPath } = checkDuplicate(f, hashByFile.get(f));
      if (isDuplicate) {
        router.moveToDuplicate(f, originalPath);
        logger.duplicate(f, originalPath);
        log.warn(`  Duplikat übersprungen: ${path.basename(f)}`);
      } else {
        clean.push(f);
      }
      prog1.tick(path.basename(f));
    }
    if (clean.length > 0) {
      cleanGroups.push(clean);
      cleanSkus.push(skuByGroupIndex[gi]);
    }
  }
  flushRegistry();
  prog1.done();

  // ── Phase 3 + 4: Komprimieren → KI (Fließband, alle Produkte parallel) ──────
  log.header(`PHASE 3 / 4  Komprimieren & KI (${cleanGroups.length} Produkte)`);
  const prog2    = new ProgressClass(cleanGroups.length, 'Komprimieren');
  const prog3    = new ProgressClass(cleanGroups.length || 1, 'KI-Analyse');
  prog2.setPhase('Komprimieren');
  let totalSavedMB = 0;
  let kiPhaseSet   = false;

  const taskFns = cleanGroups.map((group, i) =>
    async () => {
      const sku        = cleanSkus[i];
      const groupLabel = sku && !sku.startsWith('UNKNOWN_')
        ? `produkt-${sku}`
        : `produkt-${String(i + 1).padStart(3, '0')}`;

      if (!kiPhaseSet) { kiPhaseSet = true; prog3.setPhase('KI-Analyse'); }

      const secKi = await securityCheck({ phase: 'ki', ocrText: '' });
      if (secKi.block) {
        log.warn(`  KI übersprungen (Sicherheitsprüfung): ${groupLabel}`);
        prog2.tick('blockiert');
        prog3.tick(groupLabel);
        return null;
      }

      // Kompression und KI lesen unabhängig vom selben Pfad — parallel laufen lassen
      const [compRes, kiRes] = await Promise.allSettled([
        compressGroup(group),
        mockKiAnalyze(group, { folderName: opts.folderName || '', sku }),
      ]);

      const compStats = compRes.status === 'fulfilled' ? compRes.value : { savedMB: '0' };
      totalSavedMB += parseFloat(compStats.savedMB);
      prog2.tick(`gespart: ${compStats.savedMB} MB`);

      if (kiRes.status === 'rejected') {
        const err = kiRes.reason;
        for (const f of group) {
          router.moveToError(f, err.message);
          logger.errorItem(f, err.message);
        }
        prog3.tick(`[FEHLER] ${groupLabel}`);
        return { __failed: true, error: err };
      }
      const ki = kiRes.value;

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

      const groupIdx = new Map(group.map((f, idx) => [f, idx]));
      const remap = paths => (paths || []).map(f => finalPaths[groupIdx.get(f)]).filter(Boolean);
      const productImages = ki.product_images?.length ? remap(ki.product_images) : finalPaths;
      prog3.tick(ki.titel_vorschlag);

      const product = {
        index: i + 1,
        label: groupLabel,
        sku,
        thumbnail: productImages[0] || null,
        images: productImages,
        allImages: finalPaths,
        measurementImages: remap(ki.measurement_images),
        ki,
        isReview,
      };
      opts.onProduct?.(product);
      return product;
    }
  );

  const allResults = await withConcurrency(taskFns, KI_CONCURRENCY);
  const failures   = allResults.filter(r => r && r.__failed);
  const products   = allResults.filter(r => r && !r.__failed);

  // Wenn ALLE Gruppen mit Quota-Fehler gescheitert sind, brechen wir mit klarer Message ab.
  // Sonst sieht der User nur "0 Produkte erkannt" und denkt es sei ein Bug.
  if (products.length === 0 && failures.length > 0) {
    const quotaFails = failures.filter(f => f.error?.isQuotaError || /Tageslimit|quota|429/i.test(f.error?.message || ''));
    if (quotaFails.length === failures.length) {
      throw new Error('Gemini-API Tageslimit erreicht (Free-Tier: 20 Requests/Tag pro Modell). Bitte später erneut versuchen oder Billing in Google AI Studio aktivieren.');
    }
  }
  prog2.done();
  prog3.done();
  logger.stats.savedMB = totalSavedMB.toFixed(1);
  log.success(`Komprimierung: ${totalSavedMB.toFixed(1)} MB gespart`);

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
