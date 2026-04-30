import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { mockKiAnalyze as runMock } from './mockKi.js';

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const PROMPT = `You are analyzing photos of a secondhand jeans product for a Shopify listing.
The photos may include: front/back shots of the jeans, the inner label (brand/model/size), the wash care tag (country of origin), a bag/sticker with a SKU number, and measurement photos (jeans next to a ruler or tape measure).

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
  "country_of_origin": "country from wash care tag, e.g. Mexico, Pakistan, Bangladesh — null if not visible",
  "sku": "number or code from the bag/sticker label — null if not visible",
  "confidence": "high | medium | low",
  "utility_image_indices": [2, 4]
}

Rules:
- Read size_w and size_l as integers from the label (e.g. W30/L34 → size_w: 30, size_l: 34)
- measurements must be estimated in cm from the product photos if visible
- If a value is truly not determinable, use null
- confidence reflects overall certainty across all extracted fields
- utility_image_indices: 0-based indices of images that should NOT appear in the Shopify listing — only filter out: (1) photos where a ruler or tape measure is placed next to the jeans, (2) photos showing only a SKU bag or sticker. Do NOT filter out label/badge photos (e.g. the brand patch on the jeans) — those are valid product photos. Use [] if no images need filtering.`;

async function toInlinePart(filePath) {
  const data = (await fs.promises.readFile(filePath)).toString('base64');
  const ext  = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { inlineData: { data, mimeType: mime } };
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
  const parts = [brand, model, fit, 'Jeans'].filter(Boolean);
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

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-latest'];

async function callGemini(imageParts) {
  for (const modelName of MODELS) {
    try {
      const model  = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent([PROMPT, ...imageParts]);
      return result.response.text().trim();
    } catch (err) {
      const status = err.status ?? err.errorDetails?.[0]?.status;
      if (status === 503 || status === 429 || status === 404) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Alle Gemini-Modelle nicht erreichbar. Bitte später erneut versuchen.');
}

export async function mockKiAnalyze(imageFiles, opts = {}) {
  if (!genAI) return runMock(imageFiles);

  const files = imageFiles.slice(0, 8);
  const imageParts = await Promise.all(files.map(toInlinePart));

  const raw = await callGemini(imageParts);

  let extracted;
  try {
    extracted = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    extracted = match ? JSON.parse(match[0]) : {};
  }

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
  } = extracted;

  const utilitySet   = new Set(Array.isArray(utility_image_indices) ? utility_image_indices : []);
  const productFiles = files.filter((_, i) => !utilitySet.has(i));

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

  const titel_vorschlag = buildTitle(brand, jeansModel, fit, size_w, correctedL ?? size_l);
  const beschreibung    = buildJeansDescription(brand, jeansModel, size_w, correctedL ?? size_l, wash_details, condition, fit, measurements);

  const konfidenzMap = { high: 'hoch', medium: 'mittel', low: 'niedrig' };

  return {
    // Legacy-Felder (pipeline.js display)
    produkttyp:      'Jeans',
    marke:           brand,
    stil:            fit,
    groesse:         correctedSize,
    zustand:         condition,
    titel_vorschlag,
    beschreibung,
    konfidenz:       konfidenzMap[confidence] || 'mittel',
    collection:      'Jeans',

    // Neue Felder (Shopify-Upload)
    modell:          jeansModel,
    fit,
    size_w,
    size_l,
    size_label:      labelSize,
    size_corrected:  correctedSize,
    length_corrected: lengthCorrected,
    wash_details,
    condition,
    measurements,
    country_of_origin: country_of_origin || 'Pakistan',
    sku,
    taxable,
    tags,
    collections,
    shipping_weight_kg: weight,
    hs_code:         '6309000',
    product_images:  productFiles,
  };
}
