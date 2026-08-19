/**
 * Liest die selbst erzeugten QR-Codes mit einem ECHTEN Decoder zurück.
 *
 * Die Unit-Tests prüfen die Tabellen gegeneinander und die Struktur des
 * Symbols. Ob am Ende wirklich das Richtige herauskommt, sagt nur ein Decoder,
 * der nichts von unserem Encoder weiss — hier Chromes `BarcodeDetector`.
 *
 * Aufruf: node tools/e2e/qr.mjs
 */

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HIER = dirname(fileURLToPath(import.meta.url));
const DIST = join(HIER, '..', '..', 'app', 'dist');

// Der Encoder wird aus dem GEBAUTEN Bundle geholt — geprüft wird, was ausgeliefert wird.
const server = createServer((req, res) => {
  const pfad = (req.url ?? '/').split('?')[0];
  readFile(join(DIST, pfad === '/' ? 'index.html' : pfad.replace(/^\/+/, '')))
    .then((inhalt) => {
      res.writeHead(200, {
        'Content-Type': pfad.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
      });
      res.end(inhalt);
    })
    .catch(() => { res.writeHead(404); res.end('nicht gefunden'); });
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const basis = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true });
const seite = await browser.newPage();
await seite.goto(basis, { waitUntil: 'networkidle' });

const unterstuetzt = await seite.evaluate(async () => {
  if (!('BarcodeDetector' in globalThis)) return false;
  const formate = await globalThis.BarcodeDetector.getSupportedFormats();
  return formate.includes('qr_code');
});

if (!unterstuetzt) {
  console.log('  ROT  Dieser Browser kann keine QR-Codes lesen — die Gegenprobe wäre wertlos.');
  await browser.close();
  server.close();
  process.exit(1);
}

// Den Encoder mit der ECHTEN Werkzeugkette übersetzen statt TypeScript von
// Hand wegzuschneiden — ein Regex-Verhau daran war der erste, gescheiterte
// Anlauf. So läuft im Browser genau das, was auch ausgeliefert wird.
const { build } = await import('vite');
const gebaut = await build({
  logLevel: 'error',
  build: {
    write: false,
    lib: {
      entry: join(HIER, '..', '..', 'app', 'src', 'contacts', 'qr.ts'),
      formats: ['es'],
      fileName: 'qr',
    },
    minify: false,
  },
});
const ausgabe = Array.isArray(gebaut) ? gebaut[0] : gebaut;
const alsJs = ausgabe.output[0].code;

const FAELLE = [
  ['kurz', 'klartext', 'Q'],
  ['Fingerprint', 'D00C49315DD8C7973BFA283EACCAC682B9FC696E', 'Q'],
  ['Umlaute', 'Grüße aus Berlin — Äpfel, weiße Wölfe, Straße', 'Q'],
  ['Emoji', 'klartext 🔐 Schlüssel 🗝️ Ende', 'M'],
  ['Einladungslink kurz', `${basis}/e#${'Aa0-_'.repeat(40)}`, 'Q'],
  ['Einladungslink lang (RSA-Grösse)', `${basis}/e#${'Aa0-_'.repeat(240)}`, 'L'],
  ['Grenzfall 1 Zeichen', 'x', 'H'],
];

const ergebnisse = [];
for (const [name, text, stufe] of FAELLE) {
  const gelesen = await seite.evaluate(
    async ([js, inhalt, ecc]) => {
      // Encoder auswerten (nur einmal nötig, aber billig).
      const modul = await import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(js)))}`);
      const qr = modul.erzeugeQr(inhalt, ecc);

      // Als Bild zeichnen — mit ruhiger Zone, sonst findet kein Decoder etwas.
      const rand = 4;
      const skala = 6;
      const kante = (qr.groesse + 2 * rand) * skala;
      const leinwand = new OffscreenCanvas(kante, kante);
      const ctx = leinwand.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, kante, kante);
      ctx.fillStyle = '#000';
      for (let y = 0; y < qr.groesse; y++) {
        for (let x = 0; x < qr.groesse; x++) {
          if (qr.dunkel(x, y)) ctx.fillRect((x + rand) * skala, (y + rand) * skala, skala, skala);
        }
      }

      const detektor = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
      const treffer = await detektor.detect(leinwand);
      return { text: treffer[0]?.rawValue ?? null, version: qr.version, groesse: qr.groesse };
    },
    [alsJs, text, stufe],
  );
  ergebnisse.push({ name, erwartet: text, gelesen, stufe });
}

await browser.close();
server.close();

let gut = true;
for (const { name, erwartet, gelesen, stufe } of ergebnisse) {
  const ok = gelesen.text === erwartet;
  if (!ok) gut = false;
  console.log(
    `${ok ? '  OK  ' : '  ROT '} ${name} (Stufe ${stufe}, Version ${String(gelesen.version)}, ${String(gelesen.groesse)}×${String(gelesen.groesse)})`,
  );
  if (!ok) {
    console.log(`         erwartet: ${erwartet.slice(0, 70)}`);
    console.log(`         gelesen : ${String(gelesen.text).slice(0, 70)}`);
  }
}
console.log('');
process.exit(gut ? 0 : 1);
