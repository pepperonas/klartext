/**
 * Eine handgeschriebene DOM-Attrappe für Tests.
 *
 * Warum keine Bibliothek: das Versprechen dieser App ist die kurze
 * Abhängigkeitsliste, und die gilt auch für Entwicklungswerkzeug. jsdom wäre
 * ein grosses Paket für das bisschen DOM, das `ui/dom.ts` überhaupt anfasst —
 * `createElement`, `createTextNode`, `appendChild`, Attribute, Klassen.
 *
 * ⚠️ Die Attrappe ist ABSICHTLICH nicht wohlwollend. Sie tut nur, was das
 *    echte DOM auch tut; sie erfindet nichts und deckt nichts zu. Eine
 *    grosszügige Attrappe lässt Tests grün werden, die im Browser scheitern.
 *
 * Sie lag zuvor wörtlich in `nav.test.ts`; mit dem zweiten Nutzer wäre daraus
 * eine Kopie geworden, die auseinanderläuft.
 */

export interface StubKnoten {
  tagName: string;
  className: string;
  textContent: string;
  attribute: Record<string, string>;
  dataset: Record<string, string>;
  title: string;
  hidden: boolean;
  disabled: boolean;
  childNodes: StubKnoten[];
  firstChild: StubKnoten | null;
  classList: { toggle: (n: string, an: boolean) => void; contains: (n: string) => boolean };
  appendChild: (k: StubKnoten) => StubKnoten;
  removeChild: (k: StubKnoten) => StubKnoten;
  addEventListener: (t: string, f: () => void) => void;
  setAttribute: (n: string, w: string) => void;
  removeAttribute: (n: string) => void;
  /** Löst den Klick-Handler aus, den der Quelltext gesetzt hat. */
  klicke: () => void;
}

export function stubKnoten(tag: string, text = ''): StubKnoten {
  let klick: (() => void) | null = null;
  const klassen = new Set<string>();
  const k: StubKnoten = {
    tagName: tag.toUpperCase(),
    get className() { return [...klassen].join(' '); },
    set className(w: string) {
      klassen.clear();
      for (const t of w.split(/\s+/).filter(Boolean)) klassen.add(t);
    },
    textContent: text,
    attribute: {},
    dataset: {},
    title: '',
    hidden: false,
    disabled: false,
    childNodes: [],
    firstChild: null,
    classList: {
      toggle: (n, an) => { if (an) klassen.add(n); else klassen.delete(n); },
      contains: (n) => klassen.has(n),
    },
    appendChild(kind) { k.childNodes.push(kind); k.firstChild = k.childNodes[0] ?? null; return kind; },
    removeChild(kind) {
      k.childNodes = k.childNodes.filter((c) => c !== kind);
      k.firstChild = k.childNodes[0] ?? null;
      return kind;
    },
    addEventListener(t, f) { if (t === 'click') klick = f; },
    setAttribute(n, w) { k.attribute[n] = w; },
    removeAttribute(n) {
      k.attribute = Object.fromEntries(Object.entries(k.attribute).filter(([x]) => x !== n));
    },
    klicke() { klick?.(); },
  };
  return k;
}

/** Das Wenige aus `document`, das `ui/dom.ts` benutzt. */
export function stubDokument(): { createElement: (t: string) => StubKnoten; createTextNode: (t: string) => StubKnoten } {
  return {
    createElement: (t) => stubKnoten(t),
    createTextNode: (t) => stubKnoten('#text', t),
  };
}

/** Alle Texte eines Teilbaums, in Dokumentreihenfolge. */
export function texte(k: StubKnoten): string[] {
  if (k.childNodes.length === 0) return k.textContent.length > 0 ? [k.textContent] : [];
  return k.childNodes.flatMap(texte);
}

/** Alle Knoten eines Teilbaums, die eine bestimmte Klasse tragen. */
export function mitKlasse(k: StubKnoten, klasse: string): StubKnoten[] {
  const treffer = k.classList.contains(klasse) ? [k] : [];
  return [...treffer, ...k.childNodes.flatMap((kind) => mitKlasse(kind, klasse))];
}
