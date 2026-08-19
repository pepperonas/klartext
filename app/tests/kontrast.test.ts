/**
 * Rechnet die Kontraste beider Themen nach.
 *
 * ⚠️ Zwei Paare sind beim ersten Lighthouse-Lauf durchgefallen — geschaetzt
 *    hatte ich sie fuer ausreichend gehalten. Deshalb steht das hier als Test
 *    und nicht als guter Vorsatz.
 */

import { describe, expect, it } from 'vitest';

import { FARBEN_DUNKEL, FARBEN_HELL } from '../src/design/tokens.ts';

function leuchtdichte(hex: string): number {
  const kanal = (i: number): number => {
    const roh = parseInt(hex.slice(i, i + 2), 16) / 255;
    return roh <= 0.04045 ? roh / 12.92 : Math.pow((roh + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * kanal(1) + 0.7152 * kanal(3) + 0.0722 * kanal(5);
}

export function kontrast(vorne: string, hinten: string): number {
  const a = leuchtdichte(vorne);
  const b = leuchtdichte(hinten);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const THEMEN = [
  ['dunkel', FARBEN_DUNKEL],
  ['hell', FARBEN_HELL],
] as const;

describe.each(THEMEN)('Thema %s', (_name, f) => {
  const gruende = [f.bg, f['bg-erhaben'], f.flaeche, f['flaeche-hoch']];

  it('Fliesstext erreicht 4,5:1 auf jedem Untergrund', () => {
    for (const grund of gruende) {
      expect(kontrast(f.text, grund)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gedaempfter Text erreicht 4,5:1', () => {
    for (const grund of gruende) {
      expect(kontrast(f['text-leise'], grund)).toBeGreaterThanOrEqual(4.5);
      expect(kontrast(f['text-still'], grund)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('Grenzen von Bedienelementen erreichen 3:1 (WCAG 1.4.11)', () => {
    // Die Umrandung eines Eingabefelds IST das Bedienelement. Eine Kontur, die
    // man nicht sieht, ist kein Feld — sondern eine Flaeche, die man nicht findet.
    for (const grund of gruende) {
      expect(kontrast(f['kontur-stark'], grund)).toBeGreaterThanOrEqual(3);
    }
  });

  it('Akzentflaechen tragen lesbaren Text', () => {
    expect(kontrast(f['auf-akzent'], f.akzent)).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(f['auf-gefahr'], f.gefahr)).toBeGreaterThanOrEqual(4.5);
  });

  it('Meldungsfarben sind auf ihrem Untergrund lesbar', () => {
    expect(kontrast(f.gefahr, f.bg)).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(f.warnung, f.bg)).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(f.gut, f.bg)).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(f.akzent, f.bg)).toBeGreaterThanOrEqual(4.5);
  });
});
