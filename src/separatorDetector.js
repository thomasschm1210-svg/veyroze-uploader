import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-latest'];
const RETRYABLE = new Set([429, 503]);
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

const SKU_PATTERN = /^[A-Za-z]{0,4}\d{3,8}$/;

const PROMPT = `You receive ONE photo. Decide if it is a SEPARATOR PHOTO that starts a new product.

A SEPARATOR PHOTO has ALL of these:
1. The dominant subject is a transparent or milky-white plastic bag (Polyethylen-Folie, Polybeutel — often with a small hanging hole at the top).
2. On the bag surface, a HANDWRITTEN inventory code is visible, drawn in black marker (Edding) or pencil.
3. NO jeans product, NO ruler/tape measure, NO laundry care tag in the focus of the shot.

The inventory code (SKU) is typically a short alphanumeric string such as "LI8005", "48005", "A1234" — usually 4 to 8 characters, letters followed by digits, or pure digits. It is HANDWRITTEN, never printed.

The photo may be rotated. Read the code at any orientation.

Return ONLY a JSON object, no markdown, no prose:
{"isSeparator": true|false, "sku": "LI8005" | null}

Rules:
- If isSeparator is true, sku MUST be the handwritten code as you read it, uppercased, no spaces.
- Numbers printed on care labels, brand patches, size tags, barcodes or any garment text do NOT count — return isSeparator: false.
- If you see a plastic bag but cannot read a handwritten code, return isSeparator: false and sku: null.`;

async function toInlinePart(imagePath) {
  const buf = await sharp(imagePath)
    .rotate()
    .normalise()
    .sharpen()
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return { inlineData: { data: buf.toString('base64'), mimeType: 'image/jpeg' } };
}

function normaliseSku(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  return SKU_PATTERN.test(cleaned) ? cleaned : null;
}

export async function detectSeparator(imagePath) {
  if (!genAI) return { isSeparator: false, sku: null };

  let part;
  try { part = await toInlinePart(imagePath); }
  catch { return { isSeparator: false, sku: null }; }

  for (const modelName of MODELS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const model  = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent([PROMPT, part]);
        const text   = result.response.text().trim();
        const match  = text.match(/\{[\s\S]*\}/);
        if (!match) return { isSeparator: false, sku: null };
        const obj = JSON.parse(match[0]);
        const sku = normaliseSku(obj.sku);
        if (obj.isSeparator === true && sku) return { isSeparator: true, sku };
        return { isSeparator: false, sku: null };
      } catch (err) {
        const status = err?.status;
        if (status === 404) break;
        if (RETRYABLE.has(status) && attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        if (RETRYABLE.has(status)) break;
        return { isSeparator: false, sku: null };
      }
    }
  }
  return { isSeparator: false, sku: null };
}
