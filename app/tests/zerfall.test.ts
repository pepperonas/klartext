/**
 * Das Namensmotiv darf den Inhalt nie antasten.
 *
 * Die Bewegung ist Zierde; der Text ist die Sache. Deshalb wird hier geprüft,
 * dass er zu JEDEM Zeitpunkt vollständig im DOM steht — bei abgeschalteter
 * Bewegung sofort, sonst spätestens nach dem Beruhigen.
 *
 * Handgerollter DOM-Stub statt jsdom: das Repo soll dependency-frei bleiben,
 * und die Animation benutzt nur eine Handvoll DOM-Aufrufe.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface StubKnoten {
  nodeType: number;
  tagName: string;
  textContent: string;
  className: string;
  style: Record<string, string>;
  childNodes: StubKnoten[];
  firstChild: StubKnoten | null;
  appendChild: (k: StubKnoten) => StubKnoten;
  removeChild: (k: StubKnoten) => StubKnoten;
  setAttribute: (name: string, wert: string) => void;
}

function knoten(tagName: string, text = ''): StubKnoten {
  const k: StubKnoten = {
    nodeType: tagName === '#text' ? 3 : 1,
    tagName: tagName.toUpperCase(),
    textContent: text,
    className: '',
    style: {},
    childNodes: [],
    firstChild: null,
    appendChild(kind) {
      k.childNodes.push(kind);
      k.firstChild = k.childNodes[0] ?? null;
      return kind;
    },
    removeChild(kind) {
      k.childNodes = k.childNodes.filter((c) => c !== kind);
      k.firstChild = k.childNodes[0] ?? null;
      return kind;
    },
    setAttribute() { /* für den Test belanglos */ },
  };
  return k;
}

/** Der Text, wie ihn textContent liefern würde — <br> zählt als Zeilenumbruch. */
function gesamttext(k: StubKnoten): string {
  if (k.childNodes.length === 0) return k.tagName === 'BR' ? '\n' : k.textContent;
  return k.childNodes.map(gesamttext).join('');
}

/**
 * Der Stub bildet genau die Handvoll DOM-Aufrufe nach, die der Zerfall benutzt.
 * Ihn als HTMLElement auszugeben ist an dieser einen Stelle ehrlicher als 300
 * ungenutzte Eigenschaften zu erfinden.
 */
function alsElement(k: StubKnoten): HTMLElement {
  return k as unknown as HTMLElement;
}

function zaehleSpans(k: StubKnoten): number {
  return k.childNodes.filter((c) => c.tagName === 'SPAN' && c.className === 'zf').length;
}

let reduziert = false;

beforeEach(() => {
  reduziert = false;
  vi.stubGlobal('document', {
    createElement: (tag: string) => knoten(tag),
    createTextNode: (text: string) => knoten('#text', text),
  });
  vi.stubGlobal('matchMedia', (abfrage: string) => ({
    matches: reduziert && abfrage.includes('reduce'),
  }));
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('performance', { now: () => 0 });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function laden() {
  return await import('../src/ui/components/zerfall.ts');
}

describe('Zerfall', () => {
  it('zeigt den Text sofort vollständig — die Krypto wartet auf nichts', async () => {
    const { zeigeMitZerfall } = await laden();
    const behaelter = knoten('pre');
    const text = 'Kurzer Text mit Umlauten: Grüße, Äpfel.';
    zeigeMitZerfall(alsElement(behaelter), text, 'zerfall');
    expect(gesamttext(behaelter)).toBe(text);
  });

  it('behält Zeilenumbrüche', async () => {
    const { zeigeMitZerfall } = await laden();
    const behaelter = knoten('pre');
    const text = 'Zeile eins\nZeile zwei\n\nAbsatz';
    zeigeMitZerfall(alsElement(behaelter), text, 'aufbau');
    expect(gesamttext(behaelter)).toBe(text);
  });

  it('beruhigt sich zu schlichtem Text — sonst weicht das DOM vom Inhalt ab', async () => {
    const { MAX_DAUER_MS, zeigeMitZerfall } = await laden();
    const behaelter = knoten('pre');
    const text = 'Erste Zeile\nZweite Zeile';
    zeigeMitZerfall(alsElement(behaelter), text, 'zerfall');
    expect(zaehleSpans(behaelter)).toBeGreaterThan(0);

    vi.advanceTimersByTime(MAX_DAUER_MS + 10);
    expect(behaelter.childNodes).toHaveLength(1);
    expect(behaelter.childNodes[0]?.nodeType).toBe(3);
    expect(gesamttext(behaelter)).toBe(text);
  });

  it('baut auch bei sehr langem Text nicht zehntausende Knoten', async () => {
    const { MAX_ZEICHEN, zeigeMitZerfall } = await laden();
    const behaelter = knoten('pre');
    const text = 'x'.repeat(40_000);
    zeigeMitZerfall(alsElement(behaelter), text, 'zerfall');

    expect(zaehleSpans(behaelter)).toBeLessThanOrEqual(MAX_ZEICHEN);
    // Trotzdem ist der Text vollständig da.
    expect(gesamttext(behaelter)).toHaveLength(40_000);
  });

  it('bei reduzierter Bewegung gibt es gar keine Spans', async () => {
    reduziert = true;
    const { zeigeMitZerfall } = await laden();
    const behaelter = knoten('pre');
    zeigeMitZerfall(alsElement(behaelter), 'Ohne Bewegung.', 'zerfall');
    expect(zaehleSpans(behaelter)).toBe(0);
    expect(gesamttext(behaelter)).toBe('Ohne Bewegung.');
  });

  it('räumt vorherigen Inhalt ab', async () => {
    const { zeigeMitZerfall } = await laden();
    const behaelter = knoten('pre');
    zeigeMitZerfall(alsElement(behaelter), 'erster Inhalt', 'zerfall');
    zeigeMitZerfall(alsElement(behaelter), 'zweiter', 'aufbau');
    expect(gesamttext(behaelter)).toBe('zweiter');
  });

  it('bleibt unter der zugesagten Dauer', async () => {
    const { MAX_DAUER_MS } = await laden();
    expect(MAX_DAUER_MS).toBeLessThanOrEqual(400);
  });
});
