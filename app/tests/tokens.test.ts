/**
 * Die Gestaltungswerte als einzige Quelle.
 *
 * `vite.config.ts` erzeugt daraus beim Bauen das ausgelieferte `:root`. Wenn
 * hier etwas fehlt oder falsch benannt ist, fällt es sonst erst im Browser auf —
 * und zwar als unsichtbarer Text.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FARBEN_DUNKEL, FARBEN_HELL, FEDERN, MASSE, SCHRIFT, alsCss } from '../src/design/tokens.ts';

const HIER = dirname(fileURLToPath(import.meta.url));
const CSS_QUELLE = readFileSync(join(HIER, '..', 'src', 'ui', 'stil.css'), 'utf8');

describe('Vollständigkeit', () => {
  it('beide Themen kennen dieselben Farbnamen', () => {
    // Ein Name, den nur ein Thema kennt, ergibt im anderen eine leere Variable
    // — also unsichtbaren Text oder eine fehlende Kontur.
    expect(Object.keys(FARBEN_HELL).sort()).toEqual(Object.keys(FARBEN_DUNKEL).sort());
  });

  it('alle Farbwerte sind vollständige Hex-Angaben', () => {
    for (const [thema, farben] of [['dunkel', FARBEN_DUNKEL], ['hell', FARBEN_HELL]] as const) {
      for (const [name, wert] of Object.entries(farben)) {
        expect(wert, `${thema}/${name}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('Maße und Schriften sind gesetzt', () => {
    expect(Object.keys(MASSE).length).toBeGreaterThan(5);
    expect(SCHRIFT['schrift-mono']).toMatch(/mono/i);
    expect(SCHRIFT['schrift-text']).toMatch(/system-ui|sans-serif/);
  });
});

describe('erzeugtes CSS', () => {
  const css = alsCss();

  it('enthält jeden Token als --kt-Variable', () => {
    for (const name of Object.keys({ ...FARBEN_DUNKEL, ...SCHRIFT, ...MASSE })) {
      expect(css).toContain(`--kt-${name}:`);
    }
  });

  it('bindet das helle Thema an data-theme UND an die Systemeinstellung', () => {
    // Beides ist nötig: die Wahl des Nutzers muss die Systemeinstellung
    // schlagen können, ohne Wahl muss trotzdem das Richtige passieren.
    expect(css).toContain(":root[data-theme='hell']");
    expect(css).toContain('@media (prefers-color-scheme: light)');
    expect(css).toContain(":root:not([data-theme='dunkel'])");
  });

  it('setzt color-scheme, damit auch Scrollbalken und Formularfelder mitziehen', () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
    expect(css).toMatch(/color-scheme:\s*light/);
  });

  it('ist gültiges CSS mit ausgeglichenen Klammern', () => {
    const auf = (css.match(/\{/g) ?? []).length;
    const zu = (css.match(/\}/g) ?? []).length;
    expect(auf).toBe(zu);
  });
});

describe('Stylesheet gegen Tokens', () => {
  // ⚠️ Kommentarfrei prüfen: die Kommentare in stil.css erklären die Regeln
  //    und nennen dabei zwangsläufig Werte, die im Code verboten sind.
  const CSS_PUR = CSS_QUELLE.replace(/\/\*[\s\S]*?\*\//g, '');

  it('benutzt keine fest verdrahteten Hex-Farben', () => {
    // Fest verdrahtetes Weiß ist der häufigste Theme-Defekt überhaupt: es ist
    // nur so lange eine Kontur, wie der Grund dunkel ist.
    const treffer = [...CSS_PUR.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(treffer).toEqual([]);
  });

  it('benutzt kein rgba(255,255,255,…) und kein rgba(0,0,0,…)', () => {
    expect(CSS_PUR).not.toMatch(/rgba?\(\s*255\s*,\s*255\s*,\s*255/);
    expect(CSS_PUR).not.toMatch(/rgba?\(\s*0\s*,\s*0\s*,\s*0/);
  });

  it('verweist nur auf Variablen, die es auch gibt', () => {
    const bekannt = new Set(
      Object.keys({ ...FARBEN_DUNKEL, ...SCHRIFT, ...MASSE }).map((n) => `--kt-${n}`),
    );
    // Zur Laufzeit gesetzte Variablen der Themawechsel-Aufblende.
    for (const laufzeit of ['--kt-reveal-x', '--kt-reveal-y', '--kt-reveal-r']) bekannt.add(laufzeit);

    const benutzt = new Set([...CSS_PUR.matchAll(/var\((--kt-[a-z0-9-]+)/g)].map((m) => m[1] ?? ''));
    const unbekannt = [...benutzt].filter((v) => !bekannt.has(v));
    expect(unbekannt).toEqual([]);
  });

  it('lädt keine Schriften und keine Bilder von fremden Servern', () => {
    expect(CSS_PUR).not.toMatch(/@import/);
    expect(CSS_PUR).not.toMatch(/url\(\s*['"]?https?:/);
  });

  it('schaltet Bewegung bei prefers-reduced-motion ab', () => {
    expect(CSS_PUR).toMatch(/prefers-reduced-motion/);
  });

  it('schaltet beim Themawechsel den Standard-Übergang des Browsers ab', () => {
    // ⚠️ Sonst blendet der Browser old und new zusätzlich ineinander und legt
    //    sie mit plus-lighter übereinander — die Seite wäscht aus und im Kreis
    //    steht die falsche Farbe.
    expect(CSS_PUR).toMatch(/view-transition-old\(root\)/);
    expect(CSS_PUR).toMatch(/animation:\s*none/);
    expect(CSS_PUR).toMatch(/mix-blend-mode:\s*normal/);
    expect(CSS_PUR).toMatch(/isolation:\s*auto/);
    // und zwar gescoped, nicht global
    expect(CSS_PUR).toMatch(/\.thema-wechsel::view-transition/);
  });
});

describe('Federn', () => {
  it('sind alle gedämpft — eine unterdämpfte Feder schwingt ewig', () => {
    for (const [name, f] of Object.entries(FEDERN)) {
      // Kritische Dämpfung liegt bei 2·sqrt(k·m). Deutlich darunter schwingt es.
      const kritisch = 2 * Math.sqrt(f.steifigkeit * f.masse);
      expect(f.daempfung, name).toBeGreaterThan(kritisch * 0.5);
      expect(f.steifigkeit, name).toBeGreaterThan(0);
      expect(f.masse, name).toBeGreaterThan(0);
    }
  });
});
