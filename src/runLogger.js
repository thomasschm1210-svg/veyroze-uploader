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

  // Audit-Trail der Separator-Erkennung — eine Zeile pro Bild + Gruppen-Sanity-Check
  separators(items, groups) {
    if (!Array.isArray(items) || items.length === 0) return;

    this._append('');
    this._append('─'.repeat(60));
    this._append('  PHASE 1 — TRENNBILD-AUDIT');
    this._append('─'.repeat(60));

    const failedChunks = new Map();
    for (const it of items) {
      if (it.chunkFailed && it.chunkIndex != null && !failedChunks.has(it.chunkIndex)) {
        failedChunks.set(it.chunkIndex, it.failReason || 'unknown');
      }
    }
    if (failedChunks.size > 0) {
      for (const [idx, reason] of failedChunks) {
        this._append(`  ⚠ Chunk ${idx} fehlgeschlagen (${reason}) — alle Bilder darin als NICHT-Separator markiert`);
      }
      this._append('');
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const base = path.basename(it.path);
      const sep  = it.isSeparator ? 'Separator: JA ' : 'Separator: nein';
      const sku  = it.isSeparator
        ? `SKU=${it.sku}`
        : (it.rejectedSku ? `verworfen=${it.rejectedSku}` : '             ');
      const verify = it.verified === true ? 'verify=OK'
                  : it.verified === false ? `verify=ABGELEHNT(${it.verifyMismatch})`
                  : '';
      const meta = [
        `Gr.${it.groupIndex}`,
        `Chunk ${it.chunkIndex}`,
        it.modelUsed || '—',
        verify,
        it.skuCollision ? '⚠ SKU-DOPPELT' : '',
        it.chunkFailed ? `FAIL:${it.failReason}` : '',
      ].filter(Boolean).join(' | ');
      this._append(`  ${String(i).padStart(3, '0')}  ${base.padEnd(28)}  ${sep}  ${sku.padEnd(18)}  ${meta}`);
    }

    this._append('');
    this._append(`  Gruppen-Übersicht (${groups.length} Gruppen):`);

    const sizes = groups.map(g => g.productImages.length).filter(n => n > 0).sort((a, b) => a - b);
    const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
    const oversizeThreshold = Math.max(median * 1.8, median + 4);

    for (const g of groups) {
      const tueten = g.productImages.filter(p =>
        items.find(it => it.path === p)?.isSeparator
      );
      const tuetenIdx = tueten.map(p => items.findIndex(it => it.path === p));
      const warnings = [];
      if (tueten.length === 0) warnings.push('⚠ KEINE TÜTE');
      if (tueten.length >  1) warnings.push(`⚠ ${tueten.length} TÜTEN (doppelt)`);
      if (String(g.sku).startsWith('UNKNOWN_')) warnings.push('⚠ UNKNOWN-SKU');
      if (median > 0 && g.productImages.length > oversizeThreshold) {
        warnings.push(`⚠ überdurchschnittlich groß (Median ${median})`);
      }
      const status = warnings.length ? warnings.join(' ') : 'OK';
      this._append(
        `    Gruppe ${g.groupIndex}  SKU=${g.sku.padEnd(8)}  ${String(g.productImages.length).padStart(2)} Bilder  Tüten=${tueten.length}${tuetenIdx.length ? ` [${tuetenIdx.join(',')}]` : ''}  ${status}`
      );
    }
    this._append('─'.repeat(60));
    this._append('');
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
