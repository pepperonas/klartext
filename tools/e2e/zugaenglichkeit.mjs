/**
 * Zugaenglichkeitspruefung mit axe-core gegen den GEBAUTEN Stand.
 *
 * Warum nicht Lighthouse, obwohl der Plan es nennt: Lighthouse zieht ~292 MB
 * Abhaengigkeiten mit — darunter @sentry/node — und `npm audit` meldete dafuer
 * 20 Schwachstellen (4 davon hoch). In einem Projekt, dessen Zusage "keine
 * Telemetrie, keine fremden Dienste" lautet, ist das die falsche Abhaengigkeit,
 * selbst als reines Entwicklungswerkzeug.
 *
 * axe-core ist die Engine, auf der Lighthouses Zugaenglichkeits-Kategorie
 * ohnehin beruht, hat NULL Abhaengigkeiten — und die Latte hier liegt hoeher
 * als Lighthouses "≥ 95": null Verstoesse gegen WCAG 2.1 A und AA.
 *
 * Gegenprobe zum Zeitpunkt der Umstellung: Lighthouse meldete auf demselben
 * Stand 100/100.
 *
 * Aufruf: node tools/e2e/zugaenglichkeit.mjs
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const AXE_QUELLE = await readFile(require.resolve('axe-core'), 'utf8');

const HIER = dirname(fileURLToPath(import.meta.url));
const DIST = join(HIER, '..', '..', 'app', 'dist');
const REGELN = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  const pfad = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
  const datei = pfad === '/' ? 'index.html' : pfad.replace(/^\/+/, '');
  readFile(join(DIST, datei))
    .then((inhalt) => {
      res.writeHead(200, { 'Content-Type': TYPEN[extname(datei)] ?? 'application/octet-stream' });
      res.end(inhalt);
    })
    .catch(() => { res.writeHead(404); res.end('nicht gefunden'); });
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const basis = `http://127.0.0.1:${server.address().port}/`;

// Ein echter öffentlicher Schlüssel aus den gpg-Fixtures — für die
// Kontakt-Ansichten braucht es einen, der sich wirklich lesen lässt.
const KONTAKT_SCHLUESSEL = await readFile(
  join(HIER, '..', '..', 'fixtures', 'gpg', 'ed25519.pub.asc'), 'utf8');

const browser = await chromium.launch({ headless: true });

/** Prueft einen Zustand der App in beiden Themen. */
async function pruefe(name, vorbereiten) {
  const ergebnisse = [];
  for (const thema of ['dunkel', 'hell']) {
    const seite = await browser.newPage();
    await seite.goto(basis, { waitUntil: 'networkidle' });
    await seite.evaluate((t) => { document.documentElement.dataset.theme = t; }, thema);
    await vorbereiten(seite);
    await seite.addScriptTag({ content: AXE_QUELLE });
    const bericht = await seite.evaluate(
      (regeln) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: regeln } }),
      REGELN,
    );
    ergebnisse.push({ zustand: `${name} / ${thema}`, verstoesse: bericht.violations });
    await seite.close();
  }
  return ergebnisse;
}

/** Führt bis zu einem Schlüssel im Bund. */
async function bisSchluessel(seite) {
  await seite.waitForSelector('.nav');
  await seite.click('button:has-text("Schlüssel anlegen")');
  await seite.waitForSelector('#name');
  await seite.fill('#name', 'Prüfperson');
  await seite.click('button:has-text("Weiter")');
  await seite.waitForSelector('.wahlreihe');
  await seite.click('.wahlkarte:has-text("Curve25519")');
  await seite.click('button:has-text("Weiter")');
  await seite.waitForSelector('.vorschlag-woerter');
  const woerter = await seite.$$eval('.vw-text', (ns) => ns.map((n) => n.textContent ?? ''));
  await seite.click('button:has-text("Weiter")');
  await seite.waitForSelector('.wortproben');
  const positionen = await seite.$$eval('.wortprobe', (ns) =>
    ns.map((n) => Number((n.getAttribute('aria-label') ?? '').replace(/\D+/g, ''))));
  const proben = await seite.locator('.wortprobe').all();
  for (let i = 0; i < proben.length; i++) await proben[i].fill(woerter[positionen[i] - 1] ?? '');
  await seite.click('button:has-text("Schlüssel jetzt erzeugen")');
  await seite.waitForSelector('textarea[aria-label="Widerrufszertifikat"]', { timeout: 60_000 });
  await seite.click('button:has-text("Widerrufszertifikat herunterladen")');
  await seite.click('.schritt-fuss button:has-text("Weiter")');
  await seite.waitForSelector('#backup-pw');
  await seite.click('button:has-text("Ohne Sicherung fortfahren")');
  await seite.click('button:has-text("Verstanden")');
  await seite.waitForSelector('.fingerprint', { timeout: 20_000 });
}

const alle = [
  ...(await pruefe('leerer Schlüsselbund', async () => { await new Promise((r) => setTimeout(r, 300)); })),
  ...(await pruefe('Info — was klartext nicht kann', async (seite) => {
    await seite.waitForSelector('.nav');
    await seite.click('.nav-eintrag:has-text("Info")');
    await seite.waitForSelector('.grenze');
  })),
  ...(await pruefe('Anlegen, Identität', async (seite) => {
    await seite.waitForSelector('.nav');
    await seite.click('button:has-text("Schlüssel anlegen")');
    await seite.waitForSelector('.schrittleiste');
    await seite.click('.ausklapp summary');
  })),
  ...(await pruefe('Anlegen, Passphrase-Vorschlag', async (seite) => {
    await seite.waitForSelector('.nav');
    await seite.click('button:has-text("Schlüssel anlegen")');
    await seite.waitForSelector('#name');
    await seite.fill('#name', 'Prüfperson');
    await seite.click('button:has-text("Weiter")');
    await seite.waitForSelector('.wahlreihe');
    await seite.click('button:has-text("Weiter")');
    await seite.waitForSelector('.vorschlag-woerter');
  })),
  ...(await pruefe('Anlegen, Sichern mit Wortabfrage', async (seite) => {
    await seite.waitForSelector('.nav');
    await seite.click('button:has-text("Schlüssel anlegen")');
    await seite.waitForSelector('#name');
    await seite.fill('#name', 'Prüfperson');
    await seite.click('button:has-text("Weiter")');
    await seite.waitForSelector('.wahlreihe');
    await seite.click('button:has-text("Weiter")');
    await seite.waitForSelector('.vorschlag-woerter');
    await seite.click('button:has-text("Weiter")');
    await seite.waitForSelector('.wortproben');
  })),
  ...(await pruefe('Schlüssel vorhanden, ohne Sicherung', bisSchluessel)),
  ...(await pruefe('Sicherung erzeugen', async (seite) => {
    await bisSchluessel(seite);
    await seite.click('button:has-text("Sicherung erzeugen")');
    await seite.waitForSelector('#export-pw');
    await seite.click('button:has-text("Passwort vorschlagen")');
    await seite.waitForSelector('.passwort-vorschlag');
  })),
  ...(await pruefe('Werkzeug mit Ergebnis', async (seite) => {
    await bisSchluessel(seite);
    await seite.click('.nav-eintrag:has-text("Werkzeug")');
    await seite.waitForSelector('#wz-eingabe');
    await seite.fill('#wz-eingabe', 'Ein Satz für die Prüfung.');
    await seite.waitForSelector('.erkannt-marke', { timeout: 10_000 });
    await seite.click('button:has-text("Verschlüsseln")');
    await seite.waitForSelector('h3:has-text("Verschlüsselt")', { timeout: 30_000 });
    await seite.waitForTimeout(600);
  })),
  ...(await pruefe('Kontakte, leer', async (seite) => {
    await bisSchluessel(seite);
    await seite.click('.nav-eintrag:has-text("Kontakte")');
    await seite.waitForSelector('#kontakt-key');
  })),
  ...(await pruefe('Einladung mit QR-Code', async (seite) => {
    await bisSchluessel(seite);
    await seite.click('.nav-eintrag:has-text("Kontakte")');
    await seite.waitForSelector('#kontakt-key');
    await seite.click('button:has-text("Jemanden einladen")');
    await seite.waitForSelector('#einladung-url');
  })),
  ...(await pruefe('Fingerprint abgleichen', async (seite) => {
    await bisSchluessel(seite);
    await seite.click('.nav-eintrag:has-text("Kontakte")');
    await seite.waitForSelector('#kontakt-key');
    // Einen Kontakt anlegen, um die Abgleich-Ansicht zu erreichen.
    await seite.fill('#kontakt-key', KONTAKT_SCHLUESSEL);
    await seite.fill('#kontakt-name', 'Rosa');
    await seite.click('button:has-text("Prüfen")');
    await seite.waitForSelector('.kontakt', { timeout: 20_000 });
    await seite.click('button:has-text("Fingerprint abgleichen")');
    await seite.waitForSelector('.woerter');
  })),
  ...(await pruefe('gesperrt', async (seite) => {
    await bisSchluessel(seite);
    await seite.click('.kopf-knoepfe button:has-text("Sperren")');
    await seite.waitForSelector('#pw');
  })),
];

await browser.close();
server.close();

let gesamt = 0;
for (const { zustand, verstoesse } of alle) {
  gesamt += verstoesse.length;
  console.log(`${verstoesse.length === 0 ? '  OK  ' : '  ROT '} ${zustand}`);
  for (const v of verstoesse) {
    console.log(`        ${v.id} (${v.impact}): ${v.help}`);
    for (const k of v.nodes.slice(0, 3)) console.log(`          ${k.target.join(' ')}`);
  }
}
console.log(`\nWCAG 2.1 A + AA über ${alle.length} Zustände: ${gesamt} Verstöße\n`);
process.exit(gesamt === 0 ? 0 : 1);
