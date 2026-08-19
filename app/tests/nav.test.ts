/**
 * Navigationsleiste und Sperr-Anzeige.
 *
 * Beide sind Orientierung, keine Zierde: die Leiste sagt, wo man ist und was
 * es überhaupt gibt; die Anzeige sagt, ob der Schlüssel gerade offen liegt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VaultStatus } from '../src/crypto/protocol.ts';

interface Stub {
  tagName: string;
  className: string;
  textContent: string;
  attribute: Record<string, string>;
  dataset: Record<string, string>;
  title: string;
  childNodes: Stub[];
  firstChild: Stub | null;
  classList: { toggle: (n: string, an: boolean) => void };
  appendChild: (k: Stub) => Stub;
  removeChild: (k: Stub) => Stub;
  addEventListener: (t: string, f: () => void) => void;
  setAttribute: (n: string, w: string) => void;
  removeAttribute: (n: string) => void;
  klicke: () => void;
}

function stub(tag: string, text = ''): Stub {
  let klick: (() => void) | null = null;
  const klassen = new Set<string>();
  const k: Stub = {
    tagName: tag.toUpperCase(),
    get className() { return [...klassen].join(' '); },
    set className(w: string) { klassen.clear(); for (const t of w.split(/\s+/).filter(Boolean)) klassen.add(t); },
    textContent: text,
    attribute: {},
    dataset: {},
    title: '',
    childNodes: [],
    firstChild: null,
    classList: { toggle: (n, an) => { if (an) klassen.add(n); else klassen.delete(n); } },
    appendChild(kind) { k.childNodes.push(kind); k.firstChild = k.childNodes[0] ?? null; return kind; },
    removeChild(kind) {
      k.childNodes = k.childNodes.filter((c) => c !== kind);
      k.firstChild = k.childNodes[0] ?? null; return kind;
    },
    addEventListener(t, f) { if (t === 'click') klick = f; },
    setAttribute(n, w) { k.attribute[n] = w; },
    removeAttribute(n) { k.attribute = Object.fromEntries(Object.entries(k.attribute).filter(([x]) => x !== n)); },
    klicke() { klick?.(); },
  };
  return k;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('document', {
    createElement: (t: string) => stub(t),
    createTextNode: (t: string) => stub('#text', t),
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function texte(k: Stub): string[] {
  if (k.childNodes.length === 0) return k.textContent.length > 0 ? [k.textContent] : [];
  return k.childNodes.flatMap(texte);
}

describe('Navigationsleiste', () => {
  it('führt alle vier Bereiche in fester Reihenfolge', async () => {
    const { Navigation } = await import('../src/ui/nav.ts');
    const nav = new Navigation(() => { /* egal */ });
    expect(texte(nav.wurzel as unknown as Stub)).toEqual(['Schlüssel', 'Werkzeug', 'Kontakte', 'Info']);
  });

  it('zeigt Kommendes als ausgegraut statt es zu verschweigen', async () => {
    // Ein leerer Bildschirm wirkt kaputt, ein ausgegrauter Eintrag unfertig.
    const { Navigation } = await import('../src/ui/nav.ts');
    const nav = new Navigation(() => { /* egal */ });
    const kinder = (nav.wurzel as unknown as Stub).childNodes;
    const kontakte = kinder.find((c) => c.textContent === 'Kontakte');
    expect(kontakte?.className).toContain('aus');
    expect(kontakte?.attribute['aria-disabled']).toBe('true');
    expect(kontakte?.attribute['title']).toMatch(/Phase 3/);
  });

  it('meldet den Wechsel mit dem richtigen Ziel', async () => {
    const { Navigation } = await import('../src/ui/nav.ts');
    const gewaehlt: string[] = [];
    const nav = new Navigation((w) => gewaehlt.push(w.ziel));
    const kinder = (nav.wurzel as unknown as Stub).childNodes;
    kinder.find((c) => c.textContent === 'Info')?.klicke();
    kinder.find((c) => c.textContent === 'Werkzeug')?.klicke();
    // Werkzeug ist inzwischen da, Kontakte noch nicht: ein ausgegrauter
    // Eintrag darf NICHTS auslösen.
    kinder.find((c) => c.textContent === 'Kontakte')?.klicke();
    expect(gewaehlt).toEqual(['info', 'werkzeug']);
  });

  it('markiert genau einen Eintrag', async () => {
    const { Navigation } = await import('../src/ui/nav.ts');
    const nav = new Navigation(() => { /* egal */ });
    nav.markiere({ ziel: 'info' });
    const kinder = (nav.wurzel as unknown as Stub).childNodes;
    const markiert = kinder.filter((c) => c.attribute['aria-current'] === 'page');
    expect(markiert).toHaveLength(1);
    expect(markiert[0]?.textContent).toBe('Info');
  });

  it('rechnet die Unterzustände dem richtigen Bereich zu', async () => {
    // Anlegen und Exportieren gehören zu „Schlüssel" — sonst wirkt die Leiste
    // beim Anlegen wie ein fremder Ort.
    const { Navigation } = await import('../src/ui/nav.ts');
    const nav = new Navigation(() => { /* egal */ });
    const kinder = (nav.wurzel as unknown as Stub).childNodes;
    for (const weg of [{ ziel: 'neu' as const, schritt: 3 }, { ziel: 'export' as const, kurz: 'AB' }]) {
      nav.markiere(weg);
      expect(kinder.find((c) => c.attribute['aria-current'] === 'page')?.textContent).toBe('Schlüssel');
    }
  });
});

describe('Sperr-Anzeige', () => {
  const offen = (rest: number): VaultStatus => ({
    state: 'unlocked', keyCount: 1, lockAt: Date.now() + rest, lastLockReason: null,
  });

  it('formatiert die Restzeit als Minuten und Sekunden', async () => {
    const { formatiereRestzeit } = await import('../src/ui/schlosskerbe.ts');
    expect(formatiereRestzeit(0)).toBe('0:00');
    expect(formatiereRestzeit(9_000)).toBe('0:09');
    expect(formatiereRestzeit(65_000)).toBe('1:05');
    expect(formatiereRestzeit(15 * 60_000)).toBe('15:00');
  });

  it('zeigt keine negative Zeit an', async () => {
    const { formatiereRestzeit } = await import('../src/ui/schlosskerbe.ts');
    expect(formatiereRestzeit(-5_000)).toBe('0:00');
  });

  it('nennt jeden Zustand beim Namen', async () => {
    const { Schlosskerbe } = await import('../src/ui/schlosskerbe.ts');
    const kerbe = new Schlosskerbe();
    const wurzel = kerbe.wurzel as unknown as Stub;
    for (const [zustand, wort] of [['empty', 'kein Schlüssel'], ['locked', 'gesperrt'], ['unlocked', 'offen']] as const) {
      kerbe.zeige({ state: zustand, keyCount: 1, lockAt: null, lastLockReason: null });
      expect(texte(wurzel).join(' ')).toContain(wort);
      expect(wurzel.dataset['zustand']).toBe(zustand);
    }
  });

  it('nennt die Restzeit nur, wenn es eine gibt', async () => {
    const { Schlosskerbe } = await import('../src/ui/schlosskerbe.ts');
    const kerbe = new Schlosskerbe();
    const wurzel = kerbe.wurzel as unknown as Stub;

    kerbe.zeige(offen(120_000));
    expect(texte(wurzel).join(' ')).toMatch(/sperrt in \d+:\d{2}/);

    kerbe.zeige({ state: 'locked', keyCount: 1, lockAt: null, lastLockReason: 'idle' });
    expect(texte(wurzel).join(' ')).not.toMatch(/sperrt in/);
  });

  it('zählt die Restzeit herunter', async () => {
    const { Schlosskerbe } = await import('../src/ui/schlosskerbe.ts');
    const kerbe = new Schlosskerbe();
    const wurzel = kerbe.wurzel as unknown as Stub;
    kerbe.zeige(offen(120_000));
    const vorher = texte(wurzel).join(' ');
    vi.advanceTimersByTime(5_000);
    expect(texte(wurzel).join(' ')).not.toBe(vorher);
  });

  it('hört auf zu zählen, sobald gesperrt ist', async () => {
    // Ein weiterlaufender Zeitgeber im gesperrten Zustand wäre ein Leck.
    const { Schlosskerbe } = await import('../src/ui/schlosskerbe.ts');
    const kerbe = new Schlosskerbe();
    kerbe.zeige(offen(120_000));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    kerbe.zeige({ state: 'locked', keyCount: 1, lockAt: null, lastLockReason: 'idle' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
