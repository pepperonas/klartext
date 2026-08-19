/**
 * Der Vorschlagsgenerator.
 *
 * Der Kern ist der Gleichverteilungs-Beweis: statt eine Stichprobe zu ziehen
 * und zu hoffen, werden ALLE 65536 möglichen Zwei-Byte-Werte durchgerechnet.
 * Jeder Index muss exakt gleich oft herauskommen. Ein Test, der nur „sieht
 * zufällig aus" prüft, würde die Verzerrung durch `% 7776` nicht bemerken —
 * sie beträgt bei den ersten 3328 Wörtern nur 12,5 % Mehrhäufigkeit.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  BITS_PRO_WORT,
  LISTENGROESSE,
  PASSWORT_ALPHABET,
  WOERTER,
  ausWuerfeln,
  einordnung,
  indexZuWuerfel,
  ziehePassphrase,
  ziehePasswort,
  zieheIndex,
  wuerfelZuIndex,
  type Zufallsquelle,
} from '../src/passphrase/generator.ts';

/** Zufallsquelle, die eine vorgegebene Byte-Folge ausgibt. */
function feste(bytes: readonly number[]): Zufallsquelle {
  let i = 0;
  return (anzahl) => {
    const raus = new Uint8Array(anzahl);
    for (let k = 0; k < anzahl; k++) {
      const b = bytes[i % bytes.length];
      raus[k] = b ?? 0;
      i += 1;
    }
    return raus;
  };
}

describe('Wortliste', () => {
  it('hat exakt 7776 Einträge — sonst stimmt die Würfel-Zuordnung nicht', () => {
    expect(WOERTER).toHaveLength(LISTENGROESSE);
    expect(LISTENGROESSE).toBe(6 ** 5);
  });

  it('trägt die erwartete Prüfsumme', () => {
    // Wer Wörter austauscht, muss diese Summe bewusst mitändern. Eine
    // stillschweigend manipulierte Liste wäre ein Angriff auf jede damit
    // erzeugte Passphrase.
    const roh = readFileSync(new URL('../src/passphrase/de-7776-v1.txt', import.meta.url));
    expect(createHash('sha256').update(roh).digest('hex')).toBe(
      '440fa02c65591328d6351435d3824c27b483a049f4eca0b13456d8c5090442e7',
    );
  });

  it('kommt ohne Umlaute und ß aus — auf jeder Tastatur tippbar', () => {
    const auffaellig = WOERTER.filter((w) => /[^a-z]/.test(w));
    expect(auffaellig).toEqual([]);
  });

  it('enthält keine Dubletten', () => {
    expect(new Set(WOERTER).size).toBe(LISTENGROESSE);
  });

  it('liefert 12,925 Bit je Wort', () => {
    expect(BITS_PRO_WORT).toBeCloseTo(12.925, 3);
  });
});

describe('Würfel-Zuordnung', () => {
  it.each([
    [0, '11111', 'aalen'],
    [6, '11121', 'abbekommen'],
    [3888, '41111', 'kaufanreiz'],
    [7775, '66666', 'zypressen'],
  ])('Index %i entspricht %s = %s', (index, wuerfel, wort) => {
    expect(indexZuWuerfel(index)).toBe(wuerfel);
    expect(wuerfelZuIndex(wuerfel)).toBe(index);
    expect(WOERTER[index]).toBe(wort);
  });

  it('ist über die gesamte Liste umkehrbar', () => {
    for (let i = 0; i < LISTENGROESSE; i++) {
      expect(wuerfelZuIndex(indexZuWuerfel(i))).toBe(i);
    }
  });

  it('weist ungültige Würfelfolgen zurück', () => {
    for (const murks of ['1111', '111116', '11170', 'abcde', '', '11101']) {
      expect(() => wuerfelZuIndex(murks)).toThrow(RangeError);
    }
  });
});

describe('Gleichverteilung', () => {
  it('jeder der 7776 Indizes kommt bei allen 65536 Eingaben exakt gleich oft heraus', () => {
    // ⚠️ Erster Anlauf dieses Tests war WERTLOS: er sortierte die zu
    //    verwerfenden Werte selbst vorher aus und mass damit die eigene
    //    Annahme statt die Funktion. Unter der Mutation (`% 7776` ohne
    //    Rejection) blieb er gruen. Jetzt bekommt die Funktion JEDEN der
    //    65536 Werte und wir zaehlen an der Quelle mit, ob sie ihn genommen
    //    oder verworfen hat.
    const zaehler = new Uint32Array(LISTENGROESSE);
    let verworfen = 0;

    for (let roh = 0; roh < 0x10000; roh++) {
      let aufrufe = 0;
      const quelle: Zufallsquelle = () => {
        aufrufe += 1;
        // Erster Zug: der zu pruefende Wert. Danach ein garantiert gueltiger,
        // damit die Schleife der Funktion terminiert.
        const wert = aufrufe === 1 ? roh : 0;
        return new Uint8Array([wert >> 8, wert & 0xff]);
      };

      const index = zieheIndex(quelle);
      if (aufrufe === 1) {
        const alt = zaehler[index];
        if (alt === undefined) throw new Error('Index ausserhalb des Zählers');
        zaehler[index] = alt + 1;
      } else {
        verworfen += 1;
      }
    }

    // 65536 = 8 × 7776 + 3328
    expect(verworfen).toBe(3328);
    const abweichler = [...zaehler].map((n, i) => ({ i, n })).filter((e) => e.n !== 8);
    expect(abweichler).toEqual([]);
  });

  it('verwirft genau die Werte oberhalb des letzten vollen Vielfachen', () => {
    const GRENZE = 0x10000 - (0x10000 % LISTENGROESSE);
    expect(GRENZE).toBe(62208);
    expect(GRENZE % LISTENGROESSE).toBe(0);

    // Ein verworfener Wert gefolgt von einem gültigen: es muss der zweite zählen.
    const quelle = feste([0xff, 0xff, 0x00, 0x00]);
    expect(zieheIndex(quelle)).toBe(0);
  });

  it('gilt genauso für das Passwort-Alphabet', () => {
    const groesse = PASSWORT_ALPHABET.length;
    const zaehler = new Uint32Array(groesse);
    const GRENZE = 0x10000 - (0x10000 % groesse);
    for (let roh = 0; roh < GRENZE; roh++) {
      const index = zieheIndex(feste([roh >> 8, roh & 0xff]), groesse);
      const alt = zaehler[index];
      if (alt === undefined) throw new Error('Index ausserhalb des Zählers');
      zaehler[index] = alt + 1;
    }
    expect(new Set(zaehler).size).toBe(1);
  });
});

describe('Passphrase', () => {
  it('liefert die verlangte Wortzahl und die passende Bit-Zahl', () => {
    const p = ziehePassphrase(6);
    expect(p.woerter).toHaveLength(6);
    expect(p.bits).toBeCloseTo(77.5, 1);
    expect(p.herkunft).toBe('zufall');
  });

  it('verbindet mit Bindestrichen — die überleben Kopieren und Formularfelder', () => {
    const p = ziehePassphrase(5);
    expect(p.text).toBe(p.woerter.map((w) => w.wort).join('-'));
    expect(p.text).not.toContain(' ');
  });

  it('reicht die Würfelzahl zu jedem Wort mit, damit man sie nachschlagen kann', () => {
    for (const w of ziehePassphrase(6).woerter) {
      expect(w.wuerfel).toMatch(/^[1-6]{5}$/);
      expect(WOERTER[wuerfelZuIndex(w.wuerfel)]).toBe(w.wort);
    }
  });

  it('weist unsinnige Wortzahlen zurück', () => {
    for (const n of [0, 3, 11, 2.5, -1]) {
      expect(() => ziehePassphrase(n)).toThrow(RangeError);
    }
  });

  it('zieht bei jedem Aufruf etwas anderes', () => {
    const gesehen = new Set(Array.from({ length: 20 }, () => ziehePassphrase(6).text));
    expect(gesehen.size).toBe(20);
  });

  it('nimmt selbst gewürfelte Augen entgegen', () => {
    const p = ausWuerfeln(['11111', '66666', '41111', '11121', '12345', '54321']);
    expect(p.herkunft).toBe('wuerfel');
    expect(p.woerter.map((w) => w.wort).slice(0, 4)).toEqual([
      'aalen', 'zypressen', 'kaufanreiz', 'abbekommen',
    ]);
    expect(p.bits).toBeCloseTo(77.5, 1);
  });

  it('verlangt auch beim Würfeln genug Wörter', () => {
    expect(() => ausWuerfeln(['11111', '11112'])).toThrow(RangeError);
  });
});

describe('Export-Passwort', () => {
  it('hat die verlangte Länge und meldet seine Bits ehrlich', () => {
    const p = ziehePasswort(24);
    expect(p.text).toHaveLength(24);
    expect(p.bits).toBeCloseTo(24 * Math.log2(PASSWORT_ALPHABET.length), 5);
    expect(p.bits).toBeGreaterThan(140);
  });

  it('meidet Verwechslungspaare — l/I/1 und O/0', () => {
    // Ein Export-Passwort wird abgeschrieben. Ein verwechseltes Zeichen
    // bedeutet eine Datei, die niemand mehr aufbekommt.
    for (const zeichen of ['l', 'I', '1', 'O', '0']) {
      expect(PASSWORT_ALPHABET).not.toContain(zeichen);
    }
  });

  it('nutzt tatsächlich den ganzen Zeichensatz', () => {
    const gesehen = new Set(ziehePasswort(128).text + ziehePasswort(128).text + ziehePasswort(128).text);
    expect(gesehen.size).toBeGreaterThan(PASSWORT_ALPHABET.length * 0.8);
  });
});

describe('Einordnung', () => {
  it('nennt zu wenig Entropie beim Namen, statt sie zu beschönigen', () => {
    expect(einordnung(40)).toMatch(/zu wenig/);
    expect(einordnung(6 * BITS_PRO_WORT)).toMatch(/durchprobieren kann/);
  });

  it('kennt keine Marketing-Etiketten', () => {
    for (const bits of [30, 50, 70, 90, 150]) {
      expect(einordnung(bits)).not.toMatch(/sehr stark|exzellent|perfekt|unknackbar/i);
    }
  });
});
