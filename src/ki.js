import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { mockKiAnalyze as runMock } from './mockKi.js';

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const SYSTEM = `You are a product analyst for Veyroze, a vintage/secondhand reseller on Shopify.
Analyze the provided product photos and return structured JSON.

Veyroze sells: Levi's jeans (bootcut/slim/straight, W28-W38/L30-L34), vintage leather jackets (Redskins, Oakwood, unbranded, S-XL), harness/chelsea/cowboy boots (EU 40-46), vintage shirts.
Price range: €29.90–€169.90.

Return ONLY valid JSON, no markdown, no explanation:
{
  "produkttyp": "Jeans|Jacke|Boot|Shirt",
  "marke": "brand name or Unbekannt",
  "farbe": "color in English",
  "stil": "style (Bootcut|Slim Fit|Straight|Biker|Vintage|Harness|Chelsea|Cowboy|Slim Fit)",
  "material": "Denim|Leder|Textil|...",
  "groesse": "size (W33/L32 for jeans, S/M/L/XL for jackets, EU size for boots)",
  "zustand": "top 🧼|sehr gut|gut|akzeptabel",
  "details": ["detail1", "detail2", "detail3"],
  "titel_vorschlag": "Shopify title like: Levi's Bootcut Jeans Blue (W33/L32)",
  "suggested_price": 44.90,
  "konfidenz": "hoch|mittel|niedrig",
  "beschreibung": "multi-line Veyroze description"
}

Description format (use \\n for newlines):
Material: [material]
Condition: [zustand]

Details: [detail1, detail2, ...]

Each piece carries its own story — delivered clean and ready to wear.`;

function toBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

function mediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png')  return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

export async function mockKiAnalyze(imageFiles) {
  if (!client) return runMock(imageFiles);

  // Max 4 images to stay within token limits
  const files = imageFiles.slice(0, 4);
  const imageContent = files.map(f => ({
    type: 'image',
    source: { type: 'base64', media_type: mediaType(f), data: toBase64(f) },
  }));

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        ...imageContent,
        { type: 'text', text: 'Analyze this secondhand product and return the JSON.' },
      ],
    }],
  });

  const raw = msg.content[0]?.text?.trim() || '{}';
  let ki;
  try {
    ki = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    ki = match ? JSON.parse(match[0]) : {};
  }

  ki.konfidenz = ki.konfidenz || 'mittel';
  return ki;
}
