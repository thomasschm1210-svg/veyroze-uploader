import crypto from 'crypto';
import fs     from 'fs';

// In-memory Hash-Register für einen Lauf; persistiert als JSON-Datei über Läufe hinweg.
const REGISTRY_FILE = '.duplicate_registry.json';

let registry = {};   // hash → erster Dateipfad
let regPath  = null;

export function initRegistry(baseDir) {
  regPath  = `${baseDir}/${REGISTRY_FILE}`;
  registry = {};
  if (fs.existsSync(regPath)) {
    try { registry = JSON.parse(fs.readFileSync(regPath, 'utf8')); } catch { registry = {}; }
  }
}

function saveRegistry() {
  if (regPath) fs.writeFileSync(regPath, JSON.stringify(registry, null, 2));
}

// Schneller perceptual-ähnlicher Hash: 8×8 Graustufenbild → 64-Bit-String
// Verwendet sharp intern über Buffer-Rückgabe — kein extra Import nötig
// Hier: MD5 der ersten 8 KB reicht als schneller Duplikat-Check für identische Dateien
export function fileHash(filePath) {
  const fd  = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(8192);
  const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
  fs.closeSync(fd);
  const fullStat = fs.statSync(filePath);
  // Kombination aus Dateigröße + ersten 8 KB → extrem schnell, kollisionsarm für Fotos
  return crypto
    .createHash('md5')
    .update(buf.subarray(0, bytesRead))
    .update(String(fullStat.size))
    .digest('hex');
}

/**
 * Prüft ob eine Datei ein Duplikat ist.
 * @returns {{ isDuplicate: boolean, originalPath: string|null }}
 */
export function checkDuplicate(filePath) {
  const hash = fileHash(filePath);
  if (registry[hash]) {
    return { isDuplicate: true, originalPath: registry[hash] };
  }
  registry[hash] = filePath;
  saveRegistry();
  return { isDuplicate: false, originalPath: null };
}

export function resetRegistry(baseDir) {
  regPath  = `${baseDir}/${REGISTRY_FILE}`;
  registry = {};
  if (fs.existsSync(regPath)) fs.unlinkSync(regPath);
}
