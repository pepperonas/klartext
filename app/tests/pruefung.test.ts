/**
 * Der Nachweis, dass die Passphrase gesichert wurde.
 *
 * Ein Haken „Ich habe sie notiert" ist eine Selbstauskunft, die man in zwei
 * Sekunden setzt. Diese Abfrage nicht.
 */

import { describe, expect, it } from 'vitest';

import type { Zufallsquelle } from '../src/passphrase/generator.ts';
import { ABGEFRAGTE_WOERTER, pruefe, stimmt, waehlePositionen } from '../src/passphrase/pruefung.ts';

const WOERTER = ['aalen', 'zypressen', 'kaufanreiz', 'abbekommen', 'ammoniak', 'schob'];

function feste(bytes: readonly number[]): Zufallsquelle {
  let i = 0;
  return (anzahl) => {
    const raus = new Uint8Array(anzahl);
    for (let k = 0; k < anzahl; k++) { raus[k] = bytes[i % bytes.length] ?? 0; i += 1; }
    return raus;
  };
}

describe('Positionen', () => {
  it('wählt drei verschiedene und liefert sie aufsteigend', () => {
    for (let lauf = 0; lauf < 200; lauf++) {
      const p = waehlePositionen(6);
      expect(p).toHaveLength(ABGEFRAGTE_WOERTER);
      expect(new Set(p).size).toBe(ABGEFRAGTE_WOERTER);
      expect([...p].sort((a, b) => a - b)).toEqual(p);
      expect(Math.min(...p)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...p)).toBeLessThanOrEqual(6);
    }
  });

  it('verlangt genug Wörter', () => {
    expect(() => waehlePositionen(2)).toThrow(RangeError);
  });

  it('terminiert auch bei einer Quelle, die immer dasselbe liefert', () => {
    // ⚠️ Genau hier hing die Suite beim ersten Lauf: die naive Fassung zog so
    //    lange, bis genug VERSCHIEDENE Positionen beisammen waren — bei einer
    //    Quelle, die nur zwei Werte kennt, also nie. Das Mischverfahren braucht
    //    exakt `anzahl` Ziehungen und kann nicht hängen.
    const p = waehlePositionen(6, 3, feste([0x00, 0x00, 0x00, 0x01]));
    expect(p).toHaveLength(3);
    expect(new Set(p).size).toBe(3);
  });

  it('liefert bei anzahl === wortzahl alle Positionen', () => {
    expect(waehlePositionen(6, 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('Vergleich', () => {
  it('ist unempfindlich gegen Groß-/Kleinschreibung und Leerraum', () => {
    expect(stimmt('  Aalen ', 'aalen')).toBe(true);
    expect(stimmt('ZYPRESSEN', 'zypressen')).toBe(true);
  });

  it('lässt sich nicht durch Ähnlichkeit erweichen', () => {
    expect(stimmt('aale', 'aalen')).toBe(false);
    expect(stimmt('aalenn', 'aalen')).toBe(false);
    expect(stimmt('', 'aalen')).toBe(false);
  });
});

describe('Auswertung', () => {
  it('besteht nur bei allen richtigen Antworten', () => {
    const e = pruefe(WOERTER, [1, 3, 5], ['aalen', 'kaufanreiz', 'ammoniak']);
    expect(e.bestanden).toBe(true);
    expect(e.falsch).toEqual([]);
  });

  it('nennt die falschen Positionen', () => {
    const e = pruefe(WOERTER, [1, 3, 5], ['aalen', 'FALSCH', 'ammoniak']);
    expect(e.bestanden).toBe(false);
    expect(e.falsch).toEqual([3]);
  });

  it('wertet eine leere Antwort als falsch, nicht als fehlend', () => {
    const e = pruefe(WOERTER, [2, 4], ['', '']);
    expect(e.bestanden).toBe(false);
    expect(e.falsch).toEqual([2, 4]);
  });

  it('lässt sich nicht mit zu wenigen Antworten überlisten', () => {
    const e = pruefe(WOERTER, [1, 2, 3], ['aalen']);
    expect(e.bestanden).toBe(false);
    expect(e.falsch).toEqual([2, 3]);
  });
});
