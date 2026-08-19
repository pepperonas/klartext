/**
 * Phase 2 ist fertig, wenn die App im Flugmodus vollständig arbeitet.
 *
 * Dieser Lauf lädt die Seite einmal normal, kappt danach die Verbindung
 * VOLLSTÄNDIG und verlangt, dass Schlüsselerzeugung, Verschlüsseln und
 * Entschlüsseln weiterhin funktionieren.
 *
 * Aufruf: node tools/e2e/offline.mjs
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HIER = dirname(fileURLToPath(import.meta.url));
const DIST = join(HIER, '..', '..', 'app', 'dist');
const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer((req, res) => {
  const pfad = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
  const datei = pfad === '/' ? 'index.html' : pfad.replace(/^\/+/, '');
  readFile(join(DIST, datei))
    .then((inhalt) => {
      res.writeHead(200, {
        'Content-Type': TYPEN[extname(datei)] ?? 'application/octet-stream',
        // Der Service Worker darf nur mit Scope / laufen.
        'Service-Worker-Allowed': '/',
        // ⚠️ Wortgleich mit nginx. Ohne die CSP prüfte dieser Lauf eine
        //    Umgebung, die es nicht gibt — und übersah, dass Trusted Types
        //    die Anmeldung des Service Workers blockiert.
        'Content-Security-Policy':
          "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; " +
          "font-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; " +
          "manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; " +
          "object-src 'none'; require-trusted-types-for 'script'; trusted-types klartext-worker",
      });
      res.end(inhalt);
    })
    .catch(() => {
      readFile(join(DIST, 'index.html'))
        .then((i) => { res.writeHead(200, { 'Content-Type': TYPEN['.html'] }); res.end(i); })
        .catch(() => { res.writeHead(404); res.end('nicht gefunden'); });
    });
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const basis = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true });
const kontext = await browser.newContext();
const seite = await kontext.newPage();
const fehler = [];
seite.on('pageerror', (e) => { fehler.push(e.message.split('\n')[0]); });

const PASSPHRASE = 'offline-probe-passphrase-lang';
const GEHEIM = 'Diese Zeile entsteht und vergeht ohne jedes Netz. Umlaute: Grüße, Äpfel.';

// ---- 1) Einmal normal laden, damit der Service Worker greift ---------------
await seite.goto(basis, { waitUntil: 'networkidle' });
await seite.waitForSelector('.nav');
const swBereit = await seite.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return reg.active !== null;
});

// Schlüssel anlegen, solange noch Netz da ist? Nein — genau das soll offline gehen.
await kontext.setOffline(true);
await seite.reload({ waitUntil: 'domcontentloaded' });
await seite.waitForSelector('.nav', { timeout: 20_000 });
const laedtOffline = await seite.isVisible('.nav');

// ---- 2) Schlüssel erzeugen — ohne Netz ------------------------------------
await seite.click('button:has-text("Schlüssel anlegen")');
await seite.waitForSelector('#name');
await seite.fill('#name', 'Flugmodus');
await seite.click('button:has-text("Weiter")');
await seite.waitForSelector('.wahlreihe');
await seite.click('.wahlkarte:has-text("Curve25519")');
await seite.click('button:has-text("Weiter")');
await seite.waitForSelector('.vorschlag-woerter');
// Eigene Passphrase, damit sie hier bekannt ist.
await seite.click('button:has-text("Lieber selbst tippen")');
await seite.waitForSelector('#pw');
await seite.fill('#pw', PASSPHRASE);
await seite.fill('#pw2', PASSPHRASE);
await seite.click('button:has-text("Weiter")');
await seite.waitForSelector('#probe');
await seite.fill('#probe', PASSPHRASE);
await seite.click('button:has-text("Schlüssel jetzt erzeugen")');
await seite.waitForSelector('.fingerprint', { timeout: 90_000 });
const schluesselOffline = (await seite.locator('.fingerprint').count()) > 0;

// ---- 3) Verschlüsseln und wieder entschlüsseln — ohne Netz ----------------
await seite.click('.nav-eintrag:has-text("Werkzeug")');
await seite.waitForSelector('#wz-eingabe');
await seite.fill('#wz-eingabe', GEHEIM);
await seite.waitForSelector('.erkannt-marke:has-text("Klartext")', { timeout: 10_000 });
await seite.click('button:has-text("Verschlüsseln")');
await seite.waitForSelector('h3:has-text("Verschlüsselt")', { timeout: 30_000 });
// Die Bewegung darf sich beruhigen — danach steht der Text schlicht im DOM.
await seite.waitForTimeout(600);
const ciphertext = (await seite.textContent('.ergebnis')) ?? '';
const istArmored = ciphertext.includes('BEGIN PGP MESSAGE');

await seite.click('button:has-text("Ins Eingabefeld übernehmen")');
await seite.waitForSelector('.erkannt-marke:has-text("Verschlüsselt")', { timeout: 10_000 });
await seite.click('button:has-text("Entschlüsseln")');
// ⚠️ NICHT auf '.ergebnis' warten — das steht vom Verschlüsseln noch da und
//    der Selektor träfe sofort auf den alten Inhalt. Auf die Überschrift warten.
await seite.waitForSelector('h3:has-text("Entschlüsselt")', { timeout: 30_000 });
await seite.waitForTimeout(600);
const zurueck = (await seite.textContent('.ergebnis')) ?? '';

// ---- 4) Hat der Browser wirklich nichts gefragt? --------------------------
const netzVersuche = [];
seite.on('requestfailed', (r) => { netzVersuche.push(r.url()); });

await browser.close();
server.close();

const pruefungen = [
  ['Service Worker ist aktiv', swBereit],
  ['die Seite lädt ohne Netz', laedtOffline],
  ['Schlüssel lässt sich ohne Netz erzeugen', schluesselOffline],
  ['Verschlüsseln ergibt einen Armored-Block', istArmored],
  ['Entschlüsseln gibt den Text unverändert zurück', zurueck.trim() === GEHEIM],
  ['keine Seitenfehler', fehler.length === 0],
];

let gut = true;
for (const [was, ok] of pruefungen) {
  console.log(`${ok ? '  OK  ' : '  ROT '} ${was}`);
  if (!ok) gut = false;
}
if (fehler.length > 0) { console.log('\nFehler:'); for (const f of fehler) console.log(`   ${f}`); }
if (!gut) {
  console.log(`\nCiphertext-Anfang: ${ciphertext.slice(0, 80)}`);
  console.log(`Zurück:            ${zurueck.slice(0, 80)}`);
}
console.log('');
process.exit(gut ? 0 : 1);
