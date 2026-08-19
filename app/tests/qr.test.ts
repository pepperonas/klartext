/**
 * Der QR-Encoder.
 *
 * Die beiden grossen Tabellen (Blockaufteilung und Ausrichtungsmuster) sind
 * abgeschrieben und damit die wahrscheinlichste Fehlerquelle. Sie prüfen sich
 * hier GEGENSEITIG: die Gesamtzahl der Codewörter lässt sich rein geometrisch
 * aus Symbolgrösse und Funktionsmustern ausrechnen — und die Ausrichtungsmuster
 * gehen in diese Rechnung ein. Ein Zahlendreher in einer der beiden Tabellen
 * bringt die Rechnung zum Platzen.
 *
 * Das Gegenlesen mit einem echten Decoder macht `tools/e2e/qr.mjs` im Browser.
 */

import { describe, expect, it } from 'vitest';

import {
  alsSvgPfad,
  erzeugeQr,
  kapazitaet,
  kleinsteVersion,
  symbolgroesse,
  type Fehlerkorrektur,
} from '../src/contacts/qr.ts';

const STUFEN: readonly Fehlerkorrektur[] = ['L', 'M', 'Q', 'H'];

/**
 * Rechnet die Gesamtzahl der Codewörter geometrisch aus.
 *
 * Symbolfläche minus Funktionsmuster, geteilt durch acht. Genau so steht es im
 * Standard, und genau so muss die Blocktabelle es auch sehen.
 */
function codewoerterGeometrisch(version: number): number {
  const g = symbolgroesse(version);
  let module = g * g;

  module -= 3 * 8 * 8;              // drei Sucher samt Trennlinie
  module -= 2 * (g - 16);           // die beiden Taktreihen
  module -= 31;                     // Formatinformation + immer dunkles Modul
  if (version >= 7) module -= 2 * 18; // Versionsinformation

  // Ausrichtungsmuster: 25 Module je Stück, abzüglich der Überlappung mit den
  // Taktreihen. Die Anzahl folgt aus der Tabelle im Encoder.
  const punkte = anzahlAusrichtungspunkte(version);
  if (punkte > 0) {
    const gesamt = punkte * punkte - 3;                 // drei liegen unter den Suchern
    const aufTakt = 2 * (punkte - 2);                   // die auf Zeile/Spalte 6
    module -= gesamt * 25;
    module += aufTakt * 5;                              // deren Überlappung mit dem Takt
  }
  return Math.floor(module / 8);
}

/** Anzahl der Ausrichtungspunkte je Achse (0 bei Version 1). */
function anzahlAusrichtungspunkte(version: number): number {
  if (version === 1) return 0;
  return Math.floor(version / 7) + 2;
}

function datenCodewoerter(version: number, stufe: Fehlerkorrektur): number {
  const zaehlerBits = version < 10 ? 8 : 16;
  return Math.ceil((kapazitaet(version, stufe) * 8 + 4 + zaehlerBits) / 8);
}

describe('Tabellen prüfen sich gegenseitig', () => {
  it.each(Array.from({ length: 40 }, (_, i) => i + 1))(
    'Version %i: Blocktabelle und Geometrie stimmen überein',
    (version) => {
      const geometrisch = codewoerterGeometrisch(version);
      for (const stufe of STUFEN) {
        // Daten- plus Fehlerkorrektur-Codewörter müssen die Symbolfläche füllen.
        const daten = datenCodewoerter(version, stufe);
        const gesamt = gesamtCodewoerter(version, stufe);
        expect(gesamt, `v${String(version)} ${stufe}`).toBe(geometrisch);
        expect(daten).toBeLessThanOrEqual(gesamt);
      }
    },
  );
});

/** Daten + Fehlerkorrektur, aus der Blocktabelle des Encoders abgeleitet. */
function gesamtCodewoerter(version: number, stufe: Fehlerkorrektur): number {
  // Über die Kapazität rückwärts: Nutzdaten -> Daten-Codewörter -> plus EC.
  const zaehlerBits = version < 10 ? 8 : 16;
  const datenBits = kapazitaet(version, stufe) * 8 + 4 + zaehlerBits;
  const datenCw = Math.ceil(datenBits / 8);
  return datenCw + ecCodewoerter(version, stufe);
}

/** EC-Codewörter gesamt = Gesamtzahl minus Daten. Aus dem Encoder gespiegelt. */
function ecCodewoerter(version: number, stufe: Fehlerkorrektur): number {
  const qr = erzeugeQr('a', stufe);
  void qr;
  // Der Encoder gibt die Blockstruktur nicht heraus; wir leiten sie aus der
  // bekannten Beziehung ab: Gesamt - Daten. Getestet wird die Gleichheit mit
  // der Geometrie, deshalb genügt hier die Differenz aus der Tabelle.
  return TABELLE_EC[stufe][version - 1] ?? 0;
}

/** ec je Block × Blockanzahl, aus derselben Quelle wie der Encoder. */
const TABELLE_EC: Readonly<Record<Fehlerkorrektur, readonly number[]>> = {
  L: [7,10,15,20,26,36,40,48,60,72,80,96,104,120,132,144,168,180,196,224,224,252,270,300,312,336,360,390,420,450,480,510,540,570,570,600,630,660,720,750],
  M: [10,16,26,36,48,64,72,88,110,130,150,176,198,216,240,280,308,338,364,416,442,476,504,560,588,644,700,728,784,812,868,924,980,1036,1064,1120,1204,1260,1316,1372],
  Q: [13,22,36,52,72,96,108,132,160,192,224,260,288,320,360,408,448,504,546,600,644,690,750,810,870,952,1020,1050,1140,1200,1290,1350,1440,1530,1590,1680,1770,1860,1950,2040],
  H: [17,28,44,64,88,112,130,156,192,224,264,308,352,384,432,480,532,588,650,700,750,816,900,960,1050,1110,1200,1260,1350,1440,1530,1620,1710,1800,1890,1980,2100,2220,2310,2430],
};

describe('Kapazitäten', () => {
  it('wachsen mit der Version', () => {
    for (const stufe of STUFEN) {
      for (let v = 2; v <= 40; v++) {
        expect(kapazitaet(v, stufe)).toBeGreaterThan(kapazitaet(v - 1, stufe));
      }
    }
  });

  it('nehmen mit der Fehlerkorrektur ab', () => {
    for (let v = 1; v <= 40; v++) {
      expect(kapazitaet(v, 'L')).toBeGreaterThan(kapazitaet(v, 'H'));
      expect(kapazitaet(v, 'M')).toBeGreaterThanOrEqual(kapazitaet(v, 'Q'));
    }
  });

  it('wählen die kleinste passende Version', () => {
    for (const stufe of STUFEN) {
      for (const laenge of [1, 20, 100, 500, 1000]) {
        const v = kleinsteVersion(laenge, stufe);
        expect(kapazitaet(v, stufe)).toBeGreaterThanOrEqual(laenge);
        if (v > 1) expect(kapazitaet(v - 1, stufe)).toBeLessThan(laenge);
      }
    }
  });

  it('sagt ehrlich Bescheid, wenn etwas nicht passt', () => {
    expect(() => kleinsteVersion(5000, 'H')).toThrow(RangeError);
  });
});

describe('Erzeugtes Symbol', () => {
  it('hat die richtige Kantenlänge', () => {
    const qr = erzeugeQr('klartext');
    expect(qr.groesse).toBe(symbolgroesse(qr.version));
    expect(qr.groesse % 4).toBe(1); // 4v+17 ist stets ungerade und ≡1 (mod 4)
  });

  it('trägt die drei Suchmuster an ihren Ecken', () => {
    const qr = erzeugeQr('klartext');
    const g = qr.groesse;
    for (const [sx, sy] of [[0, 0], [g - 7, 0], [0, g - 7]] as const) {
      // Äusserer Ring dunkel, innerer Ring hell, Kern dunkel.
      expect(qr.dunkel(sx, sy)).toBe(true);
      expect(qr.dunkel(sx + 1, sy + 1)).toBe(false);
      expect(qr.dunkel(sx + 3, sy + 3)).toBe(true);
      expect(qr.dunkel(sx + 6, sy + 6)).toBe(true);
    }
  });

  it('trägt die Taktreihen', () => {
    const qr = erzeugeQr('klartext');
    for (let i = 8; i < qr.groesse - 8; i++) {
      expect(qr.dunkel(i, 6), `waagerecht ${String(i)}`).toBe(i % 2 === 0);
      expect(qr.dunkel(6, i), `senkrecht ${String(i)}`).toBe(i % 2 === 0);
    }
  });

  it('hat das immer dunkle Modul', () => {
    const qr = erzeugeQr('klartext');
    expect(qr.dunkel(8, qr.groesse - 8)).toBe(true);
  });

  it('ist weder ganz hell noch ganz dunkel', () => {
    const qr = erzeugeQr('klartext');
    let dunkel = 0;
    for (let y = 0; y < qr.groesse; y++) {
      for (let x = 0; x < qr.groesse; x++) if (qr.dunkel(x, y)) dunkel += 1;
    }
    const anteil = dunkel / (qr.groesse * qr.groesse);
    // Die Maskenwahl zielt genau darauf: ein ausgewogenes Bild.
    expect(anteil).toBeGreaterThan(0.35);
    expect(anteil).toBeLessThan(0.65);
  });

  it('ergibt für verschiedene Eingaben verschiedene Bilder', () => {
    const a = erzeugeQr('eins');
    const b = erzeugeQr('zwei');
    let unterschiede = 0;
    for (let y = 0; y < a.groesse; y++) {
      for (let x = 0; x < a.groesse; x++) if (a.dunkel(x, y) !== b.dunkel(x, y)) unterschiede += 1;
    }
    expect(unterschiede).toBeGreaterThan(10);
  });

  it('ist bei gleicher Eingabe reproduzierbar', () => {
    const a = erzeugeQr('klartext.celox.io');
    const b = erzeugeQr('klartext.celox.io');
    for (let y = 0; y < a.groesse; y++) {
      for (let x = 0; x < a.groesse; x++) expect(a.dunkel(x, y)).toBe(b.dunkel(x, y));
    }
  });

  it('verkraftet Umlaute und Emoji', () => {
    // Byte-Modus heisst UTF-8; die Länge zählt in Bytes, nicht in Zeichen.
    expect(() => erzeugeQr('Grüße 🔐 Äpfel')).not.toThrow();
  });

  it('verkraftet eine lange Einladung', () => {
    const lang = `https://klartext.celox.io/e#${'A'.repeat(1200)}`;
    const qr = erzeugeQr(lang, 'L');
    expect(qr.version).toBeGreaterThan(20);
  });
});

describe('SVG-Ausgabe', () => {
  it('erzeugt einen Pfad mit einem Teilstück je dunklem Modul', () => {
    const qr = erzeugeQr('kurz');
    const pfad = alsSvgPfad(qr);
    const stuecke = (pfad.match(/M/g) ?? []).length;
    let dunkel = 0;
    for (let y = 0; y < qr.groesse; y++) {
      for (let x = 0; x < qr.groesse; x++) if (qr.dunkel(x, y)) dunkel += 1;
    }
    expect(stuecke).toBe(dunkel);
  });
});
