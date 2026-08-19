/**
 * Der Service Worker — als Quelltext-Vertrag geprüft.
 *
 * Ihn im Testlauf tatsächlich auszuführen bräuchte eine Browser-Umgebung; das
 * macht `tools/e2e/offline.mjs`. Hier werden die Eigenschaften festgehalten,
 * bei denen ein stiller Rückschritt teuer wäre — und die man einer Datei ansieht.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const QUELLE = readFileSync(join(HIER, '..', 'public', 'sw.js'), 'utf8');
// ⚠️ Kommentarfrei prüfen: die Kommentare erklären die Regeln und nennen dabei
//    die Begriffe, gegen die geprüft wird.
const PUR = QUELLE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Service Worker', () => {
  it('bedient nur die eigene Herkunft', () => {
    // klartext spricht mit niemandem sonst — der Service Worker soll damit
    // nicht anfangen.
    expect(PUR).toMatch(/url\.origin\s*!==\s*self\.location\.origin/);
  });

  it('lässt Nicht-GET-Anfragen unangetastet', () => {
    expect(PUR).toMatch(/anfrage\.method\s*!==\s*'GET'/);
  });

  it('fährt die Shell NETWORK-FIRST', () => {
    // ⚠️ Bei einer Krypto-App ist ein hängengebliebener alter Stand kein
    //    Schönheitsfehler: eine ausgelieferte Korrektur muss ankommen. Der
    //    Cache ist der Rückfall für den Flugmodus, nicht die erste Wahl.
    const fetchTeil = PUR.slice(PUR.indexOf("addEventListener('fetch'"));
    const holenZuerst = fetchTeil.indexOf('holenUndAblegen(anfrage).catch');
    expect(holenZuerst).toBeGreaterThan(-1);
  });

  it('bedient nur /assets/ aus dem Cache zuerst', () => {
    // Nur dort tragen die Namen einen Inhalts-Hash und sind unveränderlich.
    expect(PUR).toMatch(/pathname\.startsWith\('\/assets\/'\)/);
  });

  it('räumt beim Aktivieren fremde Cache-Versionen ab', () => {
    // Ohne das findet `caches.match` den alten Stand für immer weiter.
    expect(PUR).toMatch(/caches\.keys\(\)/);
    expect(PUR).toMatch(/caches\.delete/);
    expect(PUR).toMatch(/!==\s*VERSION/);
  });

  it('übernimmt die offenen Seiten sofort', () => {
    expect(PUR).toMatch(/skipWaiting\(\)/);
    expect(PUR).toMatch(/clients\.claim\(\)/);
  });

  it('legt nur eigene, erfolgreiche Antworten ab', () => {
    // Eine 404 oder eine undurchsichtige Antwort im Cache wäre schlimmer als
    // gar keine — sie überlebt den nächsten Netzausfall.
    expect(PUR).toMatch(/antwort\.ok/);
    expect(PUR).toMatch(/antwort\.type\s*===\s*'basic'/);
  });

  it('hat Platzhalter, die das Build-Skript findet', () => {
    // tools/sw-manifest.mjs ersetzt beide. Ändert jemand die Schreibweise,
    // bricht das Skript — und der Offline-Betrieb wäre still kaputt.
    expect(QUELLE).toMatch(/const VERSION = '[^']*';/);
    expect(QUELLE).toMatch(/const SCHALE = \[[^\]]*\];/s);
  });

  it('installiert die Schale fehlertolerant', () => {
    // Ein einzelnes fehlendes Symbol darf nicht die ganze Installation kippen.
    expect(PUR).toMatch(/cache\.add\([^)]*\)\.catch/);
  });

  it('antwortet offline und ohne Zwischenspeicher mit einer Erklärung', () => {
    expect(PUR).toMatch(/503/);
  });
});

describe('Manifest', () => {
  const manifest = JSON.parse(
    readFileSync(join(HIER, '..', 'public', 'manifest.webmanifest'), 'utf8'),
  ) as Record<string, unknown>;

  it('trägt die Pflichtangaben für eine installierbare App', () => {
    for (const feld of ['name', 'short_name', 'start_url', 'display', 'icons']) {
      expect(manifest[feld], feld).toBeDefined();
    }
    expect(manifest['display']).toBe('standalone');
    expect(manifest['lang']).toBe('de');
  });

  it('bringt ein maskierbares Symbol mit', () => {
    // Ohne `maskable` schneidet Android das Symbol in einen Kreis und
    // beschneidet dabei die Zeichnung.
    const icons = manifest['icons'] as { purpose?: string; sizes?: string }[];
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512')).toBe(true);
  });

  it('verweist auf keine fremden Server', () => {
    expect(JSON.stringify(manifest)).not.toMatch(/https?:\/\//);
  });
});
