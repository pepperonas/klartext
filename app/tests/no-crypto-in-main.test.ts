/**
 * Strukturelle Zusicherung: der Main-Thread erreicht `openpgp` nicht.
 *
 * Das ist keine Stilfrage. Solange der Main-Thread die Bibliothek nicht einmal
 * laden kann, existiert entsperrtes Schluesselmaterial nachweislich nur im
 * Worker — und diese Aussage steht im Info-Screen der App.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { laufeGraph } from './modulgraph.ts';

const HIER = dirname(fileURLToPath(import.meta.url));
const SRC = join(HIER, '..', 'src');

describe('Quelltext', () => {
  it('der Worker-Client erreicht openpgp nicht', () => {
    const { pakete } = laufeGraph(join(SRC, 'crypto', 'client.ts'));
    expect(pakete).not.toContain('openpgp');
  });

  it('der Client kennt den Worker nur als Adresse, nicht als Code', () => {
    // `?worker&url` liefert eine URL-Zeichenkette auf einen eigenen Chunk.
    // Genau so — und nur so — bleibt die Krypto aus dem Haupt-Bundle heraus.
    const { assets } = laufeGraph(join(SRC, 'crypto', 'client.ts'));
    expect(assets).toContain('../worker/index.ts?worker&url');
  });

  it('der Vertrag erreicht openpgp nicht — auch nicht als Typ', () => {
    const { pakete } = laufeGraph(join(SRC, 'crypto', 'protocol.ts'));
    expect(pakete).not.toContain('openpgp');
  });

  it('der Worker dagegen SCHON — sonst pruefte der Test die falsche Datei', () => {
    const { pakete } = laufeGraph(join(SRC, 'worker', 'index.ts'));
    expect(pakete).toContain('openpgp');
  });

  it('nur Dateien unter worker/ importieren openpgp', () => {
    const suender: string[] = [];
    const lauf = (verzeichnis: string): void => {
      for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
        const pfad = join(verzeichnis, eintrag.name);
        if (eintrag.isDirectory()) { lauf(pfad); continue; }
        if (!eintrag.name.endsWith('.ts')) continue;
        const quelle = readFileSync(pfad, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        if (/from\s*['"]openpgp['"]/.test(quelle) && !pfad.includes(join('src', 'worker'))) {
          suender.push(pfad);
        }
      }
    };
    lauf(SRC);
    expect(suender).toEqual([]);
  });
});

/**
 * Der Bundle-Test greift erst, wenn gebaut wurde. Er wird NICHT stillschweigend
 * uebersprungen: in CI ist KLARTEXT_DIST=1 gesetzt und dann ist ein fehlendes
 * dist/ ein Fehlschlag, kein Achselzucken.
 */
const DIST = join(HIER, '..', 'dist');
const DIST_DA = existsSync(DIST);
if (process.env['KLARTEXT_DIST'] === '1' && !DIST_DA) {
  throw new Error('KLARTEXT_DIST=1, aber dist/ fehlt. Erst `npm run build`, sonst prueft hier niemand den Bundle.');
}

describe.runIf(DIST_DA)('gebauter Bundle', () => {
  function jsDateien(verzeichnis: string): string[] {
    const raus: string[] = [];
    for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
      const pfad = join(verzeichnis, eintrag.name);
      if (eintrag.isDirectory()) raus.push(...jsDateien(pfad));
      else if (eintrag.name.endsWith('.js')) raus.push(pfad);
    }
    return raus;
  }

  /**
   * ⚠️ Der Armor-Kopf ("BEGIN PGP PRIVATE KEY BLOCK") taugt NICHT als Marker:
   *    er steht voellig zu Recht als Platzhalter im Einfuege-Feld und damit im
   *    Haupt-Bundle. Der erste Anlauf dieses Tests schlug genau deshalb an und
   *    haette bei laxerer Formulierung eine Sicherheitsaussage vorgetaeuscht.
   *    Es zaehlen nur Bezeichner, die es ausserhalb der Bibliothek nicht gibt.
   */
  const NUR_IN_OPENPGP = [
    'Argon2OutOfMemoryError',
    'brainpoolP512r1',
    'parseAEADEncryptedV4KeysAsLegacy',
  ];

  function traegtKrypto(datei: string): boolean {
    const inhalt = readFileSync(datei, 'utf8');
    return NUR_IN_OPENPGP.filter((marker) => inhalt.includes(marker)).length >= 2;
  }

  it('openpgp steckt ausschliesslich im Worker-Chunk', () => {
    const dateien = jsDateien(DIST);
    expect(dateien.length).toBeGreaterThan(0);

    const mitKrypto = dateien.filter(traegtKrypto);
    expect(mitKrypto.length).toBeGreaterThan(0);
    for (const datei of mitKrypto) {
      expect(datei).toMatch(/worker|krypto/i);
    }
  });

  /**
   * ⚠️ Vite bettet einen Worker als base64-`data:`-URL in den Haupt-Bundle ein,
   *    sobald sein Import nicht mehr dem woertlichen Muster entspricht. Der
   *    Chunk verschwindet dann — und mit ihm die Zusicherung, dass die Krypto
   *    woanders liegt. Aufgefallen ist das erst, als die scharfe CSP den
   *    data:-Worker ablehnte; die Marker- und Groessenpruefung allein hat es
   *    NICHT bemerkt.
   */
  it('der Worker ist ein eigener Chunk und steckt nicht als data:-URL im Bundle', () => {
    const dateien = jsDateien(DIST);
    const workerChunks = dateien.filter((f) => /worker|krypto/i.test(f));
    expect(workerChunks.length).toBeGreaterThan(0);

    for (const datei of dateien.filter((f) => !/worker|krypto/i.test(f))) {
      const inhalt = readFileSync(datei, 'utf8');
      expect(inhalt).not.toMatch(/data:(?:video\/mp2t|text\/javascript|application\/javascript);base64/);
    }
  });

  it('der Einstiegspunkt ist klein genug, dass keine Kryptobibliothek darin sein KANN', () => {
    const einstieg = jsDateien(DIST).filter((f) => /index-/.test(f));
    expect(einstieg.length).toBe(1);
    // openpgp wiegt gebaut ~330 kB. Ein Einstiegspunkt unter 40 kB kann sie
    // nicht enthalten — unabhaengig davon, welche Marker jemand kuenftig
    // umbenennt. Zweiter, stumpfer Riegel neben der Marker-Pruefung.
    //
    // ⚠️ Als die Wortliste dazukam, sprang der Einstiegspunkt auf 94 kB und
    //    dieser Test wurde rot. Die Schranke einfach hochzusetzen haette ihn
    //    entwertet; stattdessen liegt die Liste jetzt in einem eigenen Chunk,
    //    wo sie ohnehin hingehoert (unveraenderliche Statik, eigener Cache).
    //    Eine Schranke, die man bei jedem Anschlagen lockert, sichert nichts.
    const groesse = readFileSync(einstieg[0] ?? '', 'utf8').length;
    expect(groesse).toBeLessThan(40_000);
  });
});
