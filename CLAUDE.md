# Veyroze — Claude Working Instructions

## Project

AI-powered Shopify listing automation for secondhand resellers.
Photos → Gemini Vision AI detects product data → editable cards → Shopify upload.

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
  ki.js               Google Gemini Vision AI — extracts all product fields
  mockKi.js           Fallback mock (used when GEMINI_API_KEY is not set)
  shopify.js          Shopify Admin API client (createShopifyDraft) — wired in Step 3
  parser.js           Rule-based OCR parser (brands, sizes, colors)
  compressor.js       Image compression via sharp
  deduplicator.js     Duplicate image detection
  groupImages.js      Groups images by separator images
  separatorDetector.js  Detects separator/divider images
  csvExport.js        Shopify-compatible CSV export
  ocr.js              Tesseract.js OCR wrapper
  logger.js / runLogger.js / progress.js  Logging & progress tracking
  security/           Rate limiting, KI budget, prompt injection, CSP headers, path traversal

public/           Frontend (Vanilla JS SPA served by Express)
  index.html          4-screen app: Capture → Progress → AI Results → Error

uploads/          Runtime image storage (gitignored)
test/             E2E tests + fixture images
docs/             Requirements: anforderungen-shopify-automation.md (coding reference)
.claude/agents/   Sub-agents: jenny, karen, task-completion-validator, ultrathink-debugger, ui-comprehensive-tester, claude-md-compliance-checker, code-quality-pragmatist
```

---

## Bugs — never reintroduce

| Problem | Rule |
|---|---|
| Express 5 Wildcard syntax | `*path` (named), access via `req.params.path` — never use `*` alone |
| ES module exports are read-only | Pass `opts.ProgressClass`, never assign `mod.Progress =` |
| `timingSafeEqual` with different lengths | Always check `token.length !== expected.length` before calling — crashes with RangeError otherwise |
| Gemini model names | `gemini-1.5-flash` returns 404 on v1beta. Use `['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-latest']` |
| Multer + middleware order | Auth middleware runs before multer — headers are available, body/files are not yet |

---

## Working Rules

- No React, no Vue, no TypeScript — Vanilla JS ESM stays
- No comments except when the WHY is non-obvious
- No error handlers for cases that cannot happen
- Read file before every edit, match exact string
- Changes to `src/pipeline.js` affect all consumers
- `.env` for all secrets: `GEMINI_API_KEY`, `SHOPIFY_SHOP`, `SHOPIFY_TOKEN`
- `uploads/` is gitignored — runtime only, never commit
- Every implementation must be checked against `docs/anforderungen-shopify-automation.md`
- No access token / lock screen — app opens directly (removed by user request)

---

## KI Pipeline (ki.js)

- Gemini model fallback chain: `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash-latest`
- Retries on 429, 503, 404 (1s delay between attempts)
- Returns both legacy fields (pipeline display) and new Shopify fields
- `product_images`: utility photos (ruler/SKU bag) filtered out; label/badge photos kept
- Plug/diff logic: folderName contains "plug" → `taxable: true`, tag "PLUG"; else tag "diff"
- Length correction: measured length < 100cm → L-size − 2
- Shipping weight tiers: W≤29→0.7kg, W30-35→0.8kg, W≥36→0.9kg
- HS Code: 6309000, country fallback: "Pakistan"

---

## Next Steps (Priority)

1. ✅ **Real AI:** Google Gemini 2.5 Flash Vision — done
2. ✅ **Business logic + Security:** folderName/Plug flow, KI fields in UI, rate limiting, CSP — done
3. **Perfecting current state** — ongoing (user-driven)
4. **Shopify API:** Wire `src/shopify.js` into `server.js`
   Add `POST /api/shopify/:runId/:productIdx` → calls `createShopifyDraft()`
   Env vars: `SHOPIFY_SHOP`, `SHOPIFY_TOKEN`
   All fields per `docs/anforderungen-shopify-automation.md`
5. **Deploy:** Railway.app or Render.com (free tier, Node.js, persistent disk for uploads/)
6. **SaaS / Multi-user:** Supabase Auth + Stripe Billing (long-term)
