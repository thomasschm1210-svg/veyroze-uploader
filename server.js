import 'dotenv/config';
import express from 'express';
import multer  from 'multer';
import path    from 'path';
import fs      from 'fs';
import { fileURLToPath } from 'url';
import { runPipeline } from './src/pipeline.js';
import { groupImages }  from './src/groupImages.js';
import { initRegistry } from './src/deduplicator.js';
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
    let groups;
    if (rawGroups?.length) {
      groups = rawGroups
        .map(g => g
          .map(name => path.join(runDir, name))
          .filter(p => fs.existsSync(p))
        )
        .filter(g => g.length > 0);
    } else {
      const { groups: g } = await groupImages(runDir);
      groups = g;
    }

    if (!groups.length) {
      sendEvent(runId, 'error', { msg: 'Keine Bilder verarbeitbar' });
      return;
    }

    sendEvent(runId, 'start', { groups: groups.length, images: groups.flat().length });

    initRegistry(runDir);

    const result = await runPipeline(groups, runDir, {
      separators: [],
      ProgressClass: makeProgressClass(runId),
      folderName: folderName || '',
    });

    const csvRel = result.csvPath
      ? `/api/csv/${runId}/${path.basename(result.csvPath)}`
      : null;

    // Convert absolute thumbnail paths → relative URLs served by /api/image/:runId/*
    const products = (result.products || []).map(p => ({
      ...p,
      thumbnail: p.thumbnail && fs.existsSync(p.thumbnail)
        ? `/api/image/${runId}/${path.relative(runDir, p.thumbnail).split(path.sep).join('/')}`
        : null,
      images: (p.images || []).filter(f => fs.existsSync(f)).map(f =>
        `/api/image/${runId}/${path.relative(runDir, f).split(path.sep).join('/')}`
      ),
      allImages: (p.allImages || []).filter(f => fs.existsSync(f)).map(f =>
        `/api/image/${runId}/${path.relative(runDir, f).split(path.sep).join('/')}`
      ),
      measurementImages: (p.measurementImages || []).filter(f => fs.existsSync(f)).map(f =>
        `/api/image/${runId}/${path.relative(runDir, f).split(path.sep).join('/')}`
      ),
    }));

    sendEvent(runId, 'done', { csvUrl: csvRel, stats: result.stats, products });
  } catch (err) {
    sendEvent(runId, 'error', { msg: err.message });
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
