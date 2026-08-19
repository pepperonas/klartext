/**
 * Build-Hash und Datei-Verzeichnis.
 *
 * Threat-Model Nr. 1 lautet: der Server liefert bei jedem Aufruf den Code aus,
 * der deine Schlüssel anfasst. Dagegen hilft keine Technik im Browser — wohl
 * aber die Möglichkeit, **nachzusehen**. Dieses Werkzeug erzeugt dafür zweierlei:
 *
 *   build.json  — je ausgelieferter Datei ein SHA-256, dazu ein Gesamt-Hash
 *                 über die sortierte Liste. Wer den Bau selbst wiederholt,
 *                 bekommt dieselben Werte (der Bau ist reproduzierbar, siehe
 *                 `npm run reproduzierbar`) und kann sie gegen das vergleichen,
 *                 was der Server tatsächlich schickt.
 *   index.html  — trägt den Gesamt-Hash als <meta>, damit die App ihn anzeigen
 *                 kann, und `integrity`-Attribute für die Dateien, die direkt
 *                 im Markup stehen.
 *
 * ⚠️ Was das NICHT ist: ein Schutz gegen einen Server, der dich gezielt
 *    belügt. Er könnte einen falschen Hash genauso ausliefern wie falschen
 *    Code. Der Wert liegt darin, dass eine Abweichung ÜBERHAUPT auffallen
 *    kann — bei versehentlicher Abweichung, halbem Deploy, kaputtem
 *    Zwischenspeicher, und bei jedem, der von aussen nachrechnet. Genau so
 *    steht es im Info-Screen; mehr zu behaupten wäre unredlich.
 *
 * ⚠️ Was SRI hier abdeckt: die Dateien, die als <script>/<link> im Markup
 *    stehen — Einstiegspunkt, vorgeladene Chunks (`modulepreload` kennt
 *    integrity) und Stylesheet. NICHT abgedeckt sind der
 *    Krypto-Worker (`new Worker()` kennt kein integrity), nachgeladene Chunks
 *    (dynamische Importe erben SRI nicht) und der Service Worker. Für die
 *    gibt es build.json.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WURZEL, 'app', 'dist');

/** Die Datei, die den Hash TRÄGT, kann nicht Teil des Hashes sein. */
const AUSGENOMMEN = new Set(['index.html', 'build.json']);

function sammle(verzeichnis) {
  const dateien = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) dateien.push(...sammle(voll));
    else dateien.push(voll);
  }
  return dateien;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest();
const base64 = (bytes) => Buffer.from(bytes).toString('base64');

const dateien = sammle(DIST)
  // Immer mit Schrägstrich, damit Windows denselben Hash ergibt wie Unix.
  .map((voll) => ({ voll, name: relative(DIST, voll).split(sep).join('/') }))
  .filter(({ name }) => !AUSGENOMMEN.has(name))
  .sort((a, b) => (a.name < b.name ? -1 : 1));

const verzeichnis = {};
for (const { voll, name } of dateien) {
  verzeichnis[name] = `sha256-${base64(sha256(readFileSync(voll)))}`;
}

// Der Gesamt-Hash geht über NAMEN UND INHALT. Nur über die Inhalte gerechnet
// liesse sich eine Datei umbenennen, ohne dass es auffiele.
const gesamt = `sha256-${base64(
  sha256(Object.entries(verzeichnis).map(([n, h]) => `${n} ${h}`).join('\n')),
)}`;

// ------------------------------------------------------------------ index.html
const indexPfad = join(DIST, 'index.html');
let html = readFileSync(indexPfad, 'utf8');

if (html.includes('name="klartext-build"')) {
  throw new Error('index.html trägt bereits einen Build-Hash — doppelter Lauf?');
}
html = html.replace(
  '</title>',
  `</title>\n    <meta name="klartext-build" content="${gesamt}" />`,
);

// integrity für alles, was direkt im Markup steht.
let versehen = 0;
html = html.replace(
  /<(script|link)\b([^>]*?)(src|href)="\/([^"]+)"([^>]*)>/g,
  (ganz, tag, vor, attr, datei, nach) => {
    const hash = verzeichnis[datei];
    // Nur Code und Stile: ein integrity am Favicon oder Manifest brächte
    // nichts und bräche bei jeder Icon-Änderung still den Seitenaufbau.
    if (hash === undefined || !/\.(js|css)$/.test(datei)) return ganz;
    versehen += 1;
    // ⚠️ Vite setzt `crossorigin` selbst. Es ein zweites Mal zu schreiben
    //    ergibt ein doppeltes Attribut: der Browser nimmt das erste, das
    //    Markup ist aber ungültig. Also nur ergänzen, wenn es fehlt.
    const hatCors = /\bcrossorigin\b/.test(vor) || /\bcrossorigin\b/.test(nach);
    const cors = hatCors ? '' : ' crossorigin="anonymous"';
    return `<${tag}${vor}${attr}="/${datei}"${nach} integrity="${hash}"${cors}>`;
  },
);
if (versehen === 0) throw new Error('Kein einziges integrity gesetzt — Markup geändert?');

writeFileSync(indexPfad, html);
writeFileSync(
  join(DIST, 'build.json'),
  `${JSON.stringify({ hash: gesamt, dateien: verzeichnis }, null, 2)}\n`,
);

console.log(`Build-Hash ${gesamt}`);
console.log(`  ${dateien.length} Dateien im Verzeichnis, ${versehen}× integrity gesetzt`);
