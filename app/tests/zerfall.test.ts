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

/** Was die bewegten Stücke zusammen ergeben — ohne die Zeilenumbrüche. */
function bewegterText(k: StubKnoten): string {
  return k.childNodes
    .filter((c) => c.tagName === 'SPAN' && c.className === 'zf')
    .map((c) => c.textContent)
    .join('');
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

  it('bleibt in einer Spanne, die man als Bewegung sieht und nicht als Warten', async () => {
    // ⚠️ Hier standen 400 ms. Bei einem PGP-Block über viele Zeilen war das zu
    //    kurz, um überhaupt als Bewegung wahrgenommen zu werden — gemeldet als
    //    „es wird nur der Anfang animiert". Die Zahl wurde nicht einfach
    //    hochgesetzt: die Untergrenze hält fest, dass die Bewegung sichtbar
    //    sein MUSS, die Obergrenze, dass sie nie zum Warten wird.
    const { MAX_DAUER_MS } = await laden();
    expect(MAX_DAUER_MS).toBeGreaterThanOrEqual(800);
    expect(MAX_DAUER_MS).toBeLessThanOrEqual(2000);
  });
});

describe('Der GANZE Text bewegt sich', () => {
  /**
   * ⚠️ Der Anlass: bei einem PGP-Block bewegten sich nur die ersten drei
   *    Zeilen — 300 Zeichen waren der Deckel, der Rest blendete als Klotz
   *    über. Für den Betrachter sah das aus, als sei die Animation kaputt.
   *
   *    Der Deckel war trotzdem richtig gedacht: 40.000 Spans für einen 40-kB-
   *    Text sind ein Ruckler, keine Eleganz. Deshalb begrenzt er jetzt die
   *    KNOTEN, nicht den Text — bei langen Texten fasst ein Knoten mehrere
   *    Zeichen zusammen und fliegt als Einheit.
   */
  const BLOCK = [
    '-----BEGIN PGP MESSAGE-----',
    '',
    ...Array.from({ length: 14 }, (_, i) => `zeile${String(i)}`.repeat(6)),
    '-----END PGP MESSAGE-----',
  ].join('\n');

  it('lässt keinen Rest unbewegt zurück', async () => {
    const { zeigeMitZerfall } = await laden();
    const behaelter = knoten('pre');
    zeigeMitZerfall(alsElement(behaelter), BLOCK, 'zerfall');
    // Alle Zeichen ausser den Umbrüchen stecken in bewegten Stücken.
    expect(bewegterText(behaelter)).toBe(BLOCK.split('\n').join(''));
  });

  it('kennt keinen unbewegten Schwanz mehr', async () => {
    const { zeigeMitZerfall } = await laden();
    const behaelter = knoten('pre');
    zeigeMitZerfall(alsElement(behaelter), BLOCK, 'zerfall');
    expect(behaelter.childNodes.some((c) => c.className === 'zf-rest')).toBe(false);
  });

  it('bleibt auch bei einem sehr langen Text im Knotenbudget', async () => {
    // Der Grund, warum es überhaupt einen Deckel gibt.
    const { zeigeMitZerfall, MAX_KNOTEN } = await laden();
    const behaelter = knoten('pre');
    zeigeMitZerfall(alsElement(behaelter), 'x'.repeat(40_000), 'zerfall');
    expect(zaehleSpans(behaelter)).toBeLessThanOrEqual(MAX_KNOTEN);
  });

  it('bewegt auch den sehr langen Text vollständig', async () => {
    // ⚠️ Das ist die eigentliche Zusage. Im Budget zu bleiben ist leicht — man
    //    könnte einfach abschneiden. Genau das war vorher der Fehler.
    const { zeigeMitZerfall } = await laden();
    const behaelter = knoten('pre');
    const lang = 'x'.repeat(40_000);
    zeigeMitZerfall(alsElement(behaelter), lang, 'zerfall');
    expect(bewegterText(behaelter)).toHaveLength(lang.length);
  });

  it('gibt jedem Zeichen einen eigenen Knoten, solange es passt', async () => {
    const { zeigeMitZerfall } = await laden();
    const behaelter = knoten('pre');
    zeigeMitZerfall(alsElement(behaelter), 'abcdefghij', 'zerfall');
    expect(zaehleSpans(behaelter)).toBe(10);
  });

  it('zerlegt ein Stück nie über eine Zeilengrenze hinweg', async () => {
    // Sonst flöge ein Stück über den Umbruch — das sähe aus wie ein Textfehler.
    const { zeigeMitZerfall } = await laden();
    const behaelter = knoten('pre');
    zeigeMitZerfall(alsElement(behaelter), 'a'.repeat(5000) + '\n' + 'b'.repeat(5000), 'zerfall');
    for (const stueck of behaelter.childNodes.filter((c) => c.className === 'zf')) {
      expect(/^a+$|^b+$/.test(stueck.textContent), stueck.textContent.slice(0, 20)).toBe(true);
    }
  });

  it('behält die Zeilenumbrüche als eigene Elemente', async () => {
    const { zeigeMitZerfall } = await laden();
    const behaelter = knoten('pre');
    zeigeMitZerfall(alsElement(behaelter), 'eins\nzwei\ndrei', 'zerfall');
    expect(behaelter.childNodes.filter((c) => c.tagName === 'BR')).toHaveLength(2);
  });

  it('setzt am Ende wieder schlichten Text — mit allen Umbrüchen', async () => {
    const { zeigeMitZerfall, MAX_DAUER_MS } = await laden();
    const behaelter = knoten('pre');
    zeigeMitZerfall(alsElement(behaelter), BLOCK, 'zerfall');
    vi.advanceTimersByTime(MAX_DAUER_MS + 10);
    // ⚠️ `gesamttext` und nicht `textContent`: die Attrappe rechnet
    //    `textContent` nicht aus den Kindern zusammen — ihr eigenes Feld
    //    bleibt leer. Das ist keine Eigenheit des Codes, sondern meiner
    //    Attrappe, und beinahe hätte ich sie für einen Fehler gehalten.
    expect(gesamttext(behaelter)).toBe(BLOCK);
  });
});

describe('Zerfall und Aufbau sehen verschieden aus', () => {
  it('die Welle läuft in entgegengesetzte Richtungen', async () => {
    // ⚠️ Vorher stand im Quelltext `richtung === 'zerfall' ? 1 - p : 1 - p` —
    //    zwei identische Zweige. Die Richtung tat NICHTS, obwohl die Doku seit
    //    Phase 2 einen Unterschied verspricht. Das fiel niemandem auf, weil
    //    beide Fälle für sich richtig aussahen.
    const { zeigeMitZerfall } = await laden();
    const text = 'abcdefghij';

    // ⚠️ Zwei Fallen auf einmal:
    //    (a) Ohne dass die Attrappe den rAF-Rückruf WIRKLICH aufruft, wird nie
    //        eine Transformation gesetzt — man vergleicht zwei leere Listen und
    //        der Test ist immer grün.
    //    (b) Ruft sie ihn unbegrenzt auf, plant die Feder sofort den nächsten
    //        Frame und ruft sich selbst tot („Maximum call stack size
    //        exceeded"). Also GENAU EIN Frame je Lauf.
    let frames = 0;
    vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => {
      if (frames++ < 1) f(16);
      return 0;
    });
    vi.stubGlobal('performance', { now: () => 16 });

    const hin = knoten('pre');
    zeigeMitZerfall(alsElement(hin), text, 'zerfall');

    frames = 0;
    const her = knoten('pre');
    zeigeMitZerfall(alsElement(her), text, 'aufbau');

    const transformationen = (k: StubKnoten) =>
      k.childNodes.filter((c) => c.className === 'zf').map((c) => c.style['transform'] ?? '');
    expect(transformationen(hin).join('')).not.toBe('');
    expect(transformationen(hin)).not.toEqual(transformationen(her));
  });
});
