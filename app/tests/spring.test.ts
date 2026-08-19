/**
 * Der Feder-Integrator.
 *
 * Er treibt jede Bewegung der App. Zwei Eigenschaften sind hier
 * sicherheitsrelevant im weiteren Sinn: er muss bei `prefers-reduced-motion`
 * vollständig stillstehen, und er darf nach einem Tabwechsel nicht explodieren.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let jetzt = 0;
let rahmen: ((t: number) => void)[] = [];
let reduziert = false;

beforeEach(() => {
  jetzt = 0;
  rahmen = [];
  reduziert = false;
  vi.stubGlobal('performance', { now: () => jetzt });
  vi.stubGlobal('requestAnimationFrame', (fn: (t: number) => void) => { rahmen.push(fn); return rahmen.length; });
  vi.stubGlobal('matchMedia', (a: string) => ({ matches: reduziert && a.includes('reduce') }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

/** Lässt die Bewegung `schritte` Rahmen zu je `dt` Millisekunden laufen. */
function laufe(schritte: number, dt = 16): void {
  for (let i = 0; i < schritte; i++) {
    const naechste = rahmen.shift();
    if (naechste === undefined) return;
    jetzt += dt;
    naechste(jetzt);
  }
}

describe('Feder', () => {
  it('erreicht ihr Ziel', async () => {
    const { Feder } = await import('../src/motion/spring.ts');
    const werte: number[] = [];
    const f = new Feder((w) => werte.push(w), { start: 0 });
    f.ziel(1);
    laufe(400);
    expect(f.wert).toBe(1);
    expect(werte.at(-1)).toBe(1);
  });

  it('bewegt sich monoton auf das Ziel zu, ohne wilde Ausschläge', async () => {
    const { Feder } = await import('../src/motion/spring.ts');
    const werte: number[] = [];
    const f = new Feder((w) => werte.push(w), { start: 0 });
    f.ziel(1);
    laufe(400);
    // Eine gedämpfte Feder darf leicht überschwingen — aber nicht davonlaufen.
    expect(Math.max(...werte)).toBeLessThan(1.3);
    expect(Math.min(...werte)).toBeGreaterThanOrEqual(0);
  });

  it('hält bei reduzierter Bewegung sofort still', async () => {
    reduziert = true;
    const { Feder } = await import('../src/motion/spring.ts');
    const werte: number[] = [];
    const f = new Feder((w) => werte.push(w), { start: 0 });
    f.ziel(1);
    // Kein einziger Rahmen darf angefordert worden sein.
    expect(rahmen).toHaveLength(0);
    expect(f.wert).toBe(1);
    expect(werte).toEqual([1]);
  });

  it('überlebt einen Zeitsprung aus dem Hintergrund-Tab', async () => {
    // ⚠️ Ohne Deckelung von dt sprengt ein Sprung über Minuten die Integration:
    //    die Geschwindigkeit schießt ins Unendliche und der Wert wird NaN.
    const { Feder } = await import('../src/motion/spring.ts');
    const werte: number[] = [];
    const f = new Feder((w) => werte.push(w), { start: 0 });
    f.ziel(1);
    laufe(1, 600_000);
    laufe(400);
    expect(Number.isFinite(f.wert)).toBe(true);
    expect(werte.every((w) => Number.isFinite(w))).toBe(true);
    expect(f.wert).toBe(1);
  });

  it('nimmt unterwegs ein neues Ziel an, ohne neu zu starten', async () => {
    const { Feder } = await import('../src/motion/spring.ts');
    const f = new Feder(() => { /* egal */ }, { start: 0 });
    f.ziel(1);
    laufe(5);
    const zwischenstand = f.wert;
    expect(zwischenstand).toBeGreaterThan(0);
    expect(zwischenstand).toBeLessThan(1);
    f.ziel(0);
    laufe(400);
    expect(f.wert).toBe(0);
  });

  it('setze() springt ohne Bewegung', async () => {
    const { Feder } = await import('../src/motion/spring.ts');
    const werte: number[] = [];
    const f = new Feder((w) => werte.push(w), { start: 0 });
    f.setze(0.5);
    expect(f.wert).toBe(0.5);
    expect(werte).toEqual([0.5]);
    expect(rahmen).toHaveLength(0);
  });

  it('stoppe() beendet die Schleife', async () => {
    const { Feder } = await import('../src/motion/spring.ts');
    const f = new Feder(() => { /* egal */ }, { start: 0 });
    f.ziel(1);
    f.stoppe();
    laufe(50);
    expect(f.wert).toBeLessThan(1);
  });

  it.each(['weich', 'knapp', 'ruhig'] as const)('die Federart %s kommt zur Ruhe', async (art) => {
    const { Feder } = await import('../src/motion/spring.ts');
    const f = new Feder(() => { /* egal */ }, { start: 0, art });
    f.ziel(1);
    laufe(1000);
    expect(f.wert).toBe(1);
  });

  it('die knappe Feder ist schneller als die ruhige', async () => {
    const { Feder } = await import('../src/motion/spring.ts');
    const dauer = (art: 'knapp' | 'ruhig'): number => {
      jetzt = 0; rahmen = [];
      const f = new Feder(() => { /* egal */ }, { start: 0, art });
      f.ziel(1);
      let n = 0;
      while (rahmen.length > 0 && n < 2000) { laufe(1); n += 1; }
      return n;
    };
    expect(dauer('knapp')).toBeLessThan(dauer('ruhig'));
  });
});
