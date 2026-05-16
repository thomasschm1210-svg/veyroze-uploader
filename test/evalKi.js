import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mockKiAnalyze } from '../src/ki.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_DIR  = process.env.EVAL_DIR || 'C:\\Users\\bittn\\Desktop\\Projekte\\Veyroze Bilder';
const RESULTS   = path.join(__dirname, 'results');

const G='\x1b[32m', R='\x1b[31m', Y='\x1b[33m', C='\x1b[36m';
const B='\x1b[1m',  D='\x1b[2m',  X='\x1b[0m';

const h    = t => console.log(`\n${B}${C}${t}${X}`);
const ok   = t => console.log(`  ${G}✓${X} ${t}`);
const bad  = t => console.log(`  ${R}✗${X} ${t}`);
const info = t => console.log(`  ${D}${t}${X}`);

const IMG_RE = /\.(jpe?g|png|webp)$/i;
const LABEL_RE = /^(.+?)\s*->\s*(.+?)\s*$/;
const HEADER_DELIM_RE = /^\\?---\s*$/;

const FIELD_KEYS = ['brand', 'model', 'size_w', 'size_l', 'country', 'sku',
                    'length_cm', 'waist_cm', 'leg_opening_cm'];
const TOL_CM = 1;

function unescapeMd(s) {
  return s.replace(/\\([_*\-])/g, '$1');
}

function parseGroundTruth(mdPath) {
  const lines = fs.readFileSync(mdPath, 'utf8').split(/\r?\n/);
  const labels = new Map();
  const header = {};
  let inHeader = false;
  let headerSeen = false;

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) continue;

    if (HEADER_DELIM_RE.test(line)) {
      if (!headerSeen) { inHeader = true; headerSeen = true; }
      else             { inHeader = false; }
      continue;
    }

    if (inHeader) {
      const cleaned = unescapeMd(line);
      const m = cleaned.match(/^([a-z_]+)\s*:\s*(.+?)\s*$/i);
      if (m) header[m[1].toLowerCase()] = m[2].trim();
      continue;
    }

    const labelMatch = line.match(LABEL_RE);
    if (!labelMatch) continue;
    const [, fileNoExt, rest] = labelMatch;
    const cleanRest = unescapeMd(rest);
    const noUpload  = /\(\s*nicht\s+hochladen\s*\)/i.test(cleanRest);
    const label     = cleanRest.replace(/\(.*\)\s*$/, '').trim().toLowerCase();
    labels.set(unescapeMd(fileNoExt).trim(), { label, shouldUpload: !noUpload });
  }
  return { labels, header };
}

function findImages(dir) {
  return fs.readdirSync(dir).filter(f => IMG_RE.test(f)).map(f => path.join(dir, f)).sort();
}
function findGroundTruthFile(dir) {
  return fs.readdirSync(dir).find(f => /^produkt.*\.md$/i.test(f));
}
function stripExt(filename) { return filename.replace(IMG_RE, ''); }

function classifyOutcome(gt, kiUploaded) {
  if (gt.shouldUpload && kiUploaded)   return 'TP';
  if (!gt.shouldUpload && !kiUploaded) return 'TN';
  if (!gt.shouldUpload && kiUploaded)  return 'FP';
  return 'FN';
}

function normStr(s) {
  if (s == null) return null;
  return String(s).toLowerCase().replace(/['’´`]/g, '').replace(/\s+/g, ' ').trim();
}
function normInt(s) {
  if (s == null) return null;
  const n = parseInt(String(s).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
function normSku(s) {
  if (s == null) return null;
  const t = String(s).trim();
  return /^\d{5}$/.test(t) ? t : null;
}
function normFloat(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(',', '.').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
const withTolerance = (tol) => (gt, ki) => {
  const a = normFloat(gt), b = normFloat(ki);
  return a != null && b != null && Math.abs(a - b) <= tol;
};

const FIELD_COMPARATORS = {
  brand:          (gt, ki) => normStr(gt) === normStr(ki),
  model:          (gt, ki) => normStr(gt) === normStr(ki),
  size_w:         (gt, ki) => normInt(gt) != null && normInt(gt) === normInt(ki),
  size_l:         (gt, ki) => normInt(gt) != null && normInt(gt) === normInt(ki),
  country:        (gt, ki) => normStr(gt) === normStr(ki),
  sku:            (gt, ki) => normSku(gt) != null && normSku(gt) === normSku(ki),
  length_cm:      withTolerance(TOL_CM),
  waist_cm:       withTolerance(TOL_CM),
  leg_opening_cm: withTolerance(TOL_CM),
};

function getKiField(kiResult, field) {
  switch (field) {
    case 'brand':   return kiResult.marke;
    case 'model':   return kiResult.modell;
    case 'size_w':  return kiResult.size_w;
    case 'size_l':  return kiResult.size_l;
    case 'country': return kiResult.country_of_origin;
    case 'sku':     return kiResult.sku;
    case 'length_cm':      return kiResult.measurements?.length_cm;
    case 'waist_cm':       return kiResult.measurements?.waist_cm;
    case 'leg_opening_cm': return kiResult.measurements?.leg_opening_cm;
  }
}

function compareFields(header, kiResult) {
  const out = [];
  for (const field of FIELD_KEYS) {
    const expected = header[field];
    if (expected == null || expected === '') continue;
    const actual = getKiField(kiResult, field);
    const ok     = FIELD_COMPARATORS[field](expected, actual);
    out.push({ field, expected, actual: actual ?? '(null)', ok });
  }
  return out;
}

async function evalProduct(folderName, dir) {
  const gtFile = findGroundTruthFile(dir);
  if (!gtFile) { bad(`${folderName}: Keine Produkt*.md gefunden`); return null; }

  const { labels, header } = parseGroundTruth(path.join(dir, gtFile));
  const images = findImages(dir);
  if (!images.length) { bad(`${folderName}: Keine Bilder gefunden`); return null; }

  const headerCount = Object.keys(header).filter(k => FIELD_KEYS.includes(k)).length;
  info(`${images.length} Bilder, ${labels.size} Labels, ${headerCount} Header-Felder`);

  let kiResult;
  try { kiResult = await mockKiAnalyze(images, { folderName }); }
  catch (err) { bad(`${folderName}: KI-Aufruf fehlgeschlagen — ${err.message}`); return null; }

  const uploadedSet = new Set((kiResult.product_images || []).map(p => path.basename(p)));

  const imageRows = [];
  for (const imgPath of images) {
    const base    = path.basename(imgPath);
    const noExt   = stripExt(base);
    const gtEntry = labels.get(noExt);
    if (!gtEntry) { info(`  ? ${base} — kein Ground-Truth-Label, übersprungen`); continue; }
    const kiUploaded = uploadedSet.has(base);
    const outcome    = classifyOutcome(gtEntry, kiUploaded);
    imageRows.push({ file: base, label: gtEntry.label, shouldUpload: gtEntry.shouldUpload, kiUploaded, outcome });
  }

  const failedImages = imageRows.filter(r => r.outcome === 'FP' || r.outcome === 'FN');
  if (failedImages.length === 0) {
    info(`  Bilder: ${G}alle ${imageRows.length} korrekt${X}`);
  } else {
    for (const r of failedImages) {
      const want = r.shouldUpload ? 'upload' : 'filter';
      const got  = r.kiUploaded   ? 'upload' : 'filter';
      console.log(`  ${R}✗${X} ${D}${r.file}${X} — ${r.label} want=${want} got=${got}`);
    }
  }

  const fieldRows = compareFields(header, kiResult);
  if (fieldRows.length) {
    const failedFields = fieldRows.filter(f => !f.ok);
    if (failedFields.length === 0) {
      info(`  Felder: ${G}alle ${fieldRows.length} korrekt${X}`);
    } else {
      for (const f of fieldRows) {
        if (f.ok) continue;
        console.log(`  ${R}✗${X} ${f.field.padEnd(8)} expected=${B}${f.expected}${X} got=${R}${f.actual}${X}`);
      }
    }
  }

  return { folderName, dir, imageRows, fieldRows, brand: kiResult.marke, fit: kiResult.fit };
}

function aggregate(results) {
  const allImg = results.flatMap(r => r.imageRows);
  const allFld = results.flatMap(r => r.fieldRows.map(f => ({ ...f, folder: r.folderName })));

  const imgTotal   = allImg.length;
  const imgCorrect = allImg.filter(r => r.outcome === 'TP' || r.outcome === 'TN').length;

  const byLabel = {};
  for (const r of allImg) {
    const e = byLabel[r.label] ??= { total: 0, correct: 0, fp: 0, fn: 0 };
    e.total++;
    if (r.outcome === 'TP' || r.outcome === 'TN') e.correct++;
    if (r.outcome === 'FP') e.fp++;
    if (r.outcome === 'FN') e.fn++;
  }

  const byField = {};
  for (const f of allFld) {
    const e = byField[f.field] ??= { total: 0, correct: 0, failures: [] };
    e.total++;
    if (f.ok) e.correct++;
    else      e.failures.push(f);
  }

  return {
    imgTotal, imgCorrect, imgAccuracy: imgTotal ? imgCorrect / imgTotal : 0,
    fldTotal: allFld.length, fldCorrect: allFld.filter(f => f.ok).length,
    fldAccuracy: allFld.length ? allFld.filter(f => f.ok).length / allFld.length : 0,
    byLabel, byField,
  };
}

function printSummary(agg) {
  h('Per-Label-Metriken (Bildklassifikation)');
  for (const lbl of Object.keys(agg.byLabel).sort()) {
    const e = agg.byLabel[lbl];
    const pct = Math.round((e.correct / e.total) * 100);
    const color = pct >= 95 ? G : pct >= 75 ? Y : R;
    const extras = [];
    if (e.fp) extras.push(`${e.fp}× FP`);
    if (e.fn) extras.push(`${e.fn}× FN`);
    const tail = extras.length ? `  ${D}— ${extras.join(', ')}${X}` : '';
    console.log(`  ${color}${pct.toString().padStart(3)}%${X} ${lbl.padEnd(24)} ${e.correct}/${e.total}${tail}`);
  }

  h('Per-Feld-Metriken (Datenextraktion)');
  if (!Object.keys(agg.byField).length) {
    info('Keine Header-Felder ausgewertet');
  } else {
    for (const fld of FIELD_KEYS) {
      const e = agg.byField[fld];
      if (!e) continue;
      const pct = Math.round((e.correct / e.total) * 100);
      const color = pct >= 95 ? G : pct >= 75 ? Y : R;
      const fail = e.failures.length
        ? `  ${D}— ${e.failures.map(f => `[${f.folder}] erwartet ${f.expected}, bekommen ${f.actual}`).join('; ')}${X}`
        : '';
      console.log(`  ${color}${pct.toString().padStart(3)}%${X} ${fld.padEnd(10)} ${e.correct}/${e.total}${fail}`);
    }
  }

  h('Gesamt');
  const imgPct = Math.round(agg.imgAccuracy * 100);
  const fldPct = Math.round(agg.fldAccuracy * 100);
  const cImg = imgPct >= 95 ? G : imgPct >= 75 ? Y : R;
  const cFld = fldPct >= 95 ? G : fldPct >= 75 ? Y : R;
  console.log(`  ${B}Bilder:${X} ${cImg}${imgPct}%${X} (${agg.imgCorrect}/${agg.imgTotal})`);
  console.log(`  ${B}Felder:${X} ${cFld}${fldPct}%${X} (${agg.fldCorrect}/${agg.fldTotal})`);
}

function saveSnapshot(agg, results) {
  fs.mkdirSync(RESULTS, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(RESULTS, `eval-${ts}.json`);
  const payload = {
    timestamp: new Date().toISOString(),
    imgAccuracy: agg.imgAccuracy,
    fldAccuracy: agg.fldAccuracy,
    totals: { imgTotal: agg.imgTotal, imgCorrect: agg.imgCorrect, fldTotal: agg.fldTotal, fldCorrect: agg.fldCorrect },
    byLabel: agg.byLabel,
    byField: agg.byField,
    products: results.map(r => ({ folder: r.folderName, brand: r.brand, fit: r.fit, imageRows: r.imageRows, fieldRows: r.fieldRows })),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  info(`Snapshot: ${path.relative(process.cwd(), file)}`);
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error(`${R}GEMINI_API_KEY fehlt in .env${X}`);
    process.exit(1);
  }
  if (!fs.existsSync(EVAL_DIR)) {
    console.error(`${R}EVAL_DIR existiert nicht: ${EVAL_DIR}${X}`);
    process.exit(1);
  }

  h('KI-Eval (Bildklassifikation + Datenextraktion)');
  info(`Quelle: ${EVAL_DIR}`);

  const folders = fs.readdirSync(EVAL_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({ name: d.name, path: path.join(EVAL_DIR, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));

  const results = [];
  for (const f of folders) {
    h(`Produkt: ${f.name}`);
    const r = await evalProduct(f.name, f.path);
    if (r) results.push(r);
  }

  if (!results.length) { console.error(`${R}Keine auswertbaren Produkte${X}`); process.exit(1); }

  const agg = aggregate(results);
  printSummary(agg, results);
  saveSnapshot(agg, results);
}

main().catch(err => {
  console.error(`${R}Eval crashed:${X}`, err);
  process.exit(1);
});
