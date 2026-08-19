/**
 * Die Baukennung.
 *
 * Sie kommt aus dem Dokument, und das Dokument kommt vom Server — also wird sie
 * behandelt wie jede fremde Eingabe: geprüfte Form oder gar nichts.
 *
 * Die Suite läuft in Node. Wie überall in diesem Repo steht hier eine
 * handgeschriebene Attrappe statt jsdom — die Abhängigkeitsliste ist Teil des
 * Versprechens, auch bei Entwicklungswerkzeug.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { buildKennung, kurzform } from '../src/build-kennung.ts';

const ECHTES_DOKUMENT = (globalThis as { document?: unknown }).document;

function setzeMeta(inhalt: string | null): void {
  const treffer =
    inhalt === null ? null : { getAttribute: (n: string) => (n === 'content' ? inhalt : null) };
  (globalThis as { document?: unknown }).document = {
    querySelector: (wahl: string) => {
      // Die Attrappe soll nicht wohlwollend sein: nur die EINE Auswahl
      // beantworten, damit ein vertippter Selektor im Quelltext auffällt.
      expect(wahl).toBe('meta[name="klartext-build"]');
      return treffer;
    },
  };
}

const ECHT = 'sha256-G+Z89aOUHtI6KFysU7ZZMay0RV9GTGDSAYeb0oiksKk=';

afterEach(() => {
  if (ECHTES_DOKUMENT === undefined) delete (globalThis as { document?: unknown }).document;
  else (globalThis as { document?: unknown }).document = ECHTES_DOKUMENT;
});

describe('buildKennung', () => {

  it('liest die Kennung aus dem Markup', () => {
    setzeMeta(ECHT);
    expect(buildKennung()).toBe(ECHT);
  });

  it('liefert null, wenn kein Bau vorliegt (Entwicklungsserver)', () => {
    setzeMeta(null);
    expect(buildKennung()).toBeNull();
  });

  it.each([
    ['leer', ''],
    ['nur Leerzeichen', '   '],
    ['ohne Präfix', 'G+Z89aOUHtI6KFysU7ZZMay0RV9GTGDSAYeb0oiksKk='],
    ['falsches Verfahren', 'md5-G+Z89aOUHtI6KFysU7ZZMay0RV9GTGDSAYeb0oiksKk='],
    ['zu kurz', 'sha256-G+Z89aOU='],
    ['Markup eingeschmuggelt', 'sha256-<img src=x onerror=alert(1)>'],
    ['Zeilenumbruch', 'sha256-G+Z89aOUHtI6KFysU7ZZMay0RV9GTGDSAYeb0oiksKk=\nböse'],
  ])('weist %s ab, statt es anzuzeigen', (_name, wert) => {
    setzeMeta(wert);
    expect(buildKennung()).toBeNull();
  });

  it('nimmt umschliessende Leerzeichen hin', () => {
    setzeMeta(`  ${ECHT}  `);
    expect(buildKennung()).toBe(ECHT);
  });
});

describe('kurzform', () => {
  it('lässt genug Stellen zum Vergleichen mit blossem Auge', () => {
    // 12 base64-Zeichen sind 72 Bit. Wer zwei davon nebeneinanderlegt, sieht
    // einen Unterschied — und niemand vergleicht 44 Zeichen von Hand.
    expect(kurzform(ECHT)).toBe('G+Z89aOUHtI6');
    expect(kurzform(ECHT)).toHaveLength(12);
  });

  it('trägt das Verfahren nicht mit, das steht daneben', () => {
    expect(kurzform(ECHT)).not.toContain('sha256');
  });

  it('zwei verschiedene Bauten sehen verschieden aus', () => {
    const anders = 'sha256-ZZZ89aOUHtI6KFysU7ZZMay0RV9GTGDSAYeb0oiksKk=';
    expect(kurzform(anders)).not.toBe(kurzform(ECHT));
  });
});
