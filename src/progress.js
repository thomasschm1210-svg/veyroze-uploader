// Fortschrittsanzeige mit Balken, Prozent und ETA.
// Schreibt direkt auf stdout mit \r (kein Zeilenumbruch) für In-Place-Update.

const BAR_WIDTH = 28;
const PHASES = ['Gruppieren', 'Duplikate', 'Komprimieren', 'Analyse', 'CSV-Export'];

export class Progress {
  constructor(total, label = 'Verarbeite') {
    this.total     = total;
    this.current   = 0;
    this.label     = label;
    this.startedAt = Date.now();
    this.phase     = '';
    this._lastLine = 0;
  }

  setPhase(phase) {
    this.phase = phase;
  }

  tick(detail = '') {
    this.current = Math.min(this.current + 1, this.total);
    this._render(detail);
  }

  set(n, detail = '') {
    this.current = Math.min(n, this.total);
    this._render(detail);
  }

  done(msg = '') {
    this.current = this.total;
    this._render(msg);
    process.stdout.write('\n');
  }

  _render(detail) {
    const pct     = this.total > 0 ? Math.round((this.current / this.total) * 100) : 0;
    const filled  = Math.round((pct / 100) * BAR_WIDTH);
    const bar     = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
    const eta     = this._eta();
    const phase   = this.phase ? ` [${this.phase}]` : '';
    const det     = detail ? `  ${detail}` : '';

    const line = `  \x1b[36m${bar}\x1b[0m ${String(pct).padStart(3)}%  ${eta}${phase}${det}`;

    // Zeile überschreiben
    process.stdout.write(`\r${line.padEnd(this._lastLine + 2)}`);
    this._lastLine = line.length;
  }

  _eta() {
    if (this.current === 0) return 'ETA: --:--';
    const elapsed  = (Date.now() - this.startedAt) / 1000;
    const rate     = this.current / elapsed;
    const remaining = (this.total - this.current) / rate;
    if (remaining < 1)    return 'ETA: <1s  ';
    if (remaining < 60)   return `ETA: ${Math.round(remaining)}s   `;
    const m = Math.floor(remaining / 60);
    const s = Math.round(remaining % 60);
    return `ETA: ${m}m${String(s).padStart(2,'0')}s`;
  }
}

// Einmalige Statuszeile ohne Tick-Mechanismus
export function printStatus(current, total, phase, detail = '') {
  const p = new Progress(total, phase);
  p.current = current;
  p.phase   = phase;
  p._render(detail);
}
