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
  "wash_details": "description of the denim wash, e.g. cool denim wash, dark indigo, light fade",
  "condition": "top | very good | good | acceptable",
  "measurements": {
    "length_cm": 98,
    "waist_cm": 42,
    "leg_opening_cm": 20
  },
  "country_of_origin": "country from wash care tag in German (e.g. Mexiko, Pakistan, Bangladesch, Indien, China, Türkei) — null if not visible",
  "sku": "5-digit integer or null — ONLY from a handwritten number on a plastic bag. NEVER a printed number. NEVER fewer or more than 5 digits.",
  "confidence": "high | medium | low",
  "utility_image_indices": [2, 4],
  "measurement_image_indices": [1, 3, 5],
  "product_image_order": [1, 2, 6]
}

SKU identification rules — follow exactly:
- The SKU appears on a semi-transparent or white PLASTIC BAG (Tüte) — the bag itself is often only partially visible (corner or edge of the bag in the frame).
- The number is handwritten directly on the bag surface in pencil or marker. It is ALWAYS exactly 5 digits (e.g. 48010, 37204, 48009).
- Count every digit individually before returning. If the result is not exactly 5 digits, re-examine. If still not exactly 5, return null — do not guess or pad.
- CRITICAL — these are NOT the SKU: numbers printed on wash care tags, numbers on size labels, numbers on brand patches, barcodes, article numbers on sewn-in tags, or any printed text on the garment itself.
- The wash care tag is a paper or fabric tag sewn into the jeans — any number there is NOT the SKU.
- If no plastic bag with a handwritten number is visible in any photo, return null.
- Only one image per product set will contain the SKU bag.
- FORBIDDEN: a sku value with any digit count other than exactly 5. 4 digits → null. 6 digits → null. Any non-digit character → null.

Self-check before returning JSON:
1. Count the digits in your sku value. Is it exactly 5? If not, set sku to null.
2. Is the source a handwritten number on a plastic bag? If not, set sku to null.

Rules:
- Read size_w and size_l as integers from the label (e.g. W30/L34 → size_w: 30, size_l: 34)
- If a value is truly not determinable, use null
- confidence reflects overall certainty across all extracted fields
- utility_image_indices: 0-based indices of images that should NOT appear in the Shopify listing — only filter out: (1) photos where a ruler or tape measure is placed next to the jeans, (2) photos showing only a SKU bag or sticker. Do NOT filter out label/badge photos (e.g. the brand patch on the jeans) — those are valid product photos. Use [] if no images need filtering.
- measurement_image_indices: 0-based indices of ALL photos that show a ruler or measuring tape next to the jeans (these are the measurement photos). Include every image where a Zollstock is visible. Use [] if none.
- product_image_order: 0-based indices of product photos in this EXACT order for the Shopify listing (matches veyroze.com store pattern):
  position 0 → front view (jeans laid flat, front side facing up)
  position 1 → back view (jeans laid flat, back side facing up)
  position 2 → inner badge/tag (the sewn-in label inside the waistband showing model name and fit type, e.g. "512 BOOTCUT") — include only if clearly visible in a photo
  position 3 → outer badge/patch (the leather or woven patch sewn on the outside back waistband showing brand name and W/L size) — include only if clearly visible in a photo
  position 4+ → detail shots of flaws or visible wear (stains, holes, heavy fading, damage) — only include if such defects are documented in a photo
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

async function toInlinePart(filePath) {
  const data = (await fs.promises.readFile(filePath)).toString('base64');
  const ext  = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { inlineData: { data, mimeType: mime } };
}

// For KI product analysis: resize to 800px (sufficient for label reading, reduces payload ~75%)
async function toKiInlinePart(filePath) {
  const buf = await sharp(filePath)
    .rotate()
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { inlineData: { data: buf.toString('base64'), mimeType: 'image/jpeg' } };
}

// For separator/SKU detection: normalise + sharpen for handwritten digit readability
async function toPreprocessedInlinePart(filePath) {
  const tmpPath = path.join(os.tmpdir(), `vsep_${Date.now()}_${path.basename(filePath)}.jpg`);
  try {
    await sharp(filePath)
      .rotate()
      .normalise()
      .sharpen()
      .jpeg({ quality: 90 })
      .toFile(tmpPath);
    const data = (await fs.promises.readFile(tmpPath)).toString('base64');
    return { inlineData: { data, mimeType: 'image/jpeg' } };
  } finally {
    if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch {}
  }
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
  if (!lengthCm || lengthCm >= 100) return sizeL;
  // L sizes are ~5cm apart; <100cm means the jeans are one L-size shorter than labeled
  return sizeL - 2;
}

function buildTitle(brand, model, fit, sizeW, sizeL) {
  const fitInTitle = fit?.toLowerCase() === 'bootcut' ? fit : null;
  const parts = [brand, fitInTitle, 'Jeans'].filter(Boolean);
  const size  = sizeW && sizeL ? ` (W${sizeW}/L${sizeL})` : '';
  return `${parts.join(' ')}${size}`;
}

function buildJeansDescription(brand, model, sizeW, sizeL, washDetails, condition, fit, measurements) {
  const { length_cm, waist_cm, leg_opening_cm } = measurements || {};
  return [
    `${brand}${model ? ' ' + model : ''}   Size: W${sizeW}/L${sizeL} 🩻`,
    '',
    `Details: ${washDetails || '—'} 🔍`,
    `Condition: ${condition || '—'} 🧤`,
    `Fit: ${fit || '—'}`,
    '',
    'Measurements 📏:',
    `Length: ${length_cm ?? '—'} cm`,
    `Waist: ${waist_cm ?? '—'} cm`,
    `Leg opening: ${leg_opening_cm ?? '—'} cm`,
  ].join('\n');
}

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
const RETRYABLE = new Set([429, 503]);
const MAX_ATTEMPTS = 3;

async function callGemini(imageParts) {
  for (const modelName of MODELS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const model  = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: { temperature: 0 },
        });
        const result = await model.generateContent([PROMPT, ...imageParts]);
        return result.response.text().trim();
      } catch (err) {
        const status = err.status;
        if (status === 404) break;                        // model doesn't exist → next model
        if (RETRYABLE.has(status) && attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, attempt * 300));
          continue;
        }
        if (RETRYABLE.has(status)) break;                // exhausted retries → next model
        throw err;
      }
    }
  }
  throw new Error('Alle Gemini-Modelle nicht erreichbar. Bitte später erneut versuchen.');
}

const SEP_BATCH_PROMPT = `You receive multiple images in order. For EACH image, determine if it is a SEPARATOR PHOTO.

A separator photo shows a translucent/frosted plastic bag (Tüte/Polybeutel, often with a small hanging hole) OR a piece of paper/card, with a HANDWRITTEN 5-digit inventory number on it (in marker or pencil).

IMPORTANT: The photo may have been taken with the phone rotated or upside-down. The handwritten number may appear at any angle (90°, 180°, 270° rotated). Examine all orientations carefully — rotate the image mentally if needed to read the digits.

Return ONLY a JSON array (no markdown, no prose), one object per input image in original order:
[{"i":0,"sku":"48005"},{"i":1,"sku":null},...]

Rules:
- "sku" must be a string of EXACTLY 5 digits, or null.
- Numbers printed on garment care tags, brand patches, size labels, rulers/tape measures or any printed text are NOT separators — return null for those.
- Only HANDWRITTEN numbers on a plastic bag or paper count.
- The digit count must be exactly 5 — not 4, not 6. If you cannot confirm 5 digits with confidence, return null.`;

export async function detectSeparatorsBatch(imagePaths) {
  if (!genAI || !imagePaths.length) return null;
  let parts;
  try { parts = await Promise.all(imagePaths.map(toPreprocessedInlinePart)); }
  catch { return null; }

  for (const modelName of MODELS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const model  = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent([SEP_BATCH_PROMPT, ...parts]);
        const text   = result.response.text().trim();
        const match  = text.match(/\[[\s\S]*\]/);
        if (!match) return null;
        const arr = JSON.parse(match[0]);
        return imagePaths.map((_, i) => {
          const item = arr.find(a => a && a.i === i);
          const sku  = item?.sku;
          if (sku != null && /^\d{5}$/.test(String(sku).trim()))
            return { isSeparator: true, sku: String(sku).trim() };
          return { isSeparator: false, sku: null };
        });
      } catch (err) {
        const status = err?.status;
        if (status === 404) break;
        if (RETRYABLE.has(status) && attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, attempt * 300));
          continue;
        }
        if (RETRYABLE.has(status)) break;
        return null;
      }
    }
  }
  return null;
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
    condition     = null,
    measurements  = {},
    country_of_origin = null,
    sku           = null,
    confidence    = 'medium',
    utility_image_indices = [],
    product_image_order = [],
  } = extracted;

  const utilitySet = new Set(Array.isArray(utility_image_indices) ? utility_image_indices : []);
  const orderList  = Array.isArray(product_image_order)
    ? product_image_order.filter(i => Number.isInteger(i) && i >= 0 && i < files.length)
    : [];
  const productFiles = orderList.length > 0
    ? orderList.map(i => files[i]).filter(Boolean)
    : files.filter((_, i) => !utilitySet.has(i));

  // SKU must be exactly 5 digits — reject anything else regardless of what Gemini returned
  const validSku = (typeof sku === 'string' || typeof sku === 'number')
    && /^\d{5}$/.test(String(sku).trim())
    ? String(sku).trim()
    : null;

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
  if (labelSize) tags.push(labelSize);

  const collections = ['Jeans'];
  if (size_w) collections.push(`W${size_w}`);

  const weight = size_w ? shippingWeight(size_w) : 0.8;

  const normalizedFit   = fit?.toLowerCase() === 'bootcut' ? fit : (fit ? 'straight / regular' : null);
  const titel_vorschlag = buildTitle(brand, jeansModel, normalizedFit, size_w, correctedL ?? size_l);
  const beschreibung    = buildJeansDescription(brand, jeansModel, size_w, correctedL ?? size_l, wash_details, condition, normalizedFit, measurements);

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
    hs_code:         '6309000',
    product_images:  productFiles,
    measurement_images: measIdx.map(i => files[i]).filter(Boolean),
  };
}
