import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { mockKiAnalyze as runMock } from './mockKi.js';

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const PROMPT = `You are analyzing photos of a secondhand jeans product for a Shopify listing.
The photos may include: front/back shots of the jeans, the inner label (brand/model/size), the wash care tag (country of origin), a bag/sticker with a SKU number, and measurement photos (jeans laid flat next to a ruler or tape measure).

Extract ALL of the following and return ONLY valid JSON, no markdown, no explanation:

{
  "brand": "brand name, e.g. Levi's",
  "model": "model number or name, e.g. 512 or 501",
  "fit": "fit type, e.g. bootcut, slim, straight, relaxed",
  "size_w": 30,
  "size_l": 34,
  "measurements": {
    "length_cm": 98,
    "waist_cm": 42,
    "leg_opening_cm": 20
  },
  "country_of_origin": "country from wash care tag in German (e.g. Mexiko, Pakistan, Bangladesch, Indien, China, Türkei) — null if not visible",
  "sku": "5-digit integer or null — ONLY from a handwritten number on a plastic bag. NEVER a printed number. NEVER fewer or more than 5 digits.",
  "is_new_with_tags": false,
  "confidence": "high | medium | low",
  "utility_image_indices": [2, 4],
  "measurement_image_indices": [1, 3, 5],
  "product_image_order": [1, 2, 6]
}

SKU identification rules — follow exactly:
- The SKU appears on a semi-transparent or white PLASTIC BAG (Tüte) — the bag itself is often only partially visible (corner or edge of the bag in the frame).
- The number is handwritten directly on the bag surface in pencil or marker. It is ALWAYS exactly 5 digits (e.g. 48010, 37204, 48009).
- The SKU is PURELY NUMERIC — only digits 0–9. It NEVER contains any letter.
- Handwritten digits can be misread as letters. Common pitfalls:
    "4" with open top → looks like "LI", "H", "U" → it is a 4.
    "1" → looks like "I" or "l" → it is a 1.
    "7" → looks like "T" → it is a 7.
    "0" → looks like "O" or "D" → it is a 0.
  If your reading contains any letter, you are misreading a digit. Convert it to the correct digit before returning.
- Count every digit individually before returning. If the result is not exactly 5 digits, re-examine. If still not exactly 5, return null — do not guess or pad.
- CRITICAL — these are NOT the SKU: numbers printed on wash care tags, numbers on size labels, numbers on brand patches, barcodes, article numbers on sewn-in tags, or any printed text on the garment itself.
- The wash care tag is a paper or fabric tag sewn into the jeans — any number there is NOT the SKU.
- If no plastic bag with a handwritten number is visible in any photo, return null.
- Only one image per product set will contain the SKU bag.
- FORBIDDEN: a sku value with any digit count other than exactly 5. 4 digits → null. 6 digits → null. Any non-digit character → null.

Self-check before returning JSON:
1. Count the digits in your sku value. Is it exactly 5? If not, set sku to null.
2. Does your sku contain any letter (A–Z)? If yes, you misread a digit — fix it. If you can't, set sku to null.
3. Is the source a handwritten number on a plastic bag? If not, set sku to null.

Rules:
- Read size_w and size_l as integers from the label (e.g. W30/L34 → size_w: 30, size_l: 34)
- If a value is truly not determinable, use null
- confidence reflects overall certainty across all extracted fields
- is_new_with_tags: true ONLY if a brand-new hangtag is clearly visible — a paper or cardboard price/brand tag attached with a plastic string, tag-pin or thread to the waistband, belt loop, or pocket. Typically red/white "Standard" Levi's tags, brand labels with size info ("W28 L34"), barcodes, or price tickets that are NOT sewn in. The presence of such an external hangtag indicates the jeans are unworn/new. Set to false if no such hangtag is visible — most secondhand jeans have NO hangtag. Inner sewn-in labels (brand patch, model badge, wash care tag) do NOT count.
- utility_image_indices: 0-based indices of images that should NOT appear in the Shopify listing — filter out ALL of: (1) photos where a ruler or tape measure is placed next to the jeans, (2) photos showing only a SKU bag or sticker, (3) photos showing only a wash care tag / laundry label (the sewn-in tag with washing symbols and country of origin — NOT a brand patch or model name badge). Do NOT filter out brand patches, model badges, or inner waistband labels — those are valid product photos. Use [] if no images need filtering.
- measurement_image_indices: 0-based indices of ALL photos that show a ruler or measuring tape next to the jeans (these are the measurement photos). Include every image where a Zollstock is visible. Use [] if none.
- product_image_order: 0-based indices of product photos in this EXACT order for the Shopify listing (matches veyroze.com store pattern):
  position 0 → front view (jeans laid flat, front side facing up — the whole pair of jeans visible)
  position 1 → back view (jeans laid flat, back side facing up — the whole pair of jeans visible, brand patches usually visible)
  position 2 → outer brand patch (close-up of the leather or woven patch sewn on the OUTSIDE back waistband, showing brand name and W/L size, e.g. "Levi Strauss & Co W33 L32" or a Wrangler leather patch) — include only if clearly visible in a photo
  position 3 → inner brand badge (close-up of the sewn-in fabric label at the top of the waistband, showing model name and fit type, e.g. "512 BOOTCUT" or "LOW BOOT CUT 527") — include only if clearly visible in a photo
  position 4+ → detail shots of visible defects (rips, holes, heavy fading, stains) — only include if such defects are documented in a photo
  EXCLUDE from this array: SKU bag photos, ruler/measuring tape photos, wash care tag/laundry label photos.
  Use [] if no suitable product photos exist.

Measurement rules — follow exactly:
- A folding ruler (Zollstock) appears in the measurement photos.
- Do NOT estimate or guess. Read the ruler markings directly from the photo.
- If no ruler is visible in any photo, return null for all measurement fields.
- The ruler has large RED numbers every 10 cm — use them as anchors to confirm readings.
- The ruler does NOT start at 0 in the photo frame (it may begin at 80, 12, etc.). Read the ABSOLUTE printed number at the fabric edge.
- NEVER multiply, add, or subtract anything. Return the exact number shown on the ruler at the fabric edge.

Identify each measurement photo by ruler orientation:

VERTICAL RULER (runs top-to-bottom along the jeans side seam) → length_cm:
  The fabric ends at the leg hem at the bottom. Read the ruler number at the bottom edge of the hem. That IS length_cm.

HORIZONTAL RULER near the WAISTBAND (belt loops visible, upper part of jeans) → waist_cm:
  One end of the waistband is at the ruler's start mark. The fabric ends at the other side.
  Read the ruler number at the FAR end of the waistband where the fabric stops. That IS waist_cm. Do NOT multiply.

HORIZONTAL RULER at the LEG HEM (frayed or stitched bottom edge of jeans) → leg_opening_cm:
  Same as waist: read the ruler number at the FAR end of the hem where the fabric stops. That IS leg_opening_cm. Do NOT multiply.

- Do not round to the nearest 5. Return the exact value.`;

// For KI product analysis: resize to 800px (sufficient for label reading, reduces payload ~75%)
async function toKiInlinePart(filePath) {
  const buf = await sharp(filePath)
    .rotate()
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { inlineData: { data: buf.toString('base64'), mimeType: 'image/jpeg' } };
}

// Für die Trennbild-/SKU-Erkennung reicht eine deutlich kleinere Vorschau —
// handschriftliche Ziffern sind auch bei 512px noch klar lesbar, und der Payload
// schrumpft um ~97% gegenüber Originalauflösung. Wichtig für große Mengen-Uploads.
async function toPreprocessedInlinePart(filePath) {
  const buf = await sharp(filePath)
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .normalise()
    .sharpen()
    .jpeg({ quality: 72 })
    .toBuffer();
  return { inlineData: { data: buf.toString('base64'), mimeType: 'image/jpeg' } };
}

const COUNTRY_DE = {
  'Afghanistan': 'Afghanistan', 'Albania': 'Albanien', 'Algeria': 'Algerien',
  'Bangladesh': 'Bangladesch', 'Belgium': 'Belgien', 'Bolivia': 'Bolivien',
  'Brazil': 'Brasilien', 'Bulgaria': 'Bulgarien', 'Cambodia': 'Kambodscha',
  'China': 'China', 'Colombia': 'Kolumbien', 'Croatia': 'Kroatien',
  'Czech Republic': 'Tschechien', 'Egypt': 'Ägypten', 'Ethiopia': 'Äthiopien',
  'France': 'Frankreich', 'Germany': 'Deutschland', 'Greece': 'Griechenland',
  'Hungary': 'Ungarn', 'India': 'Indien', 'Indonesia': 'Indonesien',
  'Iran': 'Iran', 'Italy': 'Italien', 'Japan': 'Japan',
  'Jordan': 'Jordanien', 'Kenya': 'Kenia', 'Madagascar': 'Madagaskar',
  'Malaysia': 'Malaysia', 'Mexico': 'Mexiko', 'Morocco': 'Marokko',
  'Myanmar': 'Myanmar', 'Netherlands': 'Niederlande', 'Nigeria': 'Nigeria',
  'Pakistan': 'Pakistan', 'Peru': 'Peru', 'Philippines': 'Philippinen',
  'Poland': 'Polen', 'Portugal': 'Portugal', 'Romania': 'Rumänien',
  'Serbia': 'Serbien', 'South Korea': 'Südkorea', 'Spain': 'Spanien',
  'Sri Lanka': 'Sri Lanka', 'Syria': 'Syrien', 'Taiwan': 'Taiwan',
  'Thailand': 'Thailand', 'Tunisia': 'Tunesien', 'Turkey': 'Türkei',
  'Türkiye': 'Türkei', 'Ukraine': 'Ukraine',
  'United States': 'USA', 'United States of America': 'USA', 'USA': 'USA',
  'Vietnam': 'Vietnam',
  'Rumanien':  'Rumänien',
  'Turkei':    'Türkei',    'Tuerkei':    'Türkei',
  'Sudkorea':  'Südkorea',  'Suedkorea':  'Südkorea',
  'Agypten':   'Ägypten',   'Aegypten':   'Ägypten',
  'Athiopien': 'Äthiopien', 'Aethiopien': 'Äthiopien',
};

function toGermanCountry(name) {
  if (!name) return name;
  return COUNTRY_DE[name] || COUNTRY_DE[name.trim()] || name;
}

function shippingWeight(sizeW) {
  if (sizeW <= 29) return 0.7;
  if (sizeW <= 35) return 0.8;
  return 0.9;
}

function lengthLabel(sizeL, lengthCm) {
  if (!sizeL || !lengthCm || lengthCm >= 100) return sizeL;
  // L sizes are ~5cm apart; <100cm means the jeans are one L-size shorter than labeled
  return sizeL - 2;
}

function buildTitle(brand, model, fit, sizeW, sizeL) {
  const fitInTitle = fit?.toLowerCase() === 'bootcut' ? fit : null;
  const parts = [brand, fitInTitle, 'Jeans'].filter(Boolean);
  const size  = sizeW && sizeL ? ` (W${sizeW}/L${sizeL})` : '';
  return `${parts.join(' ')}${size}`;
}

function formatCondition(val) {
  if (typeof val === 'string' && val.toLowerCase().trim() === 'new with tags') return 'new with tags';
  const n = parseFloat(val);
  if (isNaN(n)) return null;
  return n >= 10 ? 'top' : `${n}/10`;
}

function conditionFromText(val) {
  if (typeof val === 'string' && val.toLowerCase().trim() === 'new with tags') return 'new with tags';
  if (typeof val === 'number') return Math.round(Math.min(10, Math.max(0.5, val)) * 2) / 2;
  const map = { 'top': 10, 'very good': 9, 'good': 8, 'acceptable': 6.5 };
  return map[String(val).toLowerCase().trim()] ?? null;
}

function buildJeansDescription(brand, model, sizeW, sizeL, condition, fit, measurements) {
  const { length_cm, waist_cm, leg_opening_cm } = measurements || {};
  return [
    `${brand}${model ? ' ' + model : ''}`,
    '',
    `Size: W${sizeW}/L${sizeL} 👖`,
    '',
    `Details: cool denim wash 🔎`,
    `Condition: ${formatCondition(condition) || '—'} 🧼`,
    `Fit: ${fit || '—'}`,
    '',
    'Measurements📏:',
    `Length: ${length_cm ?? '—'}cm`,
    `Waist: ${waist_cm ?? '—'}cm`,
    `Leg opening: ${leg_opening_cm ?? '—'}cm`,
  ].join('\n');
}

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
// Separator-Erkennung: flash-lite zuerst — 3–5× schneller und höheres Rate-Limit.
// Halluzinationen werden durch den geschärften Batch-Prompt + Single-Image-Re-Verifikation
// in detectSeparatorsBatch abgefangen, sodass flash nicht im Hot-Path nötig ist.
const SEP_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
const RETRYABLE = new Set([429, 503]);

// Globale Modell-Blacklist: ein Modell, das in den letzten 30s mit 503/500/Timeout
// gefallen ist, wird von allen parallelen Workern übersprungen. Spart bei großen
// Uploads zweistellig Sekunden, weil nicht jeder Chunk denselben kaputten Modellpfad
// neu durchprobieren muss.
const modelBlacklist = new Map(); // modelName → expiresAt (ms)
const MODEL_BLACKLIST_TTL_MS = 30_000;

function isModelBlacklisted(name) {
  const exp = modelBlacklist.get(name);
  if (!exp) return false;
  if (Date.now() > exp) { modelBlacklist.delete(name); return false; }
  return true;
}
function blacklistModel(name) {
  modelBlacklist.set(name, Date.now() + MODEL_BLACKLIST_TTL_MS);
}
function clearModelBlacklist(name) {
  modelBlacklist.delete(name);
}

// Aufruf eines Gemini-Modells mit schnellem Fallback.
// - 503/500/502/Timeout/Unknown → sofort nächstes Modell (Blacklist 30s)
// - 429 → kurzer Retry-Versuch nach 3500ms (Gemini empfiehlt ~3s), dann nächstes Modell
// - 404 (Modell unbekannt) → sofort nächstes Modell
async function callGeminiModel(modelName, contents, opts = {}) {
  const model = genAI.getGenerativeModel({
    model: modelName,
    ...(opts.config ? { generationConfig: opts.config } : {}),
  });
  try {
    const result = await withTimeout(model.generateContent(contents), GEMINI_TIMEOUT_MS);
    clearModelBlacklist(modelName);
    return { ok: true, text: result.response.text().trim() };
  } catch (err) {
    const status = err?.status;
    if (status === 429) {
      // 429 ist im Free-Tier oft ein hartes Tages-Limit, nicht throttling.
      // Ein kurzer Retry lohnt sich nur bei kurzfristigem Throttling — beim Hard-Quota
      // bringt es nichts. Wir warten 3.5s (Gemini's Empfehlung) und versuchen 1×.
      await new Promise(r => setTimeout(r, 3500));
      try {
        const result = await withTimeout(model.generateContent(contents), GEMINI_TIMEOUT_MS);
        clearModelBlacklist(modelName);
        return { ok: true, text: result.response.text().trim() };
      } catch (err2) {
        blacklistModel(modelName);
        return { ok: false, status: err2?.status, error: err2, isTimeout: err2?.isTimeout, isQuota: err2?.status === 429 };
      }
    }
    blacklistModel(modelName);
    return { ok: false, status, error: err, isTimeout: err?.isTimeout };
  }
}

async function callGemini(imageParts) {
  let lastError = null;
  let allQuota  = true;
  let attempted = 0;
  for (const modelName of MODELS) {
    if (isModelBlacklisted(modelName)) continue;
    attempted++;
    const res = await callGeminiModel(modelName, [PROMPT, ...imageParts], { config: { temperature: 0 } });
    if (res.ok) return res.text;
    if (res.status !== 429) allQuota = false;
    lastError = res.error;
  }
  if (attempted > 0 && allQuota) {
    const err = new Error('Gemini-API Tageslimit erreicht (Free-Tier). Bitte später erneut versuchen oder Billing aktivieren.');
    err.isQuotaError = true;
    throw err;
  }
  throw lastError || new Error('Alle Gemini-Modelle nicht erreichbar. Bitte später erneut versuchen.');
}

const SEP_BATCH_PROMPT = `You receive multiple images. Each image is INDEPENDENT. Treat every image on its own — do NOT infer codes from neighboring images or from any sequence pattern.

For EACH image, determine if it is a SEPARATOR PHOTO.

A separator photo shows a translucent/frosted plastic bag (Tüte/Polybeutel, often with a small hanging hole) OR a piece of paper/card, with a HANDWRITTEN inventory code on it (in black marker/Edding or pencil).

The inventory code is ALWAYS PURELY NUMERIC — only digits 0–9, never any letters. Length is typically exactly 5 digits (e.g. "48005", "48008", "48010", "37204"). Length may range from 4 to 8 digits but is almost always 5.

CRITICAL — character reading: handwritten digits can be easy to misread as letters. Common pitfalls:
- A handwritten "4" with an open top may look like "LI", "H", or "U" — it is still a 4.
- A handwritten "1" may look like "I" or "l" — it is a 1.
- A handwritten "7" may look like "T" — it is a 7.
- A handwritten "0" may look like "O" or "D" — it is a 0.
If you "see" any letter in the code, you are misreading a digit — re-examine and convert it to the correct digit (0–9).

The photo may have been taken with the phone rotated or upside-down. The handwritten code may appear at any angle (90°, 180°, 270° rotated). Examine all orientations carefully — rotate the image mentally if needed to read the characters.

Return ONLY a JSON array (no markdown, no prose), one object per input image in original order:
[{"i":0,"sku":"48005"},{"i":1,"sku":null},...]

STRICT RULES — read carefully, these are non-negotiable:
- An image of JEANS, GARMENTS, FABRIC, BUTTONS, POCKETS, RULERS, MEASURING TAPES, BRAND PATCHES, CARE LABELS, SIZE TAGS, or any clothing detail is NEVER a separator. Return null even if neighboring images had separators.
- DO NOT GUESS codes from sequence or context (e.g. if previous images were 48005, 48006, 48007 — do NOT invent 48008 for the next image). Each image must be classified purely on what is VISIBLE in that single image.
- Only return a non-null sku if you can VISUALLY READ a handwritten numeric code in the image itself.
- "sku" must contain ONLY digits 0–9, no letters, no spaces, no punctuation. If your reading contains any letter, you are misreading a digit — fix it before returning.
- Printed text on tags/patches/rulers is NOT a separator code.
- If in doubt, return null. False positives are worse than false negatives.`;

const SEP_CHUNK_SIZE        = 12;
const SEP_CHUNK_CONCURRENCY = 5;
const GEMINI_TIMEOUT_MS     = 15_000;

const SEP_SINGLE_PROMPT = `Look at this ONE image. Is it a separator photo?

A separator photo shows a translucent plastic bag (Tüte/Polybeutel) OR a piece of paper/card, with a HANDWRITTEN PURELY NUMERIC inventory code on it (black marker or pencil). The code is ALWAYS only digits 0–9, never any letters. Typical codes are 5 digits like "48005", "48008", "37204". Length 4–8 digits, almost always 5. The code may be rotated 0/90/180/270°.

CRITICAL — handwritten digits can be misread as letters:
- "4" with open top may look like "LI", "H", "U" — it is a 4.
- "1" may look like "I" or "l" — it is a 1.
- "7" may look like "T" — it is a 7.
- "0" may look like "O" or "D" — it is a 0.
If your reading contains any letter, you are misreading a digit. Correct it before returning.

Return ONLY a single JSON object (no markdown, no prose):
{"sku":"48005"} or {"sku":null}

STRICT:
- Jeans, garments, rulers, brand patches, care labels, fabric details are NEVER separators → return {"sku":null}.
- Only return a non-null sku if you can VISUALLY READ a handwritten numeric code in THIS image.
- "sku" must contain ONLY digits 0–9, no letters, no spaces.
- If unsure, return {"sku":null}.`;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { isTimeout: true })), ms)),
  ]);
}

async function detectSeparatorsChunk(parts) {
  let lastFail = { failReason: 'all-models-exhausted', modelUsed: null };
  for (const modelName of SEP_MODELS) {
    if (isModelBlacklisted(modelName)) continue;
    const res = await callGeminiModel(modelName, [SEP_BATCH_PROMPT, ...parts]);
    if (!res.ok) {
      lastFail = { items: null, modelUsed: modelName, failReason: res.isTimeout ? 'timeout' : (res.error?.message || `status-${res.status || 'unknown'}`) };
      continue;
    }
    const match = res.text.match(/\[[\s\S]*\]/);
    if (!match) return { items: null, modelUsed: modelName, failReason: 'no-json' };
    let arr;
    try { arr = JSON.parse(match[0]); }
    catch { return { items: null, modelUsed: modelName, failReason: 'json-parse' }; }
    const items = parts.map((_, i) => {
      const item = arr.find(a => a && a.i === i);
      const sku  = item?.sku;
      if (sku != null) {
        const cleaned = String(sku).trim().replace(/\s+/g, '');
        if (/^\d{4,8}$/.test(cleaned))
          return { isSeparator: true, sku: cleaned };
        return { isSeparator: false, sku: null, rejectedSku: cleaned };
      }
      return { isSeparator: false, sku: null };
    });
    return { items, modelUsed: modelName, failReason: null };
  }
  return lastFail;
}

async function verifySeparatorSingle(imagePath, cachedPart) {
  if (!genAI) return { sku: null, modelUsed: null };
  let part = cachedPart;
  if (!part) {
    try { part = await toPreprocessedInlinePart(imagePath); }
    catch { return { sku: null, modelUsed: null, failReason: 'preprocess' }; }
  }
  let lastFailReason = 'all-models-exhausted';
  for (const modelName of SEP_MODELS) {
    if (isModelBlacklisted(modelName)) continue;
    const res = await callGeminiModel(modelName, [SEP_SINGLE_PROMPT, part]);
    if (!res.ok) {
      lastFailReason = res.isTimeout ? 'timeout' : (res.error?.message || `status-${res.status || 'unknown'}`);
      continue;
    }
    const match = res.text.match(/\{[\s\S]*\}/);
    if (!match) return { sku: null, modelUsed: modelName };
    let obj;
    try { obj = JSON.parse(match[0]); }
    catch { return { sku: null, modelUsed: modelName }; }
    const sku = obj?.sku;
    if (sku == null) return { sku: null, modelUsed: modelName };
    const cleaned = String(sku).trim().replace(/\s+/g, '');
    if (/^\d{4,8}$/.test(cleaned)) return { sku: cleaned, modelUsed: modelName };
    return { sku: null, modelUsed: modelName };
  }
  return { sku: null, modelUsed: null, failReason: lastFailReason };
}

export async function detectSeparatorsBatch(imagePaths, onChunkDone) {
  if (!genAI || !imagePaths.length) return null;

  const chunks = [];
  for (let i = 0; i < imagePaths.length; i += SEP_CHUNK_SIZE) {
    chunks.push({ start: i, paths: imagePaths.slice(i, i + SEP_CHUNK_SIZE) });
  }

  const results = new Array(imagePaths.length);
  const partsCache = new Array(imagePaths.length);
  let nextChunk = 0;
  let chunksDone = 0;

  async function worker() {
    while (nextChunk < chunks.length) {
      const chunkIndex = nextChunk;
      const { start, paths } = chunks[nextChunk++];
      let parts;
      let preprocessError = null;
      try { parts = await Promise.all(paths.map(toPreprocessedInlinePart)); }
      catch (err) { parts = null; preprocessError = err?.message || 'preprocess-failed'; }
      if (parts) {
        for (let k = 0; k < parts.length; k++) partsCache[start + k] = parts[k];
      }
      const chunkResp = parts
        ? await detectSeparatorsChunk(parts)
        : { items: null, modelUsed: null, failReason: preprocessError };
      const chunkFailed = !chunkResp || !chunkResp.items;
      for (let k = 0; k < paths.length; k++) {
        const item = chunkResp?.items?.[k] ?? { isSeparator: false, sku: null };
        results[start + k] = {
          ...item,
          chunkIndex,
          chunkFailed,
          modelUsed:  chunkResp?.modelUsed ?? null,
          failReason: chunkFailed ? (chunkResp?.failReason || 'unknown') : null,
        };
      }
      chunksDone++;
      onChunkDone?.(chunksDone, chunks.length, paths.length);
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(SEP_CHUNK_CONCURRENCY, chunks.length) },
    worker,
  ));

  // Re-Verifikation: jeden Treffer einzeln prüfen, ohne Sequenz-Kontext.
  // So fallen Halluzinationen weg (Jeans → "48009"), die nur durch den Batch entstanden.
  const hitIndices = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i]?.isSeparator) hitIndices.push(i);
  }
  if (hitIndices.length > 0) {
    let vNext = 0;
    async function verifyWorker() {
      while (vNext < hitIndices.length) {
        const idx = hitIndices[vNext++];
        const batchSku = results[idx].sku;
        const single = await verifySeparatorSingle(imagePaths[idx], partsCache[idx]);
        if (!single.sku) {
          results[idx] = {
            ...results[idx],
            isSeparator:    false,
            rejectedSku:    batchSku,
            verified:       false,
            verifyMismatch: 'single-says-not-separator',
            verifyModel:    single.modelUsed,
          };
        } else if (single.sku !== batchSku) {
          results[idx] = {
            ...results[idx],
            sku:            single.sku,
            verified:       true,
            verifyMismatch: `batch=${batchSku}→single=${single.sku}`,
            verifyModel:    single.modelUsed,
          };
        } else {
          results[idx] = {
            ...results[idx],
            verified:    true,
            verifyModel: single.modelUsed,
          };
        }
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(SEP_CHUNK_CONCURRENCY, hitIndices.length) },
      verifyWorker,
    ));
  }

  // Recovery-Pass: bei einer Halluzination (rejectedSku) liegt die echte Tüte oft
  // in unmittelbarer Nähe — der Batch hat sie übersehen, weil er fälschlich die SKU
  // auf das Nachbarbild geschoben hat. Wir prüfen darum die Negativ-Bilder im
  // selben Cluster (zwischen den nächsten akzeptierten Separatoren) einzeln nach.
  const recheckSet = new Set();
  for (let i = 0; i < results.length; i++) {
    if (!(results[i]?.rejectedSku && !results[i]?.isSeparator)) continue;
    for (let s = i - 1; s >= 0 && !results[s]?.isSeparator; s--) recheckSet.add(s);
    for (let e = i + 1; e < results.length && !results[e]?.isSeparator; e++) recheckSet.add(e);
    recheckSet.delete(i);
  }
  const recheckIndices = [...recheckSet];
  if (recheckIndices.length > 0) {
    let rNext = 0;
    async function recheckWorker() {
      while (rNext < recheckIndices.length) {
        const idx = recheckIndices[rNext++];
        const single = await verifySeparatorSingle(imagePaths[idx], partsCache[idx]);
        if (single.sku) {
          results[idx] = {
            ...results[idx],
            isSeparator:    true,
            sku:             single.sku,
            verified:        true,
            verifyMismatch: 'rescued-after-batch-miss',
            verifyModel:     single.modelUsed,
          };
        }
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(SEP_CHUNK_CONCURRENCY, recheckIndices.length) },
      recheckWorker,
    ));
  }

  // SKU-Kollisionen erkennen (zwei Bilder mit identischer SKU = mindestens eines falsch)
  const skuCount = new Map();
  for (const r of results) {
    if (r?.isSeparator && r.sku) skuCount.set(r.sku, (skuCount.get(r.sku) || 0) + 1);
  }
  for (let i = 0; i < results.length; i++) {
    if (results[i]?.isSeparator && skuCount.get(results[i].sku) > 1) {
      results[i] = { ...results[i], skuCollision: true };
    }
  }

  return results;
}

export async function detectSeparatorImage(imagePath) {
  const result = await detectSeparatorsBatch([imagePath]);
  return result?.[0] ?? { isSeparator: false, sku: null };
}

const MAX_KI_IMAGES = 50;
const LABEL_RE = /label|tag|badge|patch|etikett|waist|bund|ruler|mass|cm|meas/i;

function selectKiImages(imageFiles) {
  if (imageFiles.length <= MAX_KI_IMAGES) return imageFiles;
  const selected = new Set([0, imageFiles.length - 1]);
  for (let i = 0; i < imageFiles.length && selected.size < MAX_KI_IMAGES; i++) {
    if (LABEL_RE.test(path.basename(imageFiles[i]))) selected.add(i);
  }
  const step = Math.max(1, Math.floor(imageFiles.length / MAX_KI_IMAGES));
  for (let i = 0; i < imageFiles.length && selected.size < MAX_KI_IMAGES; i += step) {
    selected.add(i);
  }
  return [...selected].sort((a, b) => a - b).map(i => imageFiles[i]);
}

export async function mockKiAnalyze(imageFiles, opts = {}) {
  if (!genAI) return runMock(imageFiles);

  const files = selectKiImages(imageFiles.slice(0, 90));
  const imageParts = await Promise.all(files.map(toKiInlinePart));

  const raw = await callGemini(imageParts);

  let extracted;
  try {
    extracted = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    extracted = match ? JSON.parse(match[0]) : {};
  }

  const measIdx = Array.isArray(extracted.measurement_image_indices)
    ? extracted.measurement_image_indices.filter(i => Number.isInteger(i) && i >= 0 && i < files.length).sort((a, b) => a - b)
    : [];

  const {
    brand         = 'Unknown',
    model: jeansModel = null,
    fit           = null,
    size_w        = null,
    size_l        = null,
    wash_details  = null,
    condition: conditionRaw = null,
    measurements  = {},
    country_of_origin = null,
    sku           = null,
    is_new_with_tags = false,
    confidence    = 'medium',
    utility_image_indices = [],
    product_image_order = [],
  } = extracted;

  const utilitySet = new Set(Array.isArray(utility_image_indices) ? utility_image_indices : []);
  const measSet    = new Set(measIdx);
  const orderList  = Array.isArray(product_image_order)
    ? product_image_order.filter(i => Number.isInteger(i) && i >= 0 && i < files.length && !utilitySet.has(i) && !measSet.has(i))
    : [];

  // Indizes von `files` (KI-Subset) auf `imageFiles` (volles Set der Gruppe) mappen.
  // So bleiben auch bei >8 Fotos/Produkt alle hochgeladenen Bilder im Output.
  const filesToInputIdx = files.map(f => imageFiles.indexOf(f));
  const inputUtilitySet = new Set(
    [...utilitySet, ...measSet].map(i => filesToInputIdx[i]).filter(i => i >= 0)
  );

  // KI-Order zuerst (Front, Back, Badge, Patch), dann verbleibende echte Produktfotos.
  const orderedInputIdx = orderList
    .map(i => filesToInputIdx[i])
    .filter(i => i >= 0);
  const seen = new Set(orderedInputIdx);
  const remaining = imageFiles
    .map((_, i) => i)
    .filter(i => !inputUtilitySet.has(i) && !seen.has(i));
  const productFiles = [...orderedInputIdx, ...remaining]
    .map(i => imageFiles[i])
    .filter(Boolean);

  // SKU: vom Trennbild-Detektor übernommen, sonst aus dem KI-Ergebnis. SKUs sind IMMER rein numerisch.
  const overrideRaw = typeof opts.sku === 'string' ? opts.sku.trim() : '';
  const overrideSku = /^\d{4,8}$/.test(overrideRaw) ? overrideRaw : null;
  const validSku = overrideSku
    || ((typeof sku === 'string' || typeof sku === 'number') && /^\d{4,8}$/.test(String(sku).trim())
        ? String(sku).trim()
        : null);

  const newWithTags = is_new_with_tags === true;
  const condition = newWithTags ? 'new with tags' : 9;
  const hsCode = newWithTags ? '6203420' : '6309000';

  // Längenkorrektur: gemessene Länge < 100cm → L-Größe nach unten korrigieren
  const correctedL    = lengthLabel(size_l, measurements.length_cm);
  const labelSize     = size_w && size_l     ? `W${size_w}/L${size_l}` : null;
  const correctedSize = size_w && correctedL ? `W${size_w}/L${correctedL}` : labelSize;
  const lengthCorrected = correctedL !== size_l;

  // Ordnername bestimmt Steuer + Tag (Plug-Ordner = taxable)
  const folderName  = opts.folderName || '';
  const isPlug      = /plug/i.test(folderName);
  const taxable     = isPlug;
  const taxTag      = isPlug ? 'PLUG' : 'diff';

  const tags = ['KI', taxTag];
  if (size_w) tags.push(`W${size_w}`);
  if (newWithTags) tags.push('new with tags');

  const collections = ['Jeans'];
  if (size_w) collections.push(`W${size_w}`);

  const weight = size_w ? shippingWeight(size_w) : 0.8;

  const normalizedFit   = fit?.toLowerCase() === 'bootcut' ? 'bootcut' : 'straight / regular';
  const titel_vorschlag = buildTitle(brand, jeansModel, normalizedFit, size_w, correctedL ?? size_l);
  const beschreibung    = buildJeansDescription(brand, jeansModel, size_w, correctedL ?? size_l, condition, normalizedFit, measurements);

  const konfidenzMap = { high: 'hoch', medium: 'mittel', low: 'niedrig' };

  return {
    // Legacy-Felder (pipeline.js display)
    produkttyp:      'Jeans',
    marke:           brand,
    stil:            normalizedFit,
    groesse:         correctedSize,
    zustand:         condition,
    titel_vorschlag,
    beschreibung,
    konfidenz:       konfidenzMap[confidence] || 'mittel',
    collection:      'Jeans',

    // Neue Felder (Shopify-Upload)
    modell:          jeansModel,
    fit:             normalizedFit,
    size_w,
    size_l,
    size_label:      labelSize,
    size_corrected:  correctedSize,
    length_corrected: lengthCorrected,
    wash_details,
    condition,
    measurements,
    country_of_origin: toGermanCountry(country_of_origin) || 'Pakistan',
    sku: validSku,
    taxable,
    tags,
    collections,
    shipping_weight_kg: weight,
    hs_code:         hsCode,
    is_new_with_tags: newWithTags,
    product_images:  productFiles,
    measurement_images: measIdx.map(i => imageFiles[filesToInputIdx[i]] ?? files[i]).filter(Boolean),
  };
}
