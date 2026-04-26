/**
 * FileRouter — verwaltet alle Ausgabe-Unterordner.
 *
 * Ordnerstruktur unter inputFolder/:
 *   _verarbeitet/          Trennbilder + erfolgreich verarbeitete Bilder
 *   _review/               Produkte mit Konfidenz < REVIEW_THRESHOLD
 *   _fehler/               Bilder die OCR/Analyse-Fehler verursacht haben
 *   _duplikate/            Erkannte Duplikat-Bilder
 *   _logs/                 Run-Logs und CSV-Exporte
 */

import fs   from 'fs';
import path from 'path';

export const REVIEW_THRESHOLD = 40;   // Konfidenz % — darunter → Review-Ordner

export class FileRouter {
  constructor(baseDir) {
    this.base        = baseDir;
    this.verarbeitet = path.join(baseDir, '_verarbeitet');
    this.review      = path.join(baseDir, '_review');
    this.fehler      = path.join(baseDir, '_fehler');
    this.duplikate   = path.join(baseDir, '_duplikate');
    this.logs        = path.join(baseDir, '_logs');

    // Alle Ordner sicher anlegen
    for (const d of [this.verarbeitet, this.review, this.fehler, this.duplikate, this.logs]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  // Verschiebt Dateien in einen benannten Produkt-Unterordner unter _verarbeitet
  moveToProcessed(files, groupLabel) {
    const dest = path.join(this.verarbeitet, groupLabel);
    return this._moveAll(files, dest);
  }

  // Verschiebt Bilder einer unsicheren Gruppe in den Review-Ordner
  moveToReview(files, groupLabel, confidence) {
    const dest = path.join(this.review, `${groupLabel}_${confidence}pct`);
    return this._moveAll(files, dest);
  }

  // Verschiebt ein Fehlerbild + schreibt Fehlernotiz
  moveToError(filePath, reason) {
    fs.mkdirSync(this.fehler, { recursive: true });
    const dest = path.join(this.fehler, path.basename(filePath));
    this._moveOne(filePath, dest);
    const note = dest + '.fehler.txt';
    fs.writeFileSync(note, `Fehler: ${reason}\nDatei: ${filePath}\nZeit: ${new Date().toISOString()}\n`);
    return dest;
  }

  // Verschiebt ein Duplikat
  moveToDuplicate(filePath, originalPath) {
    const dest = path.join(this.duplikate, path.basename(filePath));
    this._moveOne(filePath, dest);
    const note = dest + '.original.txt';
    fs.writeFileSync(note, `Duplikat von: ${originalPath}\nZeit: ${new Date().toISOString()}\n`);
    return dest;
  }

  // Gibt Pfad für CSV zurück (unter _logs/)
  csvPath(ts = Date.now()) {
    return path.join(this.logs, `shopify_import_${ts}.csv`);
  }

  // Gibt Pfad für das Run-Log zurück
  logPath(ts = Date.now()) {
    return path.join(this.logs, `run_${ts}.log`);
  }

  _moveAll(files, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    return files.map(f => this._moveOne(f, path.join(destDir, path.basename(f))));
  }

  _moveOne(src, dest) {
    if (!fs.existsSync(src)) return dest;
    // Kollision: eindeutigen Namen vergeben
    if (fs.existsSync(dest)) {
      const ext  = path.extname(dest);
      const base = path.basename(dest, ext);
      dest = path.join(path.dirname(dest), `${base}_${Date.now()}${ext}`);
    }
    fs.renameSync(src, dest);
    return dest;
  }
}
