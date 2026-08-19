/**
 * Der Fingerprint-Abgleich.
 *
 * Er ist die einzige Verteidigung gegen einen untergeschobenen Schlüssel.
 * Entsprechend darf er nirgends nachgiebig sein.
 */

import { describe, expect, it } from 'vitest';

import { WOERTER } from '../src/passphrase/generator.ts';
import {
  WORTZAHL,
  alsWoerter,
  ausWoertern,
  gruppiert,
  kurzform,
  stimmenUeberein,
} from '../src/contacts/wortabgleich.ts';
import { meta } from './fixtures.ts';

const ECHT = meta.rsa.fingerprint;

function zufallsFingerprint(saat: number): string {
  // Deterministisch, damit ein Fehlschlag nachstellbar ist.
  let x = saat >>> 0;
  let hex = '';
  for (let i = 0; i < 40; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    hex += (x % 16).toString(16).toUpperCase();
  }
  return hex;
}

describe('Umrechnung', () => {
  it('ergibt genau dreizehn Wörter', () => {
    expect(alsWoerter(ECHT)).toHaveLength(WORTZAHL);
  });

  it('benutzt nur Wörter aus der Liste', () => {
    for (const wort of alsWoerter(ECHT)) expect(WOERTER).toContain(wort);
  });

  it('ist über tausend Fingerprints hin und zurück umkehrbar', () => {
    for (let i = 0; i < 1000; i++) {
      const fp = zufallsFingerprint(i);
      expect(ausWoertern(alsWoerter(fp)), `Saat ${String(i)}`).toBe(fp);
    }
  });

  it('trägt auch die Randfälle', () => {
    for (const fp of ['0'.repeat(40), 'F'.repeat(40), `${'0'.repeat(39)}1`]) {
      expect(ausWoertern(alsWoerter(fp))).toBe(fp);
    }
  });

  it('ist unempfindlich gegen Schreibweise und Leerraum', () => {
    const mitLeerzeichen = gruppiert(ECHT);
    expect(alsWoerter(mitLeerzeichen)).toEqual(alsWoerter(ECHT));
    expect(alsWoerter(ECHT.toLowerCase())).toEqual(alsWoerter(ECHT));
  });

  it('nimmt Wörter in beliebiger Schreibweise an', () => {
    const woerter = alsWoerter(ECHT);
    const gemischt = woerter.map((w, i) => (i % 2 === 0 ? w.toUpperCase() : ` ${w} `));
    expect(ausWoertern(gemischt)).toBe(ECHT);
  });

  it('weist alles zurück, was kein Fingerprint ist', () => {
    for (const murks of ['', 'kurz', `${ECHT}0`, ECHT.slice(0, 39), 'G'.repeat(40)]) {
      expect(() => alsWoerter(murks)).toThrow(RangeError);
    }
  });

  it('weist unbekannte Wörter zurück, statt still etwas anderes zu liefern', () => {
    const woerter = alsWoerter(ECHT);
    const verfaelscht = [...woerter];
    verfaelscht[3] = 'gibtesnicht';
    expect(() => ausWoertern(verfaelscht)).toThrow(/Unbekanntes Wort/);
  });

  it('weist eine falsche Wortzahl zurück', () => {
    const woerter = alsWoerter(ECHT);
    expect(() => ausWoertern(woerter.slice(0, 12))).toThrow(RangeError);
    expect(() => ausWoertern([...woerter, woerter[0] ?? ''])).toThrow(RangeError);
  });

  it('ein einziges verändertes Wort ergibt einen anderen Fingerprint', () => {
    // Der Kern des Ganzen: wer ein Wort überhört, bekommt nicht zufällig
    // denselben Schlüssel bestätigt.
    const woerter = alsWoerter(ECHT);
    for (let i = 0; i < WORTZAHL; i++) {
      const abgewandelt = [...woerter];
      abgewandelt[i] = WOERTER[(WOERTER.indexOf(woerter[i] ?? '') + 1) % WOERTER.length] ?? '';
      let anders: string;
      try { anders = ausWoertern(abgewandelt); } catch { continue; }
      expect(anders, `Stelle ${String(i)}`).not.toBe(ECHT);
    }
  });
});

describe('Vergleich', () => {
  it('erkennt Gleichheit trotz verschiedener Schreibweise', () => {
    expect(stimmenUeberein(ECHT, gruppiert(ECHT))).toBe(true);
    expect(stimmenUeberein(ECHT, ECHT.toLowerCase())).toBe(true);
  });

  it('ist bei einer einzigen abweichenden Stelle unerbittlich', () => {
    // ⚠️ Ein „stimmt ungefähr" gäbe es hier gratis — und wäre die Lücke, durch
    //    die ein untergeschobener Schlüssel spaziert.
    const fast = `${ECHT.slice(0, 39)}${ECHT.endsWith('E') ? 'F' : 'E'}`;
    expect(stimmenUeberein(ECHT, fast)).toBe(false);
  });

  it('lässt sich nicht mit Teilstücken überlisten', () => {
    expect(stimmenUeberein(ECHT.slice(0, 20), ECHT)).toBe(false);
    expect(stimmenUeberein('', '')).toBe(false);
    expect(stimmenUeberein(ECHT.slice(0, 16), ECHT.slice(0, 16))).toBe(false);
  });
});

describe('Darstellung', () => {
  it('gruppiert in Zehnergruppen zu je vier', () => {
    expect(gruppiert(ECHT).split(' ')).toHaveLength(10);
  });

  it('die Kurzform sind die letzten sechzehn Stellen', () => {
    expect(kurzform(ECHT)).toBe(ECHT.slice(-16));
    expect(kurzform(gruppiert(ECHT))).toBe(ECHT.slice(-16));
  });
});
