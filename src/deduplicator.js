import crypto from 'crypto';
import fs     from 'fs';
import fsp    from 'fs/promises';

// In-memory Hash-Register für einen Lauf; persistiert als JSON-Datei über Läufe hinweg.
const REGISTRY_FILE = '.duplicate_registry.json';

let registry = {};   // hash → erster Dateipfad
let regPath  = null;
let dirty    = false;

export function initRegistry(baseDir) {
  regPath  = `${baseDir}/${REGISTRY_FILE}`;
  registry = {};
  dirty    = false;
  if (fs.existsSync(regPath)) {
    try { registry = JSON.parse(fs.readFileSync(regPath, 'utf8')); } catch { registry = {}; }
  }
}

// Einmalige Persistierung am Ende eines Laufs — innerhalb von Phase 2 nur Memory.
export function flushRegistry() {
  if (regPath && dirty) {
    fs.writeFileSync(regPath, JSON.stringify(registry, null, 2));
    dirty = false;
  }
}

// MD5 der ersten 8 KB + Dateigröße — kollisionsarm für Fotos, sehr günstig.
export function fileHash(filePath) {
  const fd  = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(8192);
  const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
  fs.closeSync(fd);
  const fullStat = fs.statSync(filePath);
  return crypto
    .createHash('md5')
    .update(buf.subarray(0, bytesRead))
    .update(String(fullStat.size))
    .digest('hex');
}

// Async-Variante: erlaubt paralleles Hashing über Promise.all,
// ohne den Event-Loop pro Datei zu blockieren.
export async function fileHashAsync(filePath) {
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, 8192, 0);
    const { size } = await fh.stat();
    return crypto
      .createHash('md5')
      .update(buf.subarray(0, bytesRead))
      .update(String(size))
      .digest('hex');
  } finally {
    await fh.close();
  }
}

/**
 * Prüft ob eine Datei ein Duplikat ist.
 * @param {string} filePath
 * @param {string} [precomputedHash] optional vorberechneter Hash (spart sync I/O im Hot-Path)
 * @returns {{ isDuplicate: boolean, originalPath: string|null }}
 */
export function checkDuplicate(filePath, precomputedHash = null) {
  const hash = precomputedHash ?? fileHash(filePath);
  if (registry[hash]) {
    return { isDuplicate: true, originalPath: registry[hash] };
  }
  registry[hash] = filePath;
  dirty = true;
  return { isDuplicate: false, originalPath: null };
}

export function resetRegistry(baseDir) {
  regPath  = `${baseDir}/${REGISTRY_FILE}`;
  registry = {};
  dirty    = false;
  if (fs.existsSync(regPath)) fs.unlinkSync(regPath);
}
