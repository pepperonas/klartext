/**
 * Der DOM-Helfer.
 *
 * Er ist die Grundlage der Zusage „kein innerHTML in dieser App". Wenn er
 * irgendwo Zeichenketten als Markup deutete, wäre die Trusted-Types-Direktive
 * nur Zierde.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const SRC = join(HIER, '..', 'src');

interface Stub {
  tagName: string;
  className: string;
  textContent: string;
  attribute: Record<string, string>;
  childNodes: Stub[];
  firstChild: Stub | null;
  appendChild: (k: Stub) => Stub;
  removeChild: (k: Stub) => Stub;
  setAttribute: (n: string, w: string) => void;
}

function stub(tagName: string, text = ''): Stub {
  const k: Stub = {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: text,
    attribute: {},
    childNodes: [],
    firstChild: null,
    appendChild(kind) { k.childNodes.push(kind); k.firstChild = k.childNodes[0] ?? null; return kind; },
    removeChild(kind) {
      k.childNodes = k.childNodes.filter((c) => c !== kind);
      k.firstChild = k.childNodes[0] ?? null;
      return kind;
    },
    setAttribute(n, w) { k.attribute[n] = w; },
  };
  return k;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('document', {
    createElement: (t: string) => stub(t),
    createTextNode: (t: string) => stub('#text', t),
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

async function helfer() {
  return await import('../src/ui/dom.ts');
}

describe('el()', () => {
  it('setzt Klasse und Text über die dafür vorgesehenen Wege', async () => {
    const { el } = await helfer();
    const k = el('div', { class: 'karte', text: 'Hallo' }) as unknown as Stub;
    expect(k.className).toBe('karte');
    expect(k.textContent).toBe('Hallo');
  });

  it('setzt übrige Angaben als Attribute', async () => {
    const { el } = await helfer();
    const k = el('button', { type: 'button', 'aria-label': 'Sperren' }) as unknown as Stub;
    expect(k.attribute['type']).toBe('button');
    expect(k.attribute['aria-label']).toBe('Sperren');
  });

  it('lässt undefined und false ganz weg', async () => {
    // Sonst stünde `disabled="false"` im DOM — und das ist im HTML wahr.
    const { el } = await helfer();
    const k = el('button', { disabled: false, title: undefined }) as unknown as Stub;
    expect(Object.keys(k.attribute)).toEqual([]);
  });

  it('schreibt true als leeres Attribut', async () => {
    const { el } = await helfer();
    const k = el('input', { required: true }) as unknown as Stub;
    expect(k.attribute['required']).toBe('');
  });

  it('hängt Zeichenketten als TEXTKNOTEN an, nicht als Markup', async () => {
    // ⚠️ Der Kern der Sache: hier dürfte niemals geparst werden.
    const { el } = await helfer();
    const k = el('p', {}, '<script>böse()</script>') as unknown as Stub;
    expect(k.childNodes).toHaveLength(1);
    expect(k.childNodes[0]?.tagName).toBe('#TEXT');
    expect(k.childNodes[0]?.textContent).toBe('<script>böse()</script>');
  });

  it('überspringt leere Kinder', async () => {
    const { el } = await helfer();
    const k = el('div', {}, null, undefined, false, 'da') as unknown as Stub;
    expect(k.childNodes).toHaveLength(1);
  });
});

describe('leere() und ersetze()', () => {
  it('leert vollständig', async () => {
    const { el, leere } = await helfer();
    const k = el('div', {}, 'a', 'b', 'c');
    leere(k);
    expect((k as unknown as Stub).childNodes).toHaveLength(0);
  });

  it('ersetzt den Inhalt', async () => {
    const { el, ersetze } = await helfer();
    const k = el('div', {}, 'alt');
    ersetze(k, 'neu');
    const s = k as unknown as Stub;
    expect(s.childNodes).toHaveLength(1);
    expect(s.childNodes[0]?.textContent).toBe('neu');
  });
});

describe('Zusicherung über den gesamten Quelltext', () => {
  function alleTs(verzeichnis: string): string[] {
    const raus: string[] = [];
    for (const eintrag of readdirSync(verzeichnis)) {
      const pfad = join(verzeichnis, eintrag);
      if (statSync(pfad).isDirectory()) raus.push(...alleTs(pfad));
      else if (eintrag.endsWith('.ts')) raus.push(pfad);
    }
    return raus;
  }

  it('nirgends innerHTML, outerHTML oder document.write', () => {
    // ⚠️ Kommentarfrei prüfen — die Doku dieses Projekts nennt die verbotenen
    //    Begriffe wörtlich, um zu erklären, warum sie verboten sind.
    const suender: string[] = [];
    for (const datei of alleTs(SRC)) {
      const pur = readFileSync(datei, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (/\.(inner|outer)HTML\b/.test(pur) || /document\.write\b/.test(pur)) suender.push(datei);
    }
    expect(suender).toEqual([]);
    // Gegenprobe, dass die Suche überhaupt etwas finden KANN.
    expect(alleTs(SRC).length).toBeGreaterThan(10);
  });

  it('nirgends localStorage oder sessionStorage', () => {
    const suender: string[] = [];
    for (const datei of alleTs(SRC)) {
      const pur = readFileSync(datei, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (/\b(localStorage|sessionStorage)\b/.test(pur)) suender.push(datei);
    }
    expect(suender).toEqual([]);
  });

  it('nirgends ein fremder Server', () => {
    const erlaubt = /celox\.io|openpgpjs\.org|w3\.org|github\.com|example|invalid|fixture/;
    const suender: string[] = [];
    for (const datei of alleTs(SRC)) {
      const pur = readFileSync(datei, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const treffer of pur.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
        if (!erlaubt.test(treffer[0])) suender.push(`${datei}: ${treffer[0]}`);
      }
    }
    expect(suender).toEqual([]);
  });
});
