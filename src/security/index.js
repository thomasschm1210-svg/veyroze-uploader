import fs from 'fs';
import { RULES } from './rules.js';
import { validateImageFile, validateImagePath, scanForPromptInjection, checkRateLimit, mimeFromPath } from './technicals.js';
import { UI } from './design.js';

export async function securityCheck(ctx) {
  if (ctx.phase === 'http') {
    if (ctx.path !== undefined && !validateImagePath(ctx.path)) {
      return { block: true, status: 403, body: UI.errorResponse('PATH_TRAVERSAL', UI.errors.pathTraversal) };
    }
    if (ctx.ip) {
      const rl = checkRateLimit(ctx.ip);
      if (!rl.allowed) {
        return { block: true, status: 429, body: UI.errorResponse('RATE_LIMITED', UI.errors.rateLimited) };
      }
    }
    return { block: false };
  }

  if (ctx.phase === 'upload') {
    const files = ctx.imageFiles || [];
    if (files.length > RULES.upload.maxImagesPerRun) {
      return {
        block: true, status: 400,
        body: UI.errorResponse('TOO_MANY_FILES', `Maximal ${RULES.upload.maxImagesPerRun} Bilder pro Lauf.`),
      };
    }
    for (const f of files) {
      const sizeBytes = f.sizeBytes ?? (fs.existsSync(f.path) ? fs.statSync(f.path).size : 0);
      const mimeType  = f.mimeType  ?? mimeFromPath(f.path);
      const errors    = validateImageFile(f.path, sizeBytes, mimeType);
      if (errors.length) {
        return { block: true, status: 400, body: UI.errorResponse('INVALID_FILE', errors[0]) };
      }
    }
    return { block: false };
  }

  if (ctx.phase === 'ki') {
    const scan = scanForPromptInjection(ctx.ocrText);
    if (!scan.safe) {
      return { block: true, status: 422, body: UI.errorResponse('PROMPT_INJECTION', UI.errors.promptInjection) };
    }
    return { block: false };
  }

  return { block: false };
}

export function securityHeaders() {
  return (_req, res, next) => {
    for (const [name, value] of Object.entries(RULES.headers)) {
      res.setHeader(name, value);
    }
    next();
  };
}
