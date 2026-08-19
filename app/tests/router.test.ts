/**
 * Wegfindung — der Teil, der ohne Browser prüfbar ist.
 *
 * ⚠️ In der Adresse darf nie ein Geheimnis stehen: der Verlauf überlebt die
 *    Sitzung, wird synchronisiert und taucht in Vorschlagslisten auf.
 */

import { describe, expect, it } from 'vitest';

import { START, alsPfad, ausPfad } from '../src/ui/router.ts';

describe('Pfade', () => {
  it.each([
    [{ ziel: 'schluessel' } as const, '/'],
    [{ ziel: 'info' } as const, '/info'],
    [{ ziel: 'neu', schritt: 1 } as const, '/neu/1'],
    [{ ziel: 'neu', schritt: 6 } as const, '/neu/6'],
    [{ ziel: 'export', kurz: 'ABCD1234ABCD1234' } as const, '/export/ABCD1234ABCD1234'],
  ])('%o wird zu %s und zurück', (weg, pfad) => {
    expect(alsPfad(weg)).toBe(pfad);
    expect(ausPfad(pfad)).toEqual(weg);
  });

  it('führt unbekannte Pfade auf die Übersicht', () => {
    for (const murks of ['/gibtsnicht', '', '///', '/export']) {
      expect(ausPfad(murks)).toEqual(START);
    }
  });

  it('führt /neu ohne Schrittnummer auf den ersten Schritt', () => {
    // Kein Fehlerfall: wer die Adresse von Hand kürzt, meint den Anfang.
    // Ein Export OHNE Kennung ist dagegen sinnlos und landet auf der Übersicht.
    expect(ausPfad('/neu/')).toEqual({ ziel: 'neu', schritt: 1 });
    expect(ausPfad('/neu')).toEqual({ ziel: 'neu', schritt: 1 });
    expect(ausPfad('/export')).toEqual(START);
  });

  it('nimmt keine unsinnigen Schrittnummern an', () => {
    expect(ausPfad('/neu/0')).toEqual({ ziel: 'neu', schritt: 1 });
    expect(ausPfad('/neu/-3')).toEqual({ ziel: 'neu', schritt: 1 });
    expect(ausPfad('/neu/abc')).toEqual({ ziel: 'neu', schritt: 1 });
  });

  it('trägt niemals ein Geheimnis in der Adresse', () => {
    // Nur der abgekürzte Fingerprint — der ist öffentlich.
    const pfade = [
      alsPfad({ ziel: 'schluessel' }),
      alsPfad({ ziel: 'info' }),
      alsPfad({ ziel: 'neu', schritt: 4 }),
      alsPfad({ ziel: 'export', kurz: 'ABCD1234ABCD1234' }),
    ];
    for (const pfad of pfade) {
      expect(pfad).toMatch(/^\/[A-Za-z0-9/]*$/);
      expect(pfad).not.toMatch(/pass|phrase|pw|key|secret|geheim/i);
    }
  });
});
