/**
 * Regelbasierter Produkt-Parser.
 * Extrahiert Marke, Modell, Größe, Kategorie, Farbe und Preis aus OCR-Text.
 *
 * Erweiterbar: neue Marken/Kategorien einfach in die Listen eintragen.
 * KI-Adapter kann später die parse()-Funktion überschreiben.
 */

// ─── Datenbanken ────────────────────────────────────────────────────────────────

const BRANDS = [
  // Sneaker / Sport
  'Nike', 'Adidas', 'Jordan', 'New Balance', 'Puma', 'Reebok', 'Converse',
  'Vans', 'Asics', 'Salomon', 'On Running', 'Hoka', 'Brooks', 'Saucony',
  'Under Armour', 'Fila',
  // Fashion
  'Supreme', 'Off-White', 'Stone Island', 'Palace', 'Stüssy', 'Carhartt',
  'The North Face', 'Arc\'teryx', 'Patagonia', 'Columbia', 'Ralph Lauren',
  'Tommy Hilfiger', 'Lacoste', 'Calvin Klein', 'Hugo Boss', 'Levi\'s',
  'Diesel', 'G-Star', 'Wrangler', 'Lee',
  // Luxury
  'Gucci', 'Louis Vuitton', 'Balenciaga', 'Versace', 'Moschino', 'Prada',
  'Burberry', 'Moncler', 'Canada Goose', 'Woolrich',
  // Sports Apparel
  'Gymshark', 'Lululemon', 'Champion', 'Kappa', 'Umbro', 'Hummel',
];

const CATEGORIES = {
  sneaker:   /\b(sneaker|shoe|schuh|trainer|runner|laufschuh|turnschuh|air\s*max|yeezy|boost|jordan|dunk|force\s*1|ultraboost|gazelle|stan\s*smith)\b/i,
  jacke:     /\b(jacket|jacke|hoodie|pullover|sweater|sweatshirt|zip|fleece|windbreaker|puffer|down\s*jacket|daunenjacke|anorak|shell)\b/i,
  hose:      /\b(pants|trousers|jeans|hose|jogger|chino|shorts|leggings|tights)\b/i,
  shirt:     /\b(t-?shirt|tee|polo|longsleeve|oberteil|top|bluse|hemd|jersey)\b/i,
  accessory: /\b(cap|hat|mütze|beanie|scarf|schal|bag|tasche|rucksack|backpack|wallet|geldbeutel|belt|gürtel|sock|socken|glove|handschuh)\b/i,
  sport:     /\b(jersey|trikot|kit|shorts|tracksuit|trainingsanzug|sport)\b/i,
};

// EU-Schuhgrößen
const EU_SIZE_RE   = /\b(EU|Gr\.?|Size|Größe)?\s*([3-4][0-9]|[5-9][0-9])\b/i;
// Konfektionsgrößen
const CONF_SIZE_RE = /\b(X{0,2}S|X{0,2}L|M)\b/;
// Zoll (US-Schuh)
const US_SIZE_RE   = /\b(US|UK)\s*([0-9]{1,2}(\.5)?)\b/i;

const COLOR_KEYWORDS = {
  'Schwarz':  /\b(black|schwarz|noir)\b/i,
  'Weiß':     /\b(white|weiß|weiss|blanc)\b/i,
  'Rot':      /\b(red|rot|rouge)\b/i,
  'Blau':     /\b(blue|blau|navy|bleu)\b/i,
  'Grün':     /\b(green|grün|olive|khaki|vert)\b/i,
  'Grau':     /\b(grey|gray|grau|gris)\b/i,
  'Braun':    /\b(brown|braun|tan|camel|brun)\b/i,
  'Beige':    /\b(beige|cream|sand|off-?white)\b/i,
  'Orange':   /\b(orange)\b/i,
  'Pink':     /\b(pink|rosa|rose)\b/i,
  'Gelb':     /\b(yellow|gelb|jaune)\b/i,
  'Lila':     /\b(purple|violet|lila)\b/i,
  'Multicolor': /\b(multi|multicolou?r|bunt|colourful)\b/i,
};

// Preishinweise im Text: "89,99", "€ 120", "UVP 150"
const PRICE_RE = /(?:€|EUR|UVP|RRP|Price|Preis)?\s*([1-9][0-9]{1,3})[,.]?([0-9]{0,2})/i;

// ─── Hauptfunktion ──────────────────────────────────────────────────────────────

export function parseProductText(ocrText, filename = '') {
  const haystack = `${ocrText} ${filename}`;

  const brand    = detectBrand(haystack);
  const category = detectCategory(haystack);
  const size     = detectSize(haystack);
  const color    = detectColor(haystack);
  const price    = detectPrice(ocrText);
  const model    = detectModel(haystack, brand);

  const description = buildDescription({ brand, model, category, size, color });
  const features    = buildFeatures({ brand, model, category, size, color });

  return {
    brand:           brand   || 'Unbekannt',
    model:           model   || '',
    size:            size    || '',
    category:        category|| 'Bekleidung',
    condition:       'Gebraucht',    // Wird manuell überschrieben oder aus Dateiname gelesen
    color:           color   || '',
    features,
    description,
    suggested_price: price   || suggestPrice(category, brand),
    _confidence:     calcConfidence({ brand, model, size, color }),
  };
}

// ─── Erkennungshelfer ───────────────────────────────────────────────────────────

function detectBrand(text) {
  for (const brand of BRANDS) {
    // Wortgrenze-toleranter Match (auch teilweise: "ADIDAS" → "Adidas")
    const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) return brand;
  }
  return null;
}

function detectCategory(text) {
  for (const [cat, re] of Object.entries(CATEGORIES)) {
    if (re.test(text)) return capitalise(cat);
  }
  return null;
}

function detectSize(text) {
  const eu = text.match(EU_SIZE_RE);
  if (eu) return `EU ${eu[2]}`;
  const us = text.match(US_SIZE_RE);
  if (us) return `${us[1].toUpperCase()} ${us[2]}`;
  const conf = text.match(CONF_SIZE_RE);
  if (conf) return conf[0].toUpperCase();
  return null;
}

function detectColor(text) {
  for (const [color, re] of Object.entries(COLOR_KEYWORDS)) {
    if (re.test(text)) return color;
  }
  return null;
}

function detectPrice(text) {
  const m = text.match(PRICE_RE);
  if (!m) return null;
  const raw = parseFloat(`${m[1]}.${(m[2] || '00').padEnd(2, '0')}`);
  // Plausibilitätsprüfung: 5–2000 EUR
  return (raw >= 5 && raw <= 2000) ? raw : null;
}

function detectModel(text, brand) {
  if (!brand) return null;
  // Suche nach Wörtern direkt nach dem Markennamen
  const re = new RegExp(`${brand}\\s+([A-Z][\\w\\s-]{2,30})`, 'i');
  const m  = text.match(re);
  if (m) return m[1].trim().replace(/\s+/g, ' ').slice(0, 40);
  return null;
}

// ─── Beschreibung & Features ────────────────────────────────────────────────────

function buildDescription({ brand, model, category, size, color }) {
  const parts = [brand, model].filter(Boolean).join(' ');
  const sizeStr  = size  ? ` in Größe ${size}` : '';
  const colorStr = color ? ` in ${color}` : '';
  const catStr   = category || 'Artikel';

  return `${parts || 'Dieser'} ${catStr}${colorStr}${sizeStr} ist in gutem Zustand und bereit für einen neuen Besitzer. Alle Details sind auf den Fotos zu sehen.`;
}

function buildFeatures({ brand, model, category, size, color }) {
  const f = [];
  if (brand)    f.push(`Marke: ${brand}`);
  if (model)    f.push(`Modell: ${model}`);
  if (size)     f.push(`Größe: ${size}`);
  if (color)    f.push(`Farbe: ${color}`);
  if (category) f.push(`Kategorie: ${category}`);
  if (f.length < 3) f.push('Zustand: Gebraucht', 'Versand: sicher verpackt');
  return f.slice(0, 5);
}

// Kategorie-basierte Richtwerte (Secondhand-Markt)
function suggestPrice(category, brand) {
  const isLuxury = ['Gucci','Louis Vuitton','Balenciaga','Versace','Prada','Burberry','Moncler','Canada Goose'].includes(brand);
  const isPremium = ['Supreme','Off-White','Stone Island','Arc\'teryx','Salomon','On Running'].includes(brand);

  const base = {
    Sneaker:   isLuxury ? 250 : isPremium ? 120 : 60,
    Jacke:     isLuxury ? 300 : isPremium ? 150 : 45,
    Hose:      isLuxury ? 180 : isPremium ?  90 : 30,
    Shirt:     isLuxury ? 120 : isPremium ?  60 : 20,
    Accessory: isLuxury ? 200 : isPremium ?  80 : 25,
  };

  return base[category] ?? (isLuxury ? 150 : isPremium ? 70 : 25);
}

function calcConfidence({ brand, model, size, color }) {
  let score = 0;
  if (brand) score += 40;
  if (model) score += 25;
  if (size)  score += 20;
  if (color) score += 15;
  return score; // 0–100
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
