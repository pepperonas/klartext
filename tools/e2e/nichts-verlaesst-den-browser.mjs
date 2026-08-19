/**
 * Der Test, der das Werbeversprechen prueft.
 *
 * Die App behauptet: "Dein Schluessel liegt nur in diesem Browser." Diese Datei
 * faengt JEDEN ausgehenden Weg ab — fetch, XHR, sendBeacon, WebSocket,
 * EventSource, Bild-/Skript-Quellen, Navigationen — und schaut nach, ob je eine
 * Passphrase, ein privater Schluessel oder Klartext darin auftaucht.
 *
 * Er laeuft gegen den GEBAUTEN Stand, nicht gegen den Entwicklungsserver: was
 * ausgeliefert wird, zaehlt.
 *
 * Aufruf:  node tools/e2e/nichts-verlaesst-den-browser.mjs
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HIER = dirname(fileURLToPath(import.meta.url));
const DIST = join(HIER, '..', '..', 'app', 'dist');

const MARKER = {
  passphrase: 'PASSPHRASE-MARKER-7f3a91c4',
  name: 'Marker Person',
  email: 'marker@klartext.invalid',
  exportPassphrase: 'EXPORT-MARKER-b2d8e05f',
  klartext: 'KLARTEXT-MARKER-3e91d0aa geheime Nachricht',
};

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Statischer Server mit denselben Sicherheits-Headern wie spaeter nginx. */
function starteServer() {
  const server = createServer((req, res) => {
    const pfad = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
    const datei = pfad === '/' ? 'index.html' : pfad.replace(/^\/+/, '');
    readFile(join(DIST, datei))
      .then((inhalt) => {
        res.writeHead(200, {
          'Content-Type': TYPEN[extname(datei)] ?? 'application/octet-stream',
          // Wortgleich mit dem, was nginx in Produktion sendet (deploy/nginx-klartext.conf).
          // Wenn die App das hier ueberlebt, ueberlebt sie es auch dort.
          'Content-Security-Policy':
            "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; " +
            "font-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; " +
            "manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; " +
            "object-src 'none'; require-trusted-types-for 'script'; trusted-types klartext-worker",
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(inhalt);
      })
      .catch(() => { res.writeHead(404); res.end('nicht gefunden'); });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => { resolve({ server, port: server.address().port }); });
  });
}

const verstoesse = [];
const gesehen = [];

function pruefe(quelle, text) {
  if (typeof text !== 'string' || text.length === 0) return;
  for (const [name, marker] of Object.entries(MARKER)) {
    if (text.includes(marker)) verstoesse.push(`${quelle}: enthält ${name}`);
  }
  if (/-----BEGIN PGP PRIVATE KEY BLOCK-----/.test(text)) {
    verstoesse.push(`${quelle}: enthält einen privaten Schlüssel`);
  }
}

const { server, port } = await starteServer();
const basis = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });
const kontext = await browser.newContext({ acceptDownloads: true });

// 1) Jede Anfrage, die der Browser selbst absetzt.
kontext.on('request', (req) => {
  const url = req.url();
  gesehen.push(`${req.method()} ${url}`);
  if (!url.startsWith(basis) && !url.startsWith('data:') && !url.startsWith('blob:')) {
    verstoesse.push(`Fremde Gegenstelle angesprochen: ${url}`);
  }
  pruefe(`URL ${url}`, url);
  pruefe(`Rumpf von ${url}`, req.postData());
  for (const [k, v] of Object.entries(req.headers())) pruefe(`Kopfzeile ${k}`, v);
});

const seite = await kontext.newPage();

// 2) Wege, die kein Request-Ereignis ausloesen (sendBeacon nach unload,
//    WebSocket, EventSource) werden vor jedem Skript ueberschrieben.
await seite.addInitScript(() => {
  globalThis.__ktAusgang = [];
  const merke = (art, ...teile) => {
    globalThis.__ktAusgang.push(`${art} ${teile.map((t) => String(t)).join(' ')}`);
  };
  const bOrig = navigator.sendBeacon?.bind(navigator);
  if (bOrig !== undefined) {
    navigator.sendBeacon = (url, daten) => { merke('sendBeacon', url, daten ?? ''); return bOrig(url, daten); };
  }
  const WSOrig = globalThis.WebSocket;
  globalThis.WebSocket = class extends WSOrig {
    constructor(url, p) { merke('WebSocket', url); super(url, p); }
  };
  const ESOrig = globalThis.EventSource;
  if (ESOrig !== undefined) {
    globalThis.EventSource = class extends ESOrig {
      constructor(url, c) { merke('EventSource', url); super(url, c); }
    };
  }
});

const konsole = [];
seite.on('console', (m) => { konsole.push(`${m.type()}: ${m.text()}`); });
seite.on('pageerror', (f) => { verstoesse.push(`Seitenfehler: ${f.message}`); });

await seite.goto(basis, { waitUntil: 'networkidle' });

// ---- Ablauf: Schluessel erzeugen, sperren, entsperren, exportieren ---------

await seite.waitForSelector('.nav');
await seite.click('button:has-text("Schlüssel anlegen")');
await seite.waitForSelector('#name', { timeout: 15_000 });
await seite.fill('#name', MARKER.name);

// E-Mail ist optional und eingeklappt. Dass sie NICHT verlangt wird, ist Teil
// der Zusage „Identität ist der Fingerprint".
const emailSichtbar = await seite.isVisible('#email');
await seite.click('.ausklapp summary');
await seite.fill('#email', MARKER.email);
await seite.click('button:has-text("Weiter")');

await seite.waitForSelector('.wahlreihe');
await seite.click('.wahlkarte:has-text("Curve25519")');
await seite.click('button:has-text("Weiter")');

// ---- Vorschlag: Wörter, Würfelzahlen, Bit-Angabe --------------------------
await seite.waitForSelector('.vorschlag-woerter');
const vorschlagWoerter = await seite.$$eval('.vw-text', (ns) => ns.map((n) => n.textContent ?? ''));
const vorschlagWuerfel = await seite.$$eval('.vw-wuerfel', (ns) => ns.map((n) => n.textContent ?? ''));
const bitZeile = (await seite.textContent('.schritt-inhalt .hinweis')) ?? '';
await seite.click('button:has-text("Andere Wörter")');
const zweiterZug = await seite.$$eval('.vw-text', (ns) => ns.map((n) => n.textContent ?? ''));

const woerterJetzt = await seite.$$eval('.vw-text', (ns) => ns.map((n) => n.textContent ?? ''));
MARKER.passphrase = woerterJetzt.join('-');
await seite.click('button:has-text("Weiter")');

// ---- Sichern: drei Wörter nach Position ----------------------------------
await seite.waitForSelector('.wortproben');
const proben = await seite.locator('.wortprobe').all();
await proben[0].fill('grundfalsch');
const gesperrtBeiFalsch = await seite.isDisabled('button:has-text("Schlüssel jetzt erzeugen")');
const positionen = await seite.$$eval('.wortprobe', (ns) =>
  ns.map((n) => Number((n.getAttribute('aria-label') ?? '').replace(/\D+/g, ''))));
for (let i = 0; i < proben.length; i++) await proben[i].fill(woerterJetzt[positionen[i] - 1] ?? '');
const freiBeiRichtig = await seite.isEnabled('button:has-text("Schlüssel jetzt erzeugen")');

await seite.click('button:has-text("Schlüssel jetzt erzeugen")');
// Der Assistent endet hier; Widerruf und Sicherung sind Aufgaben auf der
// Schlüsselseite. Beide werden gleich über genau diesen Weg erledigt.
await seite.waitForSelector('.fingerprint', { timeout: 90_000 });

// ⚠️ Das Widerrufszertifikat steht nicht mehr in einem Feld, es wird direkt
//    heruntergeladen. Also wird der Download abgefangen — das ist ohnehin der
//    Weg, den der Nutzer geht.
const [herunterladen] = await Promise.all([
  seite.waitForEvent('download', { timeout: 30_000 }),
  seite.click('.aufgabenkarte button:has-text("Jetzt erzeugen")'),
]);
const zertifikat = readFileSync(await herunterladen.path(), 'utf8');

await seite.click('.aufgabenkarte button:has-text("Sicherung erzeugen")');
await seite.waitForSelector('#export-pw', { timeout: 20_000 });
await seite.fill('#export-pw', MARKER.exportPassphrase);
await seite.click('button:has-text("Sicherung erzeugen")');
await seite.waitForTimeout(1500);
await seite.click('.nav-eintrag:has-text("Schlüssel")');
await seite.waitForSelector('.fingerprint', { timeout: 30_000 });
const fingerprint = (await seite.textContent('.fingerprint'))?.trim() ?? '';
const kerbeOffen = (await seite.textContent('.kerbe'))?.trim() ?? '';

// ---- Werkzeug: der Klartext darf nirgends auftauchen ---------------------
await seite.click('.nav-eintrag:has-text("Werkzeug")');
await seite.waitForSelector('#wz-eingabe');
await seite.fill('#wz-eingabe', MARKER.klartext);
await seite.waitForSelector('.erkannt-marke:has-text("Klartext")', { timeout: 10_000 });
await seite.click('button:has-text("Verschlüsseln")');
await seite.waitForSelector('h3:has-text("Verschlüsselt")', { timeout: 30_000 });
await seite.waitForTimeout(600);
const ciphertext = (await seite.textContent('.ergebnis')) ?? '';
await seite.click('button:has-text("Ins Eingabefeld übernehmen")');
await seite.waitForSelector('.erkannt-marke:has-text("Verschlüsselt")', { timeout: 10_000 });
await seite.click('button:has-text("Entschlüsseln")');
await seite.waitForSelector('h3:has-text("Entschlüsselt")', { timeout: 30_000 });
await seite.waitForTimeout(600);
const wiederhergestellt = (await seite.textContent('.ergebnis')) ?? '';

await seite.click('.nav-eintrag:has-text("Schlüssel")');
await seite.waitForSelector('.fingerprint');

await seite.click('.kopf-knoepfe button:has-text("Sperren")');
await seite.waitForSelector('#pw', { timeout: 10_000 });
const kerbeZu = (await seite.textContent('.kerbe'))?.trim() ?? '';

await seite.fill('#pw', MARKER.passphrase);
await seite.click('button[type=submit]');
await seite.waitForSelector('.warnkasten, .fingerprint', { timeout: 30_000 });

await seite.click('.kopf-knoepfe button:has-text("Sperren")');
await seite.waitForSelector('#pw');
await seite.fill('#pw', 'falsch');
await seite.click('button[type=submit]');
await seite.waitForSelector('.meldung[data-art=gefahr]', { timeout: 20_000 });
const fehlermeldung = (await seite.textContent('.meldung[data-art=gefahr]')) ?? '';

// 3) Wurde etwas ueber die abgefangenen Wege geschickt?
const ausgang = await seite.evaluate(() => globalThis.__ktAusgang ?? []);
for (const eintrag of ausgang) pruefe('abgefangener Ausgang', eintrag);

// 4) Steht die Passphrase irgendwo, wo sie nicht hingehoert?
const speicher = await seite.evaluate(() => ({
  local: JSON.stringify(globalThis.localStorage),
  session: JSON.stringify(globalThis.sessionStorage),
  url: location.href,
  titel: document.title,
}));
for (const [ort, inhalt] of Object.entries(speicher)) pruefe(`Speicher/${ort}`, inhalt);

await browser.close();
server.close();

// ------------------------------------------------------------------ Bericht

const pruefungen = [
  ['E-Mail ist nicht verlangt, sondern eingeklappt', !emailSichtbar],
  ['Vorschlag liefert Wörter', vorschlagWoerter.length >= 5 && vorschlagWoerter.every((w) => /^[a-z]{3,}$/.test(w))],
  ['zu jedem Wort stehen die Würfelaugen', vorschlagWuerfel.length === vorschlagWoerter.length && vorschlagWuerfel.every((w) => /^[1-6]{5}$/.test(w))],
  ['die Entropie wird in Bit genannt', /\d+ Bit/.test(bitZeile)],
  ['andere Wörter ergeben andere Wörter', zweiterZug.join() !== vorschlagWoerter.join()],
  ['falsches Kontrollwort sperrt das Weitergehen', gesperrtBeiFalsch],
  ['richtige Kontrollwörter geben es frei', freiBeiRichtig],
  ['Widerrufszertifikat ausgegeben', zertifikat.includes('BEGIN PGP PUBLIC KEY BLOCK')],
  ['Schlüssel erzeugt und Fingerprint angezeigt', /^[0-9A-F]{4}( [0-9A-F]{4}){9}$/.test(fingerprint)],
  ['Sperr-Anzeige meldet "offen"', kerbeOffen.includes('offen')],
  ['Sperr-Anzeige meldet "gesperrt"', kerbeZu.includes('gesperrt')],
  ['Restzeit bis zur Sperre wird genannt', /sperrt in \d+:\d{2}/.test(kerbeOffen)],
  ['falsche Passphrase wird abgewiesen', fehlermeldung.includes('Passphrase falsch')],
  ['keine Fehler in der Konsole', konsole.filter((z) => z.startsWith('error')).length === 0],
  ['ausschließlich Anfragen an die eigene Herkunft', !verstoesse.some((v) => v.startsWith('Fremde'))],
  ['kein Ausgang über sendBeacon/WebSocket/EventSource', ausgang.length === 0],
  ['Rundlauf im Werkzeug erhält den Text', wiederhergestellt.trim() === MARKER.klartext],
  ['der Ciphertext ist ein Armored-Block', ciphertext.includes('BEGIN PGP MESSAGE')],
  ['nichts Geheimes in irgendeiner Anfrage', verstoesse.length === 0],
];

console.log(`\n${gesehen.length} Anfragen beobachtet:`);
for (const z of gesehen) console.log(`   ${z}`);
console.log('');
let alleGut = true;
for (const [was, gut] of pruefungen) {
  console.log(`${gut ? '  OK  ' : '  ROT '} ${was}`);
  if (!gut) alleGut = false;
}
const konsolenFehler = konsole.filter((z) => z.startsWith('error'));
if (konsolenFehler.length > 0) {
  console.log('\nKonsolenfehler:');
  for (const z of konsolenFehler) console.log(`   ${z}`);
}
if (verstoesse.length > 0) {
  console.log('\nVerstösse:');
  for (const v of verstoesse) console.log(`   ${v}`);
}
console.log('');
process.exit(alleGut ? 0 : 1);
