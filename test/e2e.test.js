/**
 * End-to-End Test v3 — volle Pipeline inkl. Deduplicator, Compressor, FileRouter, RunLogger.
 */

import path    from 'path';
import fs      from 'fs';
import { fileURLToPath } from 'url';

import { generateTestImages, GROUND_TRUTH } from './generateTestImages.js';
import { isSeparator }    from '../src/separatorDetector.js';
import { groupImages }    from '../src/groupImages.js';
import { runPipeline }    from '../src/pipeline.js';
import { initRegistry, resetRegistry } from '../src/deduplicator.js';
import { terminateOCR }   from '../src/ocr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES  = path.join(__dirname, 'fixtures');
const RESULTS   = path.join(__dirname, 'results');

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m';
const B = '\x1b[1m',  D = '\x1b[2m',  X = '\x1b[0m';

function h(t)    { console.log(`\n${B}${C}${t}${X}`); }
function ok(t)   { console.log(`  ${G}✓${X} ${t}`); }
function fail(t) { console.log(`  ${R}✗${X} ${t}`); }
function info(t) { console.log(`  ${D}${t}${X}`); }
function bar(n, total, w = 30) {
  const f = total > 0 ? Math.round((n / total) * w) : 0;
  return `[${G}${'█'.repeat(f)}${X}${'░'.repeat(w - f)}] ${n}/${total}`;
}

function norm(v) { return String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function fuzzy(a, e) {
  if (!e) return true;
  return norm(a) === norm(e) || norm(a).includes(norm(e)) || norm(e).includes(norm(a));
}

function expectedGroups() {
  const groups = []; let cur = [];
  for (const e of GROUND_TRUTH) {
    if (e.separator) { if (cur.length) { groups.push(cur); cur = []; } }
    else cur.push(e);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function testSeparator() {
  h('TEST 1 — Trennbild-Erkennung');
  const seps  = GROUND_TRUTH.filter(e => e.separator).map(e => path.join(FIXTURES, e.file));
  const prods = GROUND_TRUTH.filter(e => !e.separator).map(e => path.join(FIXTURES, e.file));
  let correct = 0;

  for (const f of seps) {
    const r = await isSeparator(f, 'trenner');
    r ? (correct++, ok(`${path.basename(f)} → Separator`)) : fail(`${path.basename(f)} → MISS`);
  }
  for (const f of prods) {
    const r = await isSeparator(f, 'trenner');
    !r ? (correct++, ok(`${path.basename(f)} → Produkt`)) : fail(`${path.basename(f)} → False Positive`);
  }
  const total = seps.length + prods.length;
  console.log(`\n  ${bar(correct, total)}`);
  return { name: 'Trennbild-Erkennung', correct, total };
}

async function testGrouping() {
  h('TEST 2 — Bildgruppierung');
  const { groups, separators } = await groupImages(FIXTURES, 'trenner');
  const expected = expectedGroups();

  info(`Erwartet: ${expected.length} Gruppen  |  Gefunden: ${groups.length}  |  Separatoren: ${separators.length}`);

  let correct = 0;
  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i].length, got = groups[i]?.length ?? 0;
    exp === got
      ? (correct++, ok(`Gruppe ${i+1}: ${got} Bilder`))
      : fail(`Gruppe ${i+1}: erwartet ${exp}, gefunden ${got}`);
  }
  console.log(`\n  ${bar(correct, expected.length)}`);
  return { name: 'Bildgruppierung', correct, total: expected.length };
}

async function testFullPipeline() {
  h('TEST 3 — Volle Pipeline (Dedup · Compress · OCR · CSV · Logs)');

  // Frisches Verzeichnis für Pipeline-Lauf
  const runDir = path.join(RESULTS, 'pipeline_run');
  if (fs.existsSync(runDir)) fs.rmSync(runDir, { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });

  // Fixtures nach runDir kopieren
  fs.readdirSync(FIXTURES).forEach(f => {
    fs.copyFileSync(path.join(FIXTURES, f), path.join(runDir, f));
  });

  resetRegistry(runDir);
  initRegistry(runDir);

  const { groups, separators } = await groupImages(runDir, 'trenner');
  info(`Gruppen: ${groups.length}  |  Separatoren: ${separators.length}`);

  const { csvPath, logPath, stats } = await runPipeline(groups, runDir, { separators });

  // ── Subtest A: Ordnerstruktur ──
  h('  A) Ordnerstruktur');
  const checks = [
    ['_verarbeitet',  fs.existsSync(path.join(runDir, '_verarbeitet'))],
    ['_review',       fs.existsSync(path.join(runDir, '_review'))],
    ['_fehler',       fs.existsSync(path.join(runDir, '_fehler'))],
    ['_duplikate',    fs.existsSync(path.join(runDir, '_duplikate'))],
    ['_logs',         fs.existsSync(path.join(runDir, '_logs'))],
  ];
  let structOk = 0;
  checks.forEach(([name, exists]) => {
    exists ? (structOk++, ok(name + '/')) : fail(name + '/ fehlt');
  });

  // ── Subtest B: CSV vorhanden ──
  h('  B) CSV-Export');
  const csvExists  = csvPath && fs.existsSync(csvPath);
  const csvContent = csvExists ? fs.readFileSync(csvPath, 'utf8') : '';
  const csvLines   = csvContent.split('\n').filter(Boolean);
  csvExists ? ok(`CSV vorhanden: ${path.basename(csvPath)}`) : fail('CSV fehlt');
  info(`CSV: ${csvLines.length - 1} Produkt-Zeilen`);
  let csvOk = csvExists ? 1 : 0;

  // ── Subtest C: Log-Datei ──
  h('  C) Log-Datei');
  const logExists  = logPath && fs.existsSync(logPath);
  const logContent = logExists ? fs.readFileSync(logPath, 'utf8') : '';
  logExists ? ok(`Log vorhanden: ${path.basename(logPath)}`) : fail('Log fehlt');
  const logHasSummary = logContent.includes('ZUSAMMENFASSUNG');
  logHasSummary ? ok('Log enthält ZUSAMMENFASSUNG') : fail('ZUSAMMENFASSUNG fehlt im Log');
  let logOk = (logExists ? 1 : 0) + (logHasSummary ? 1 : 0);

  // ── Subtest D: Duplikat-Erkennung ──
  h('  D) Duplikat-Erkennung');
  // Duplikat simulieren: eine Fixture zweimal kopieren
  const dupDir = path.join(RESULTS, 'dup_test');
  if (fs.existsSync(dupDir)) fs.rmSync(dupDir, { recursive: true });
  fs.mkdirSync(dupDir, { recursive: true });

  const src = path.join(FIXTURES, '001_nike_airmax_front.jpg');
  fs.copyFileSync(src, path.join(dupDir, '001_original.jpg'));
  fs.copyFileSync(src, path.join(dupDir, '002_duplikat.jpg'));
  // Trenner damit wir Gruppen haben
  const sep = path.join(FIXTURES, '003_trenner.jpg');
  fs.copyFileSync(sep, path.join(dupDir, '003_trenner.jpg'));

  resetRegistry(dupDir);
  initRegistry(dupDir);

  const { groups: dupGroups, separators: dupSeps } = await groupImages(dupDir, 'trenner');
  const { stats: dupStats } = await runPipeline(dupGroups, dupDir, { separators: dupSeps });

  dupStats.duplicates > 0
    ? ok(`Duplikat erkannt (${dupStats.duplicates})`)
    : fail('Kein Duplikat erkannt');
  const dupOk = dupStats.duplicates > 0 ? 1 : 0;

  // ── Subtest E: Statistiken ──
  h('  E) Pipeline-Statistiken');
  info(`Verarbeitet: ${stats.processed}`);
  info(`Review:      ${stats.reviewItems}`);
  info(`Fehler:      ${stats.errors}`);
  info(`Duplikate:   ${stats.duplicates}`);
  info(`Gespart:     ${stats.savedMB} MB`);

  const totalSubs = checks.length + 1 + 2 + 1;
  const correctSubs = structOk + csvOk + logOk + dupOk;
  console.log(`\n  ${bar(correctSubs, totalSubs)}`);
  return { name: 'Volle Pipeline', correct: correctSubs, total: totalSubs };
}

// ─── Finalauswertung ─────────────────────────────────────────────────────────

function report(results) {
  const line = '═'.repeat(54);
  console.log(`\n${B}${C}${line}${X}`);
  console.log(`${B}${C}  GESAMTERGEBNIS${X}`);
  console.log(`${B}${C}${line}${X}`);
  let gc = 0, gt = 0;
  for (const t of results) {
    const pct = Math.round((t.correct / t.total) * 100);
    const col = pct >= 80 ? G : pct >= 50 ? Y : R;
    const lbl = pct >= 80 ? 'BESTANDEN' : pct >= 50 ? 'TEILWEISE' : 'FEHLER';
    console.log(`  ${col}${lbl.padEnd(10)}${X} ${t.name.padEnd(22)} ${col}${pct}%${X}`);
    gc += t.correct; gt += t.total;
  }
  const overall = Math.round((gc / gt) * 100);
  const col = overall >= 80 ? G : overall >= 50 ? Y : R;
  console.log(`${B}${C}${line}${X}`);
  console.log(`  ${B}GESAMT                         ${col}${overall}%${X}`);
  console.log(`${B}${C}${line}${X}\n`);
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${B}${C}╔══════════════════════════════════════════════╗${X}`);
  console.log(`${B}${C}║   VEYROZE v3 — END-TO-END TEST               ║${X}`);
  console.log(`${B}${C}╚══════════════════════════════════════════════╝${X}`);

  h('SCHRITT 0 — Testbilder generieren');
  fs.mkdirSync(RESULTS, { recursive: true });
  await generateTestImages();
  ok(`${GROUND_TRUTH.length} Bilder → ${FIXTURES}`);

  const results = [];
  results.push(await testSeparator());
  results.push(await testGrouping());
  results.push(await testFullPipeline());
  report(results);

  await terminateOCR();
}

run().catch(async err => {
  console.error(`\n${R}FEHLER:${X}`, err.message, '\n', err.stack);
  await terminateOCR();
  process.exit(1);
});
