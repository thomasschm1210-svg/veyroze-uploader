import path from 'path';

const POOL = [
  { typ: "Jeans",  marke: "Levi's",    stil: "Bootcut",   farbe: "Blau",    material: "Denim",  groesse: "W33/L32", preis: 44.90, details: ["Bootcut Schnitt", "5-Pocket", "leichte Waschung"] },
  { typ: "Jeans",  marke: "Levi's",    stil: "Slim Fit",  farbe: "Schwarz", material: "Denim",  groesse: "W30/L32", preis: 49.90, details: ["Slim Fit", "dunkle Waschung", "Metallic-Knöpfe"] },
  { typ: "Jeans",  marke: "Levi's",    stil: "Straight",  farbe: "Blau",    material: "Denim",  groesse: "W34/L30", preis: 39.90, details: ["Straight Cut", "mittlere Waschung", "klassisch"] },
  { typ: "Jeans",  marke: "Levi's",    stil: "Bootcut",   farbe: "Grau",    material: "Denim",  groesse: "W32/L32", preis: 44.90, details: ["Bootcut", "graue Waschung", "Original Leder-Label"] },
  { typ: "Jeans",  marke: "Levi's",    stil: "Slim Fit",  farbe: "Blau",    material: "Denim",  groesse: "W31/L34", preis: 44.90, details: ["Slim Fit", "helle Waschung", "klassische Nieten"] },
  { typ: "Jacke",  marke: "Redskins",  stil: "Biker",     farbe: "Schwarz", material: "Leder",  groesse: "M",       preis: 129.90, details: ["Echtleder", "Reißverschluss vorne", "Brusttaschen"] },
  { typ: "Jacke",  marke: "Oakwood",   stil: "Vintage",   farbe: "Braun",   material: "Leder",  groesse: "L",       preis: 149.90, details: ["Echtleder", "Vintage-Optik", "Innenknöpfe"] },
  { typ: "Jacke",  marke: "Unbekannt", stil: "Biker",     farbe: "Schwarz", material: "Leder",  groesse: "S",       preis: 89.90,  details: ["Echtleder", "Vintage-Patina", "Rücken-Panel"] },
  { typ: "Jacke",  marke: "Unbekannt", stil: "Vintage",   farbe: "Braun",   material: "Leder",  groesse: "XL",      preis: 99.90,  details: ["Weiches Leder", "Druckknöpfe", "Brusttasche"] },
  { typ: "Boot",   marke: "Unbekannt", stil: "Harness",   farbe: "Schwarz", material: "Leder",  groesse: "42",      preis: 89.90,  details: ["Harness-Riemen", "Gummisohle", "Vintage-Leder"] },
  { typ: "Boot",   marke: "Unbekannt", stil: "Chelsea",   farbe: "Braun",   material: "Leder",  groesse: "43",      preis: 79.90,  details: ["Chelsea-Stil", "elastische Einsätze", "Ledersohle"] },
  { typ: "Boot",   marke: "Unbekannt", stil: "Cowboy",    farbe: "Braun",   material: "Leder",  groesse: "41",      preis: 99.90,  details: ["Western-Stil", "Blockabsatz", "handgenähte Nähte"] },
  { typ: "Shirt",  marke: "Unbekannt", stil: "Slim Fit",  farbe: "Weiß",    material: "Textil", groesse: "M",       preis: 29.90,  details: ["Slim Fit", "Vintage-Wash", "Rundhals"] },
];

function typeHint(files) {
  const name = path.basename(files[0] || '').toLowerCase();
  if (/jean|denim/.test(name))           return 'Jeans';
  if (/jack|leder|leather|mantel/.test(name)) return 'Jacke';
  if (/boot|schuh|shoe/.test(name))      return 'Boot';
  if (/shirt|top|tee/.test(name))        return 'Shirt';
  return null;
}

export async function mockKiAnalyze(imageFiles) {
  await new Promise(r => setTimeout(r, 150 + Math.random() * 300));

  const hint = typeHint(imageFiles);
  const pool = hint ? POOL.filter(p => p.typ === hint) : POOL;
  const pick = pool[Math.floor(Math.random() * pool.length)];

  const markePrefix = (pick.marke && pick.marke !== 'Unbekannt') ? pick.marke + ' ' : '';
  const beschreibung = `Material: ${pick.material}\nCondition: sehr gut 🧼\n\nDetails: ${pick.details.join(', ')}\n\nMeasurements:\n  Length: —cm\n  Shoulder width: —cm\n  Bottom width: —cm\n\nEach piece carries its own story — delivered clean and ready to wear.`;
  const collectionMap = { Jeans: 'Jeans', Jacke: 'Jackets', Boot: 'Boots', Shirt: 'Shirts' };
  return {
    produkttyp:      pick.typ,
    marke:           pick.marke,
    farbe:           pick.farbe,
    stil:            pick.stil,
    material:        pick.material,
    groesse:         pick.groesse,
    zustand:         'sehr gut',
    details:         pick.details,
    beschreibung,
    collection:      collectionMap[pick.typ] || 'Vintage',
    titel_vorschlag: `${markePrefix}${pick.stil} ${pick.typ} ${pick.farbe} (${pick.groesse})`.trim(),
    suggested_price: pick.preis,
    konfidenz:       'mittel',
    _mock:           true,
  };
}
