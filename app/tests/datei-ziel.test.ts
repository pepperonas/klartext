/**
 * Der Weg auf die Platte.
 *
 * Der Gegenstand dieser Tests ist weniger das Schreiben als das VERHALTEN IM
 * FEHLERFALL: eine fertig entschlüsselte Datei darf nie daran verlorengehen,
 * dass der gewählte Ort nicht mehr beschreibbar ist oder der Browser die
 * Schnittstelle gar nicht kennt. Jeder Zweig muss im Rückfall enden.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GROSS_AB_BYTES,
  frageZiel,
  kannAufPlatteSchreiben,
  legeAb,
  schreibe,
} from '../src/ui/datei-ziel.ts';

type Welt = { showSaveFilePicker?: unknown };
const ECHT = (globalThis as Welt).showSaveFilePicker;

afterEach(() => {
  if (ECHT === undefined) delete (globalThis as Welt).showSaveFilePicker;
  else (globalThis as Welt).showSaveFilePicker = ECHT;
  vi.restoreAllMocks();
});

function setzeAuswahl(f: unknown): void {
  (globalThis as Welt).showSaveFilePicker = f;
}

describe('Verfügbarkeit', () => {
  it('erkennt die Schnittstelle', () => {
    setzeAuswahl(() => Promise.resolve({}));
    expect(kannAufPlatteSchreiben()).toBe(true);
  });

  it('kommt ohne sie aus', () => {
    delete (globalThis as Welt).showSaveFilePicker;
    expect(kannAufPlatteSchreiben()).toBe(false);
  });

  it('lässt sich nicht von einem gleichnamigen Nicht-Funktionswert täuschen', () => {
    setzeAuswahl('ja bitte');
    expect(kannAufPlatteSchreiben()).toBe(false);
  });
});

describe('frageZiel', () => {
  it('reicht den Vorschlagsnamen durch', async () => {
    const spion = vi.fn(() => Promise.resolve({ createWritable: () => Promise.resolve({}) }));
    setzeAuswahl(spion);
    await frageZiel('urlaub.zip.gpg');
    expect(spion).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'urlaub.zip.gpg' }),
    );
  });

  it('gibt null zurück, wenn abgebrochen wird', async () => {
    setzeAuswahl(() => Promise.reject(new DOMException('abgebrochen', 'AbortError')));
    expect(await frageZiel('x.gpg')).toBeNull();
  });

  it('gibt null zurück, wenn die Nutzergeste verfallen ist', async () => {
    // ⚠️ Das ist der Fall, für den der ganze Aufbau existiert: showSaveFilePicker
    //    verlangt eine frische Geste. Fragte man erst NACH dem Verschlüsseln,
    //    käme genau hier ein SecurityError — und zwar zuverlässig bei den
    //    grossen Dateien, um die es geht. Auffangen statt platzen.
    setzeAuswahl(() => Promise.reject(new DOMException('gesture', 'SecurityError')));
    expect(await frageZiel('x.gpg')).toBeNull();
  });

  it('gibt null zurück, wenn es die Schnittstelle nicht gibt', async () => {
    delete (globalThis as Welt).showSaveFilePicker;
    expect(await frageZiel('x.gpg')).toBeNull();
  });
});

describe('schreibe', () => {
  const daten = new Uint8Array([1, 2, 3, 4]);

  it('schreibt und schliesst — in dieser Reihenfolge', async () => {
    const ablauf: string[] = [];
    const ziel = {
      createWritable: () => {
        ablauf.push('öffnen');
        return Promise.resolve({
          write: (d: BufferSource) => { ablauf.push(`schreiben:${String((d as Uint8Array).length)}`); return Promise.resolve(); },
          close: () => { ablauf.push('schliessen'); return Promise.resolve(); },
        });
      },
    };
    expect(await schreibe(ziel, daten)).toBe(true);
    // ⚠️ Ohne close() bleibt die Datei leer oder halb geschrieben — der Strom
    //    schreibt erst beim Schliessen durch.
    expect(ablauf).toEqual(['öffnen', 'schreiben:4', 'schliessen']);
  });

  it('meldet false, wenn der Ort nicht mehr beschreibbar ist', async () => {
    const ziel = { createWritable: () => Promise.reject(new Error('weg')) };
    expect(await schreibe(ziel, daten)).toBe(false);
  });

  it('meldet false, wenn das Schliessen scheitert (Platte voll)', async () => {
    // Der häufigste echte Fehlschlag, und der heimtückischste: write() geht
    // durch, erst close() stellt fest, dass nichts mehr passt.
    const ziel = {
      createWritable: () => Promise.resolve({
        write: () => Promise.resolve(),
        close: () => Promise.reject(new DOMException('voll', 'QuotaExceededError')),
      }),
    };
    expect(await schreibe(ziel, daten)).toBe(false);
  });

  it('wirft unter keinen Umständen', async () => {
    const kaputt = { createWritable: () => { throw new Error('synchron'); } };
    await expect(schreibe(kaputt, daten)).resolves.toBe(false);
  });
});

describe('Schwelle', () => {
  it('greift erst bei Dateien, bei denen die zweite Kopie wehtut', () => {
    // Unter der Schwelle ist der Blob-Weg unbedenklich und braucht keinen
    // zusätzlichen Dialog — ein Speichern-unter für 20 kB wäre Schikane.
    expect(GROSS_AB_BYTES).toBeGreaterThanOrEqual(16 * 1024 * 1024);
    expect(GROSS_AB_BYTES).toBeLessThanOrEqual(256 * 1024 * 1024);
  });
});

describe('legeAb — der Rückfall', () => {
  const daten = new Uint8Array([9, 9, 9]);
  const gutesZiel = () => ({
    createWritable: () => Promise.resolve({
      write: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
  });

  it('schreibt auf die Platte, wenn ein Ziel bereitsteht', async () => {
    const rueckfall = vi.fn();
    const wohin = await legeAb(gutesZiel(), daten, rueckfall);
    expect(rueckfall).not.toHaveBeenCalled();
    expect(wohin).toContain('Platte');
  });

  it('nimmt den Blob-Weg, wenn kein Ziel gewählt wurde', async () => {
    const rueckfall = vi.fn();
    expect(await legeAb(null, daten, rueckfall)).toBe('');
    expect(rueckfall).toHaveBeenCalledOnce();
  });

  it('nimmt den Blob-Weg, wenn das Schreiben SCHEITERT', async () => {
    // ⚠️ Der eigentliche Punkt. Ein Textvergleich im Quelltext hat diesen
    //    Zweig NICHT abgesichert: nach der Mutation stand der Rückfall immer
    //    noch daneben, nur unerreichbar — der Test blieb grün. Deshalb hier
    //    als Verhalten geprüft.
    const rueckfall = vi.fn();
    const kaputt = { createWritable: () => Promise.reject(new Error('Platte voll')) };
    expect(await legeAb(kaputt, daten, rueckfall)).toBe('');
    expect(rueckfall).toHaveBeenCalledOnce();
  });

  it('meldet nichts von der Platte, wenn nichts auf der Platte landete', async () => {
    // Sonst stünde „auf die Platte geschrieben" über einem Blob-Download.
    const kaputt = { createWritable: () => Promise.reject(new Error('weg')) };
    expect(await legeAb(kaputt, daten, () => {})).not.toContain('Platte');
  });
});
