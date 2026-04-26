/**
 * RunLogger — schreibt eine persistente Log-Datei für jeden Lauf.
 * Format: menschenlesbar + maschinenlesbar (jede Zeile ein JSON-Event).
 */

import fs   from 'fs';
import path from 'path';

export class RunLogger {
  constructor(logPath) {
    this.path      = logPath;
    this.startedAt = new Date();
    this.events    = [];
    this.stats     = {
      totalImages:    0,
      duplicates:     0,
      errors:         0,
      reviewItems:    0,
      processed:      0,
      savedMB:        0,
    };

    // Header schreiben
    this._writeHeader();
  }

  _writeHeader() {
    const header = [
      '═'.repeat(60),
      `  VEYROZE UPLOADER v3 — RUN LOG`,
      `  Gestartet: ${this.startedAt.toLocaleString('de-DE')}`,
      `  Logdatei:  ${this.path}`,
      '═'.repeat(60),
      '',
    ].join('\n');
    fs.writeFileSync(this.path, header, 'utf8');
  }

  _append(line) {
    fs.appendFileSync(this.path, line + '\n', 'utf8');
  }

  _ts() {
    return new Date().toTimeString().slice(0, 8);
  }

  info(msg)    { this._append(`[${this._ts()}] INFO    ${msg}`); }
  success(msg) { this._append(`[${this._ts()}] OK      ${msg}`); }
  warn(msg)    { this._append(`[${this._ts()}] WARN    ${msg}`); }
  error(msg)   { this._append(`[${this._ts()}] ERROR   ${msg}`); }

  // Schreibt ein strukturiertes Produkt-Ergebnis ins Log
  product(groupIndex, product, imageFiles, destination) {
    this.stats.processed++;
    const title = [product.brand, product.model, product.size].filter(Boolean).join(' ') || `Produkt ${groupIndex}`;
    this._append('');
    this._append(`[${this._ts()}] PRODUKT ${groupIndex}`);
    this._append(`  Titel:     ${title}`);
    this._append(`  Marke:     ${product.brand}`);
    this._append(`  Modell:    ${product.model || '—'}`);
    this._append(`  Größe:     ${product.size  || '—'}`);
    this._append(`  Kategorie: ${product.category}`);
    this._append(`  Farbe:     ${product.color || '—'}`);
    this._append(`  Preis:     ${product.suggested_price} EUR`);
    this._append(`  Konfidenz: ${product._confidence}%`);
    this._append(`  Bilder:    ${imageFiles.length}  →  ${destination}`);
  }

  duplicate(filePath, originalPath) {
    this.stats.duplicates++;
    this._append(`[${this._ts()}] DUPLIKAT  ${path.basename(filePath)}  (Original: ${path.basename(originalPath)})`);
  }

  reviewItem(groupIndex, confidence) {
    this.stats.reviewItems++;
    this._append(`[${this._ts()}] REVIEW    Gruppe ${groupIndex}  (${confidence}% Konfidenz → _review/)`);
  }

  errorItem(filePath, reason) {
    this.stats.errors++;
    this._append(`[${this._ts()}] FEHLER    ${path.basename(filePath)}: ${reason}`);
  }

  // Abschlussbericht ans Log anhängen
  finalize(csvPath) {
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    const footer  = [
      '',
      '═'.repeat(60),
      '  ZUSAMMENFASSUNG',
      '═'.repeat(60),
      `  Laufzeit:          ${elapsed}s`,
      `  Bilder gesamt:     ${this.stats.totalImages}`,
      `  Verarbeitet:       ${this.stats.processed}`,
      `  Duplikate:         ${this.stats.duplicates}`,
      `  Review:            ${this.stats.reviewItems}`,
      `  Fehler:            ${this.stats.errors}`,
      `  Gespeichert (MB):  ${this.stats.savedMB}`,
      csvPath ? `  CSV-Export:        ${csvPath}` : '  CSV-Export:        —',
      '═'.repeat(60),
    ].join('\n');
    fs.appendFileSync(this.path, footer + '\n', 'utf8');
    return this.stats;
  }
}
