/**
 * Generiert 10 synthetische Produktbilder + 3 Trennbilder für den E2E-Test.
 *
 * Bilder simulieren echte Fotos: farbiger Hintergrund, eingebetteter SVG-Text
 * mit Markennamen, Modell, Größe — wie ein Etikett oder Aufdruck.
 * Trennbilder: weiß/hellgrau, fast kein Text.
 */

import sharp from 'sharp';
import fs    from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = path.join(__dirname, 'fixtures');

// Ground-Truth Daten — das ist was der Parser finden soll
export const GROUND_TRUTH = [
  // Gruppe 1
  { file: '001_nike_airmax_front.jpg',   brand: 'Nike',          model: 'Air Max',       size: 'EU 42', category: 'Sneaker', color: 'Schwarz', price: 89  },
  { file: '002_nike_airmax_side.jpg',    brand: 'Nike',          model: 'Air Max',       size: 'EU 42', category: 'Sneaker', color: 'Schwarz', price: 89  },
  // TRENNER
  { file: '003_trenner.jpg',             separator: true },
  // Gruppe 2
  { file: '004_adidas_hoodie_front.jpg', brand: 'Adidas',        model: 'Classic Hoodie',size: 'L',     category: 'Jacke',   color: 'Grau',    price: 45  },
  // TRENNER
  { file: '005_trenner.jpg',             separator: true },
  // Gruppe 3
  { file: '006_supreme_tshirt.jpg',      brand: 'Supreme',       model: 'Box Logo Tee',  size: 'M',     category: 'Shirt',   color: 'Weiß',    price: 120 },
  { file: '007_supreme_tshirt_tag.jpg',  brand: 'Supreme',       model: 'Box Logo Tee',  size: 'M',     category: 'Shirt',   color: 'Weiß',    price: 120 },
  // TRENNER
  { file: '008_trenner.jpg',             separator: true },
  // Gruppe 4
  { file: '009_nb_sneaker.jpg',          brand: 'New Balance',   model: '574',           size: 'EU 44', category: 'Sneaker', color: 'Weiß',    price: 75  },
  // Gruppe 5
  { file: '010_northface_jacket.jpg',    brand: 'The North Face', model: 'Nuptse',       size: 'XL',    category: 'Jacke',   color: 'Schwarz', price: 180 },
  { file: '011_northface_label.jpg',     brand: 'The North Face', model: 'Nuptse',       size: 'XL',    category: 'Jacke',   color: 'Schwarz', price: 180 },
  // Gruppe 6
  { file: '012_levi_jeans.jpg',          brand: "Levi's",        model: '501',           size: 'W32 L32', category: 'Hose',  color: 'Blau',    price: 55  },
  // Gruppe 7
  { file: '013_puma_shorts.jpg',         brand: 'Puma',          model: 'Train Shorts',  size: 'S',     category: 'Hose',   color: 'Schwarz', price: 22  },
];

// ─── Bildgenerator ──────────────────────────────────────────────────────────────

const BG_COLORS = {
  'Schwarz':  { r: 30,  g: 30,  b: 30  },
  'Weiß':     { r: 245, g: 245, b: 240 },
  'Grau':     { r: 140, g: 140, b: 145 },
  'Blau':     { r: 40,  g: 80,  b: 160 },
  'Rot':      { r: 180, g: 40,  b: 40  },
};

function textColor(bgColor) {
  const lum = bgColor.r * 0.299 + bgColor.g * 0.587 + bgColor.b * 0.114;
  return lum > 128 ? '#111111' : '#FFFFFF';
}

function productSVG({ brand, model, size, color }) {
  const bg    = BG_COLORS[color] ?? { r: 200, g: 195, b: 190 };
  const fg    = textColor(bg);
  const bgHex = `rgb(${bg.r},${bg.g},${bg.b})`;

  // Simuliert ein Produktetikett / Aufdruck mit gut lesbarem Text
  return `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
  <rect width="800" height="600" fill="${bgHex}"/>
  <!-- Produkt-Silhouette (einfaches Rechteck als Platzhalter) -->
  <rect x="150" y="80" width="500" height="340" rx="12"
        fill="${bgHex}" stroke="${fg}" stroke-width="3" opacity="0.4"/>
  <!-- Marken-Logo-Bereich -->
  <rect x="200" y="110" width="400" height="70" rx="6" fill="${fg}" opacity="0.12"/>
  <!-- Markenname groß -->
  <text x="400" y="165" font-family="Arial,Helvetica,sans-serif" font-size="48"
        font-weight="bold" fill="${fg}" text-anchor="middle">${brand}</text>
  <!-- Modell -->
  <text x="400" y="230" font-family="Arial,Helvetica,sans-serif" font-size="32"
        fill="${fg}" text-anchor="middle" opacity="0.9">${model}</text>
  <!-- Größen-Etikett -->
  <rect x="310" y="260" width="180" height="50" rx="4" fill="${fg}" opacity="0.15"/>
  <text x="400" y="293" font-family="Arial,Helvetica,sans-serif" font-size="26"
        font-weight="bold" fill="${fg}" text-anchor="middle">Size: ${size}</text>
  <!-- Farbe -->
  <text x="400" y="360" font-family="Arial,Helvetica,sans-serif" font-size="20"
        fill="${fg}" text-anchor="middle" opacity="0.8">Color: ${color}</text>
  <!-- Barcode-Simulation -->
  <text x="400" y="430" font-family="monospace" font-size="14"
        fill="${fg}" text-anchor="middle" opacity="0.5">||||| ||||| |||| ||||| |||||</text>
</svg>`;
}

function separatorSVG(shade = 250) {
  return `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
  <rect width="800" height="600" fill="rgb(${shade},${shade},${shade})"/>
  <text x="400" y="310" font-family="Arial" font-size="18"
        fill="rgb(200,200,200)" text-anchor="middle" opacity="0.4">– – –</text>
</svg>`;
}

// Zweites Bild einer Gruppe: Etikett-Nahaufnahme (mehr Text)
function labelSVG({ brand, model, size, color }) {
  const bg  = { r: 248, g: 246, b: 240 };
  const fg  = '#111111';

  return `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
  <rect width="800" height="600" fill="rgb(248,246,240)"/>
  <rect x="100" y="60" width="600" height="480" rx="8"
        fill="white" stroke="#cccccc" stroke-width="2"/>
  <text x="400" y="150" font-family="Arial,Helvetica,sans-serif" font-size="42"
        font-weight="bold" fill="${fg}" text-anchor="middle">${brand}</text>
  <line x1="140" y1="170" x2="660" y2="170" stroke="#dddddd" stroke-width="1"/>
  <text x="400" y="220" font-family="Arial,Helvetica,sans-serif" font-size="28"
        fill="${fg}" text-anchor="middle">${model}</text>
  <text x="200" y="290" font-family="Arial,Helvetica,sans-serif" font-size="20"
        fill="#444" text-anchor="start">Größe / Size:</text>
  <text x="560" y="290" font-family="Arial,Helvetica,sans-serif" font-size="24"
        font-weight="bold" fill="${fg}" text-anchor="end">${size}</text>
  <text x="200" y="340" font-family="Arial,Helvetica,sans-serif" font-size="20"
        fill="#444" text-anchor="start">Farbe / Color:</text>
  <text x="560" y="340" font-family="Arial,Helvetica,sans-serif" font-size="22"
        fill="${fg}" text-anchor="end">${color}</text>
  <text x="200" y="390" font-family="Arial,Helvetica,sans-serif" font-size="18"
        fill="#888" text-anchor="start">Hergestellt in / Made in Portugal</text>
  <text x="400" y="470" font-family="monospace" font-size="13"
        fill="#aaaaaa" text-anchor="middle">4056561234567  EAN</text>
</svg>`;
}

// ─── Hauptfunktion ──────────────────────────────────────────────────────────────

export async function generateTestImages() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const generated = [];

  for (const entry of GROUND_TRUTH) {
    const outPath = path.join(OUT_DIR, entry.file);

    if (entry.separator) {
      const shade = 245 + Math.floor(Math.random() * 10);
      await sharp(Buffer.from(separatorSVG(shade)))
        .jpeg({ quality: 90 })
        .toFile(outPath);
    } else {
      // Entscheide welches SVG-Template anhand Dateiname
      const svgSrc = entry.file.includes('_tag') || entry.file.includes('_label')
        ? labelSVG(entry)
        : productSVG(entry);

      await sharp(Buffer.from(svgSrc))
        .jpeg({ quality: 92 })
        .toFile(outPath);
    }

    generated.push(outPath);
  }

  console.log(`${generated.length} Testbilder generiert → ${OUT_DIR}`);
  return OUT_DIR;
}

// Direkt ausführbar
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  generateTestImages().catch(console.error);
}
