import crypto from 'crypto';
import fs     from 'fs';
import { RULES } from './rules.js';

const EXT_MIME = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

// ip → { count, resetAt }
const RL_STORE = new Map();

// Daily KI call budget — resets at midnight UTC
let kiDayBudget = { count: 0, date: new Date().toISOString().slice(0, 10) };

export function checkKiBudget() {
  const today = new Date().toISOString().slice(0, 10);
  if (kiDayBudget.date !== today) {
    kiDayBudget = { count: 0, date: today };
  }
  if (kiDayBudget.count >= RULES.rateLimit.maxKiCallsPerDay) {
    return { allowed: false };
  }
  kiDayBudget.count++;
  return { allowed: true, remaining: RULES.rateLimit.maxKiCallsPerDay - kiDayBudget.count };
}

export function validateAccessToken(token) {
  const expected = process.env.ACCESS_TOKEN;
  if (!expected) return true;
  if (!token || token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export function mimeFromPath(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}

export function validateImageFile(filePath, sizeBytes, mimeType) {
  const errors = [];
  const maxBytes = RULES.upload.maxFileSizeMb * 1024 * 1024;

  if (sizeBytes > maxBytes) {
    errors.push(`Datei zu groß: ${(sizeBytes / 1024 / 1024).toFixed(1)} MB (max ${RULES.upload.maxFileSizeMb} MB)`);
  }
  if (!RULES.upload.allowedMimeTypes.includes(mimeType)) {
    errors.push(`Ungültiger Dateityp: ${mimeType}`);
  }
  return errors;
}

export function validateImagePath(rawPath) {
  if (!rawPath) return false;
  const decoded = decodeURIComponent(String(rawPath)).toLowerCase();
  for (const seg of RULES.filePath.forbiddenSegments) {
    if (decoded.includes(seg.toLowerCase())) return false;
  }
  return true;
}

export function scanForPromptInjection(text) {
  if (!text) return { safe: true };
  for (const pattern of RULES.promptInjection.forbiddenPatterns) {
    if (pattern.test(text)) return { safe: false, pattern: pattern.toString() };
  }
  return { safe: true };
}

export function checkRateLimit(ip) {
  const now = Date.now();
  const key  = String(ip || 'unknown');
  let entry  = RL_STORE.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RULES.rateLimit.windowMs };
    RL_STORE.set(key, entry);
  }

  entry.count++;

  // Prune stale entries to prevent unbounded growth
  for (const [k, v] of RL_STORE) {
    if (now > v.resetAt) RL_STORE.delete(k);
  }

  if (entry.count > RULES.rateLimit.maxRequestsPerWindow) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }
  return { allowed: true };
}

export function generateRunId() {
  return crypto.randomBytes(12).toString('hex');
}
