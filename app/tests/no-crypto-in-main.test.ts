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

  it('der Einstiegspunkt ist klein genug, dass keine Kryptobibliothek darin sein KANN', () => {
    const einstieg = jsDateien(DIST).filter((f) => /index-/.test(f));
    expect(einstieg.length).toBe(1);
    // openpgp wiegt gebaut ~330 kB. Ein Einstiegspunkt unter 80 kB kann sie
    // nicht enthalten — unabhaengig davon, welche Marker jemand kuenftig
    // umbenennt. Zweiter, stumpfer Riegel neben der Marker-Pruefung.
    const groesse = readFileSync(einstieg[0] ?? '', 'utf8').length;
    expect(groesse).toBeLessThan(80_000);
  });
});
