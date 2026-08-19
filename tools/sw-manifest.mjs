/**
 * Trägt die gebauten Dateien in den Service Worker ein.
 *
 * ⚠️ Ohne das ist der Offline-Betrieb eine Illusion: beim ERSTEN Laden holt der
 *    Browser die Assets, bevor der Service Worker aktiv ist — sie landen also
 *    nie in seinem Cache. Beim zweiten Aufruf ohne Netz fehlt dann genau das
 *    JavaScript, das die App ausmacht. Der Offline-Test hat das sofort gezeigt.
 *
 * Die Namen tragen einen Inhalts-Hash und ändern sich mit jedem Build; deshalb
 * wird die Liste hier erzeugt und nicht von Hand gepflegt. Sie dient zugleich
 * als Cache-Version: ändert sich eine Datei, ändert sich der Name, ändert sich
 * die Version — der alte Cache wird beim Aktivieren abgeräumt.
 *
 * Aufruf: node tools/sw-manifest.mjs   (läuft als Teil von `npm run build`)
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const DIST = join(HIER, '..', 'app', 'dist');
const SW = join(DIST, 'sw.js');

function alleDateien(verzeichnis) {
  const raus = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, eintrag);
    if (statSync(pfad).isDirectory()) raus.push(...alleDateien(pfad));
    else raus.push(pfad);
  }
  return raus;
}

const dateien = alleDateien(DIST)
  .map((p) => `/${relative(DIST, p).split('\\').join('/')}`)
  .filter((p) => p !== '/sw.js')
  .sort();

// Version aus dem Inhalt: gleiche Dateien -> gleiche Version -> kein
// unnötiges Abräumen des Caches. Das hält auch den Build reproduzierbar.
const version = `klartext-${createHash('sha256').update(dateien.join('\n')).digest('hex').slice(0, 12)}`;

const quelle = readFileSync(SW, 'utf8');
const neu = quelle
  .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
  .replace(/const SCHALE = \[[^\]]*\];/s, `const SCHALE = ${JSON.stringify(['/', ...dateien], null, 2)};`);

if (neu === quelle) {
  console.error('sw-manifest: weder VERSION noch SCHALE gefunden — Platzhalter im Service Worker geändert?');
  process.exit(1);
}
writeFileSync(SW, neu);
console.log(`sw-manifest: ${String(dateien.length)} Dateien, Version ${version}`);
