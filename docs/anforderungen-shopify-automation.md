# Anforderungsdokument: Vollautomatische Shopify-Produkterstellung

**Projekt:** Veyroze Uploader  
**Datum:** 2026-04-29  
**Leitprinzip:** Zero-Touch-Listing — jedes Shopify-Feld wird automatisch befüllt. Der Nutzer prüft nur noch und drückt "Veröffentlichen". Kein manuelles Eintippen.

---

## 1. Überblick & Ziel

Der Kunde fotografiert gebrauchte Jeans und legt die Fotos in Ordnern ab. Das System analysiert die Bilder per KI, extrahiert alle relevanten Produktdaten und erstellt in Shopify einen vollständig ausgefüllten Entwurf. Der Kunde muss kein einziges Feld selbst ausfüllen.

**Input:** Ordner mit Produktfotos (Frontal, Rücken, Etikett, Waschtag, Tüten-Bild mit SKU)  
**Output:** Fertiger Shopify-Entwurf, bereit zur Veröffentlichung

---

## 2. Bildanalyse durch KI (Claude Haiku Vision)

Die KI liest aus den Bildern:

| Quelle | Extrahierte Daten |
|---|---|
| Jeans-Etikett (innen) | Marke, Modell (z.B. "512"), W-Größe, L-Größe, Fit-Typ |
| Waschtag (Pflegeetikett) | Herkunftsland (z.B. "Made in Mexico") |
| Tütchen / Beutel-Etikett | SKU-Nummer |
| Gesamtfotos (Frontal + Rücken) | Zustand (Condition), Wash/Details, Fit, tatsächliche Maße |

**Maße aus den Bildern (Measurements):**
- Length (Länge)
- Waist (Bundweite)
- Leg opening (Beinöffnung)

---

## 3. Produktfelder — vollständige Spezifikation

### 3.1 Produktstatus
- Immer: **Entwurf** (`draft`)
- Der Kunde aktiviert manuell nach Prüfung

### 3.2 Medien
- Alle Fotos des Produkts werden hochgeladen
- Tüten-Bild und Waschtag-Foto können optional ausgeschlossen werden (nur für Datenextraktion)

### 3.3 Produkttitel
Format: `[Marke] [Modell] [Fit] Jeans (W../L..)`  
Beispiel: `Levi's 512 bootcut Jeans (W30/L34)`

- Marke + Modell vom Jeans-Etikett
- Fit-Typ vom Etikett oder aus KI-Bilderkennung
- W../L.. = Größe vom Etikett

**Sonderfall Längenkorrektur:**  
Wenn gemessene Länge < 100 cm, aber Etikett zeigt z.B. L32 → tatsächlich L30:
- Titel zeigt: `(W30/L30)`
- Beschreibung zeigt: `fits W30/L30`
- Tag enthält: `W30/L32` (Original-Etikett-Größe)

### 3.4 Beschreibung
Festes Format:

```
[Marke] [Modell]   Size: W../L.. 🩻

Details: [Wash-Beschreibung] 🔍
Condition: [Zustand] 🧤
Fit: [Fit-Typ]

Measurements 📏:
Length: [X] cm
Waist: [X] cm
Leg opening: [X] cm
```

Beispiel:
```
Levi's 512   Size: W30/L34 🩻

Details: cool denim wash 🔍
Condition: top 🧤
Fit: bootcut

Measurements 📏:
Length: 98 cm
Waist: 42 cm
Leg opening: 20 cm
```

### 3.5 Kategorie
- Wird von KI befüllt (z.B. "Jeans" in "Pants")

### 3.6 Preis & Steuer

| Ordnertyp | Umsatzsteuer | Tag |
|---|---|---|
| Standard (Differenzbesteuerung) | **Deaktiviert** (`taxable: false`) | `diff` |
| Ordner heißt "Plug" | **Aktiviert** (`taxable: true`) | `PLUG` |
| Immer (alle Produkte) | — | `KI` |

- Preis wird vom Nutzer nach der Prüfung gesetzt (initial leer / 0,00 €)

### 3.7 Inventar

| Feld | Wert |
|---|---|
| Standort "Veyroze UG" | **1** |
| Standort "Lager Bamberg" | 0 |
| Menge verfolgen | Aktiviert |
| Kauf bei Leerbestand | Deaktiviert |
| SKU | Nummer vom Tüten-Bild |

### 3.8 Kollektionen

Zwei Kollektionen werden immer gesetzt:
1. **Jeans** (immer)
2. **W[Größe]** — z.B. `W31`, `W32`, `W33` (basierend auf W-Größe vom Etikett)

### 3.9 Tags

Alle Tags eines Produkts:
- `KI` — immer
- `diff` — bei Standard-Produkten (Differenzbesteuerung)
- `PLUG` — wenn Ordner "Plug" ist
- `W../L..` — Größen-Tag (bei Längenkorrektur: Original-Etiketten-Größe)

### 3.10 Kategorie-Metafelder

| Metafeld | Wert |
|---|---|
| Größe | W.. (z.B. `W30`) |
| Farbe | (optional, aus KI) |
| Stoff | (optional, aus KI) |

### 3.11 Versand

| Feld | Wert |
|---|---|
| Physisches Produkt | Aktiviert |
| Versandgewicht | Siehe Tabelle unten |
| Herkunftsland | Vom Waschtag; falls nicht erkennbar: `Pakistan` als Fallback |
| HS-Code | `6309000` (gebrauchte Bekleidung) |

**Versandgewicht nach W-Größe:**

| W-Größe | Gewicht |
|---|---|
| W ≤ 29 | 0,7 kg |
| W 30 – W 35 | 0,8 kg |
| W ≥ 36 | 0,9 kg |

---

## 4. Eingabe-Struktur (Ordner-Konvention)

```
uploads/
  Levi's 512/          ← Modell-Ordner (Standard → "diff")
    front.jpg
    back.jpg
    label.jpg          ← Jeans-Etikett (W/L, Modell)
    washtag.jpg        ← Waschtag (Herkunftsland)
    bag.jpg            ← Tüten-Bild (SKU)

  Plug/                ← Sonder-Ordner → "PLUG" + Steuer aktiv
    ...
```

- Jeder Unterordner = ein Produkt
- Bilder werden von der KI automatisch nach Typ klassifiziert (Etikett, Waschtag, Tüte, Produktfoto)

---

## 5. Qualitätsanforderungen

- **Vollständigkeit:** Kein Pflichtfeld darf leer bleiben. Ist ein Wert nicht erkennbar, wird ein sinnvoller Fallback gesetzt (kein leeres Feld).
- **Korrektheit:** KI-Werte werden mit Konfidenzwert intern geloggt; unsichere Werte können visuell markiert werden.
- **Idempotenz:** Doppelter Upload desselben Ordners erstellt kein Duplikat in Shopify.
- **Entwurf bleibt Entwurf:** Das System veröffentlicht nie selbstständig. Status bleibt immer `draft` bis der Nutzer manuell veröffentlicht.

---

## 6. Technische Umsetzung (Implementierungsplan)

### Phase 1 — KI-Kern
- `src/mockKi.js` → `src/ki.js` mit Claude Haiku 4.5 Vision
- Prompt engineered für alle Extraktions-Aufgaben (Etikett, Waschtag, Tüte, Maße)
- Längenkorrektur-Logik im Pipeline-Schritt

### Phase 2 — Business-Logik
- Ordnername-Erkennung ("Plug" vs. Standard)
- Versandgewicht-Berechnung aus W-Größe
- Tag-Zusammenstellung
- Kollektionen-Mapping W-Größe → Kollektion-ID

### Phase 3 — Shopify-API
- `src/shopify.js` vollständig mit allen Feldern befüllen:
  - `taxable`, `status: draft`, `variants[].sku`, `variants[].weight`
  - Kollektionen via `collects`-Endpunkt
  - Metafelder via `metafields`-Endpunkt
  - Internationaler Versand: `origin_country_code`, `harmonized_system_code`
- `POST /api/shopify/:runId/:productIdx` in `server.js` verdrahten

---

## 7. Nicht in Scope

- Preis wird **nicht** automatisch gesetzt (Nutzer entscheidet)
- Kein automatisches Veröffentlichen
- Keine Varianten (jedes Stück ist ein eigenes Einzelprodukt)
- Keine Kategorisierung jenseits von Jeans (zunächst nur Jeans-Workflow)
