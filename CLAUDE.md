# Veyroze — Claude Working Instructions

## Project

AI-powered Shopify listing automation for secondhand resellers.
Photos → AI detects product data → editable cards → Shopify upload.

**Path:** `/Users/thomas.rssk/Documents/veyroze_uploader`
**Stack:** Node.js 24, Express 5, Tesseract.js, sharp, Vanilla JS ESM (no React/Vue, no TypeScript)

---

## Architecture

```
server.js         Express 5 web server — main entry point (npm start)
  POST /api/upload    Receives images (multer), stores in uploads/<runId>/
  POST /api/run       Triggers pipeline, sends SSE progress events
  GET  /api/progress/:runId   SSE stream for real-time progress
  GET  /api/image/:runId/*    Serves processed images
  GET  /api/csv/:runId/:file  Serves generated CSV

src/              Core business logic — framework-agnostic
  pipeline.js         5-phase orchestrator → { csvPath, logPath, stats, products[] }
  analyzeProduct.js   OCR + EXIF → structured product data
  mockKi.js           Mock AI → to be replaced by Claude Haiku 4.5 Vision
  shopify.js          Shopify Admin API client (createShopifyDraft)
  parser.js           Rule-based OCR parser (brands, sizes, colors)
  compressor.js       Image compression via sharp
  deduplicator.js     Duplicate image detection
  groupImages.js      Groups images by separator images
  separatorDetector.js  Detects separator/divider images
  csvExport.js        Shopify-compatible CSV export
  ocr.js              Tesseract.js OCR wrapper
  logger.js / runLogger.js / progress.js  Logging & progress tracking
  security/           Security checks: path traversal, rate limiting, prompt injection

public/           Frontend (Vanilla JS SPA served by Express)
  index.html          4-screen app: Capture → Progress → AI Results → Error

uploads/          Runtime image storage (gitignored)
test/             E2E tests + fixture images
```

---

## Bugs — never reintroduce

| Problem | Rule |
|---|---|
| Express 5 Wildcard syntax | `*path` (named), access via `req.params.path` — never use `*` alone |
| ES module exports are read-only | Pass `opts.ProgressClass`, never assign `mod.Progress =` |

---

## Working Rules

- No React, no Vue, no TypeScript — Vanilla JS ESM stays
- No comments except when the WHY is non-obvious
- No error handlers for cases that cannot happen
- Read file before every edit, match exact string
- Changes to `src/pipeline.js` affect all consumers
- `.env` for all secrets: `ANTHROPIC_API_KEY`, `SHOPIFY_SHOP`, `SHOPIFY_TOKEN`
- `uploads/` is gitignored — runtime only, never commit

---

## Next Steps (Priority)

1. **Real AI:** Replace `src/mockKi.js` with Claude Haiku 4.5 Vision
   Interface stays: `mockKiAnalyze(imageFiles[]) → ki-object`
   Use `ANTHROPIC_API_KEY` from `.env`

2. **Shopify API:** Wire `src/shopify.js` into `server.js`
   Add `POST /api/shopify/:runId/:productIdx` → calls `createShopifyDraft()`
   Env vars: `SHOPIFY_SHOP`, `SHOPIFY_TOKEN`

3. **Deploy:** Railway.app or Render.com (free tier, Node.js, persistent disk for uploads/)

4. **SaaS / Multi-user:** Supabase Auth + Stripe Billing (long-term)
