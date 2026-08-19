/**
 * Erzeugt die Bilder für die Dokumentation aus der GEBAUTEN App.
 *
 * ⚠️ Keine Montagen, keine nachbearbeiteten Bilder: was im README steht, muss
 *    das sein, was die App tut. Ein geschöntes Bild ist eine Zusage, die der
 *    Quelltext nicht einlöst.
 *
 * ⚠️ Der Schlüssel in den Bildern ist ein Wegwerf-Schlüssel aus diesem Lauf.
 *    Abgebildet ist ohnehin nur Öffentliches (Fingerprint, Ciphertext) — ein
 *    privater Schlüssel taucht in keinem Bild auf, und ein Test hält das fest.
 *
 *   node tools/bilder.mjs
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const WURZEL = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WURZEL, 'app', 'dist');
const ZIEL = join(WURZEL, 'docs', 'bilder');
const TYP = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.md': 'text/plain', '.txt': 'text/plain',
};

const server = createServer((req, res) => {
  const pfad = (req.url ?? '/').split('?')[0];
  let datei = join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  try { readFileSync(datei); } catch { datei = join(DIST, 'index.html'); }
  res.setHeader('Content-Type', TYP[extname(datei)] ?? 'application/octet-stream');
  res.end(readFileSync(datei));
}).listen(0);
const basis = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const fehler = [];

async function legeSchluesselAn(seite, name, passphrase) {
  await seite.goto(basis, { waitUntil: 'networkidle' });
  await seite.waitForSelector('.nav');
  await seite.click('button:has-text("Schlüssel anlegen")');
  await seite.waitForSelector('#name');
  await seite.fill('#name', name);
  await seite.click('button:has-text("Weiter")');
  await seite.waitForSelector('.wahlreihe');
  await seite.click('.wahlkarte:has-text("Curve25519")');
  await seite.click('button:has-text("Weiter")');
  await seite.waitForSelector('.vorschlag-woerter');
  await seite.click('button:has-text("Lieber selbst tippen")');
  await seite.waitForSelector('#pw');
  await seite.fill('#pw', passphrase);
  await seite.fill('#pw2', passphrase);
  await seite.click('button:has-text("Weiter")');
  await seite.waitForSelector('#probe');
  await seite.fill('#probe', passphrase);
  await seite.click('button:has-text("Schlüssel jetzt erzeugen")');
  // ⚠️ Der Assistent endet seit dem Benutzbarkeits-Durchgang beim erzeugten
  //    Schlüssel. Widerrufszertifikat und Sicherung sind Aufgaben auf der
  //    Schlüsselseite geworden — hier ist danach nichts mehr zu klicken.
  await seite.waitForSelector('.fingerprint', { timeout: 90_000 });
}






/** Ein Bild in beiden Themen wäre doppelt so schwer — dunkel ist die Vorgabe. */
async function bild(name, aufbau, vp = { width: 1100, height: 800 }) {
  // ⚠️ Nicht 2. GitHub zeigt README-Bilder mit rund 880 px Breite; bei
  //    Faktor 2 wären es 2200 px und 1,2 MB im Repo für Pixel, die niemand
  //    sieht. 1,5 ist auf Bildschirmen mit hoher Auflösung noch scharf.
  const kontext = await browser.newContext({ viewport: vp, deviceScaleFactor: 1.5, colorScheme: 'dark' });
  const seite = await kontext.newPage();
  seite.on('pageerror', (e) => { fehler.push(`${name}: ${e.message.split('\n')[0]}`); });
  await seite.goto(basis, { waitUntil: 'networkidle' });
  await seite.waitForSelector('.nav');
  await aufbau(seite);
  await seite.evaluate(() => document.fonts.ready);
  await seite.waitForTimeout(400);
  await seite.screenshot({ path: join(ZIEL, `${name}.png`), fullPage: false });
  BILDER.push(name);
  console.log(`  ${name}.png`);
  await kontext.close();
}

const PW = 'bilder-passphrase-lang-genug';
const BILDER = [];

await bild('start', async () => { /* die Landung, wie sie ist */ });

await bild('werkzeug-ohne-schluessel', async (s) => {
  await s.click('.nav-eintrag:has-text("Werkzeug")');
  await s.waitForSelector('#wz-eingabe');
  await s.fill('#wz-fremd', readFileSync(join(WURZEL, 'fixtures', 'gpg', 'ed25519.pub.asc'), 'utf8'));
  await s.fill('#wz-eingabe', 'Treffpunkt bleibt wie besprochen.');
  await s.waitForTimeout(600);
});

await bild('anlegen-passphrase', async (s) => {
  await s.click('button:has-text("Schlüssel anlegen")');
  await s.waitForSelector('#name');
  await s.fill('#name', 'Beispiel');
  await s.click('button:has-text("Weiter")');
  await s.waitForSelector('.wahlreihe');
  await s.click('.wahlkarte:has-text("Curve25519")');
  await s.click('button:has-text("Weiter")');
  await s.waitForSelector('.vorschlag-woerter');
});

await bild('werkzeug-ergebnis', async (s) => {
  await legeSchluesselAn(s, 'Beispiel', PW);
  await s.click('.nav-eintrag:has-text("Werkzeug")');
  await s.waitForSelector('#wz-eingabe');
  await s.fill('#wz-eingabe', 'Treffpunkt bleibt wie besprochen.');
  await s.waitForTimeout(500);
  await s.click('button:has-text("Verschlüsseln")');
  await s.waitForSelector('.ergebnis', { timeout: 30_000 });
  await s.waitForTimeout(900);
  // ⚠️ Die App scrollt selbst zum Ergebnis; ohne Zurückspringen wäre der Kopf
  //    angeschnitten. So zeigt das Bild zugleich, dass Eingabe und Ergebnis
  //    beieinanderstehen — das ist der Punkt.
  await s.evaluate(() => { window.scrollTo(0, 0); });
  await s.waitForTimeout(200);
}, { width: 1100, height: 1180 });

await bild('einladung', async (s) => {
  await legeSchluesselAn(s, 'Beispiel', PW);
  await s.click('.nav-eintrag:has-text("Kontakte")');
  await s.click('button:has-text("Jemanden einladen")');
  await s.waitForSelector('#einladung-url');
}, { width: 1100, height: 900 });

await bild('grenzen', async (s) => {
  await s.click('.nav-eintrag:has-text("Info")');
  await s.waitForSelector('.grenze');
});

await browser.close();
server.close();

// Verlustbehaftet quantisieren: die Oberfläche hat wenige Farbtöne, der
// Unterschied ist nicht zu sehen, die Dateien werden rund viermal kleiner.
try {
  const { execFileSync } = await import('node:child_process');
  for (const name of BILDER) {
    const datei = join(ZIEL, `${name}.png`);
    execFileSync('pngquant', ['--quality', '65-88', '--strip', '--force', '--output', datei, datei]);
  }
  console.log('  (mit pngquant verkleinert)');
} catch {
  console.log('  (pngquant fehlt — Bilder bleiben unkomprimiert)');
}
console.log(fehler.length === 0 ? 'Alle Bilder erzeugt.' : `Seitenfehler: ${fehler.join(' | ')}`);
process.exit(fehler.length === 0 ? 0 : 1);
