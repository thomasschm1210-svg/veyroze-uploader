import 'dotenv/config';
import express from 'express';
import multer  from 'multer';
import path    from 'path';
import fs      from 'fs';
import { fileURLToPath } from 'url';
import { runPipeline } from './src/pipeline.js';
import { groupImages }  from './src/groupImages.js';
import { initRegistry } from './src/deduplicator.js';
import { createShopifyDraft } from './src/shopify.js';
import { securityCheck, securityHeaders } from './src/security/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(securityHeaders());
app.use(express.static(PUBLIC_DIR));


// ── SSE clients keyed by runId ──────────────────────────────────────────────
const sseClients = new Map();

app.get('/api/progress/:runId', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  sseClients.set(req.params.runId, res);
  req.on('close', () => sseClients.delete(req.params.runId));
});

function sendEvent(runId, event, data) {
  const client = sseClients.get(runId);
  if (client) client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function makeProgressClass(runId) {
  return class {
    constructor(total, label) {
      this._n = 0; this._total = total; this._label = label;
    }
    setPhase(phase) { sendEvent(runId, 'phase', { phase }); }
    tick(msg) {
      this._n++;
      sendEvent(runId, 'progress', {
        label: this._label, done: this._n, total: this._total,
        msg: String(msg || ''), pct: Math.round((this._n / this._total) * 100),
      });
    }
    done() { sendEvent(runId, 'phase-done', { label: this._label }); }
  };
}

// ── Serve uploaded/processed images ───────────────────────────────────────
app.get('/api/image/:runId/*path', async (req, res) => {
  const imgPath = [].concat(req.params.path).join('/');
  const sec = await securityCheck({ phase: 'http', ip: req.ip, path: imgPath });
  if (sec.block) return res.status(sec.status).json(sec.body);

  const abs  = path.join(UPLOAD_DIR, req.params.runId, imgPath);
  const safe = path.resolve(abs);
  if (!safe.startsWith(path.resolve(UPLOAD_DIR))) return res.status(403).end();
  if (!fs.existsSync(safe)) return res.status(404).end();
  res.sendFile(safe);
});

// ── Multer: Bilder in runId-Unterordner ────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, req.body.runId || 'default');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const dir   = path.join(UPLOAD_DIR, req.body.runId || 'default');
    let name = safe;
    let counter = 1;
    while (fs.existsSync(path.join(dir, name))) {
      const ext = path.extname(safe);
      name = `${path.basename(safe, ext)}_${counter++}${ext}`;
    }
    cb(null, name);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ── POST /api/upload ──────────────────────────────────────────────────────
app.post('/api/upload', upload.array('images'), async (req, res) => {
  const secHttp = await securityCheck({ phase: 'http', ip: req.ip });
  if (secHttp.block) return res.status(secHttp.status).json(secHttp.body);

  if (!req.files?.length) return res.status(400).json({ error: 'Keine Bilder' });
  res.json({
    count: req.files.length,
    runId: req.body.runId,
    files: req.files.map(f => f.filename),
  });
});

// ── POST /api/run ─────────────────────────────────────────────────────────
app.post('/api/run', express.json(), async (req, res) => {
  const secHttp = await securityCheck({ phase: 'http', ip: req.ip });
  if (secHttp.block) return res.status(secHttp.status).json(secHttp.body);

  const { runId, groups: rawGroups, folderName } = req.body;
  if (!runId) return res.status(400).json({ error: 'runId fehlt' });

  const runDir = path.join(UPLOAD_DIR, runId);
  if (!fs.existsSync(runDir)) return res.status(400).json({ error: 'runDir nicht gefunden' });

  res.json({ started: true });

  try {
    let flatImages;
    if (rawGroups?.length) {
      flatImages = rawGroups.flat()
        .map(name => path.join(runDir, name))
        .filter(p => fs.existsSync(p));
    } else {
      const { groups: g } = await groupImages(runDir);
      flatImages = g.flat();
    }

    if (!flatImages.length) {
      sendEvent(runId, 'error', { msg: 'Keine Bilder verarbeitbar' });
      return;
    }

    sendEvent(runId, 'start', { images: flatImages.length });

    initRegistry(runDir);

    const toUrl = (f) => f && fs.existsSync(f)
      ? `/api/image/${runId}/${path.relative(runDir, f).split(path.sep).join('/')}`
      : null;

    const mapPaths = (p) => ({
      ...p,
      thumbnail: toUrl(p.thumbnail),
      images: (p.images || []).map(toUrl).filter(Boolean),
      allImages: (p.allImages || []).map(toUrl).filter(Boolean),
      measurementImages: (p.measurementImages || []).map(toUrl).filter(Boolean),
    });

    const result = await runPipeline(flatImages, runDir, {
      ProgressClass: makeProgressClass(runId),
      folderName: folderName || '',
      onProduct: (p) => sendEvent(runId, 'product-complete', mapPaths(p)),
    });

    const csvRel = result.csvPath
      ? `/api/csv/${runId}/${path.basename(result.csvPath)}`
      : null;

    const products = (result.products || []).map(mapPaths).map(p => ({
      sku:        p.sku,
      imageCount: p.images.length,
      images:     p.images,
      aiData:     p.ki,
      index:      p.index,
      label:      p.label,
      thumbnail:  p.thumbnail,
      allImages:  p.allImages,
      measurementImages: p.measurementImages,
      ki:         p.ki,
      isReview:   p.isReview,
    }));

    const totalImages = products.reduce((s, p) => s + p.imageCount, 0);
    sendEvent(runId, 'done', {
      csvUrl: csvRel,
      stats:  result.stats,
      products,
      totalProducts: products.length,
      totalImages,
    });
  } catch (err) {
    sendEvent(runId, 'error', { msg: err.message });
  }
});

// ── POST /api/shopify/:runId/:productIdx ──────────────────────────────────
app.post('/api/shopify/:runId/:productIdx', express.json(), async (req, res) => {
  const { runId, productIdx } = req.params;
  const shop  = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_TOKEN;

  if (!shop || !token) {
    return res.status(500).json({ error: 'SHOPIFY_SHOP oder SHOPIFY_TOKEN fehlt in .env' });
  }

  const { product } = req.body;
  if (!product) return res.status(400).json({ error: 'product-Daten fehlen im Body' });

  const runDir = path.join(UPLOAD_DIR, runId);
  const imageFiles = (product.images || []).map(url => {
    const rel = url.replace(`/api/image/${runId}/`, '');
    return path.join(runDir, rel);
  }).filter(p => fs.existsSync(p));

  try {
    const result = await createShopifyDraft(product, imageFiles, shop, token);
    res.json({ ok: true, shopifyId: result.id, title: result.title, url: result.url, warnings: result.warnings || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/csv/:runId/:file ─────────────────────────────────────────────
app.get('/api/csv/:runId/:file', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.runId, '_logs', req.params.file);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.download(filePath);
});

const PORT = process.env.PORT || 3737;
app.listen(PORT, () => {
  console.log(`Veyroze running at http://localhost:${PORT}`);
});
