/**
 * Liest die selbst erzeugten QR-Codes mit FREMDEN Decodern zurück.
 *
 * Die Unit-Tests prüfen die beiden abgeschriebenen Tabellen gegeneinander und
 * die Struktur des Symbols. Ob am Ende wirklich das Richtige herauskommt, sagt
 * nur ein Decoder, der nichts von unserem Encoder weiss.
 *
 * Zwei davon, und zwar mit Absicht:
 *
 *   · **jsQR** — reines JavaScript, läuft überall, auch auf dem CI-Läufer.
 *   · **BarcodeDetector** — Chromes eigener Decoder, benutzt die Bibliotheken
 *     des Betriebssystems. Er ist der realistischere Prüfstein, gibt es aber
 *     nur auf macOS und Android; unter Linux fehlt er.
 *
 * ⚠️ Der zweite wird übersprungen, wo es ihn nicht gibt — aber NIE stumm: der
 *    Bericht sagt, welche Decoder gelaufen sind. Ein Lauf, bei dem gar keiner
 *    verfügbar war, ist ein Fehlschlag. Genau daran ist die erste Fassung in
 *    der CI hängengeblieben: sie brach ab, statt auf jsQR auszuweichen.
 *
 * Aufruf: node tools/e2e/qr.mjs
 */

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const HIER = dirname(fileURLToPath(import.meta.url));

// Den Encoder mit der ECHTEN Werkzeugkette übersetzen statt TypeScript von
// Hand wegzuschneiden — ein Regex-Verhau daran war der erste, gescheiterte
// Anlauf.
const { build } = await import('vite');
const gebaut = await build({
  logLevel: 'error',
  build: {
    write: false,
    lib: { entry: join(HIER, '..', '..', 'app', 'src', 'contacts', 'qr.ts'), formats: ['es'], fileName: 'qr' },
    minify: false,
  },
});
const encoderQuelle = (Array.isArray(gebaut) ? gebaut[0] : gebaut).output[0].code;
const jsqrQuelle = await readFile(require.resolve('jsqr'), 'utf8');

/**
 * ⚠️ Befund aus der Mutationsprobe: ein falsches Byte in der Blocktabelle bei
 *    Version 2 / Stufe Q wurde vom geometrischen Unit-Test gefangen, von dieser
 *    Gegenprobe aber NICHT — sie kam an dieser Zeile schlicht nie vorbei.
 *
 *    Die beiden Prüfungen ergänzen sich also: der Unit-Test deckt alle 160
 *    Tabellenzeilen erschöpfend ab, dieser Lauf prüft die Kette vom Text bis
 *    zum gelesenen Bild. Damit die Lücke dazwischen kleiner wird, fährt er
 *    zusätzlich eine Reihe über die Versionen — dafür wird die Nutzlast so
 *    bemessen, dass genau die gewünschte Version herauskommt.
 */
/**
 * Nutzlast, die genau die gewünschte Version erzwingt.
 *
 * ⚠️ Bewusst ABWECHSLUNGSREICH, nicht `'x'.repeat(n)`. Eine gleichförmige
 *    Nutzlast erzeugt bei den grössten Symbolen sehr regelmässige Muster, an
 *    denen Apples `BarcodeDetector` bei Version 38 und 40 (Stufe Q) hängen
 *    bleibt — jsQR liest dieselben Symbole einwandfrei, und mit
 *    abwechslungsreichem Inhalt liest sie auch der Detector.
 *
 *    Das ist also eine Eigenheit des Decoders bei pathologischem Material,
 *    kein Fehler des Encoders — und pathologisch ist es: klartext kodiert
 *    base64-Nutzlasten, die von Natur aus hohe Entropie haben. Nachgemessen an
 *    zwölf Fällen über die Versionen 38 bis 40 in allen vier Stufen.
 */
function fuerVersion(version, stufe, kapazitaet) {
  const laenge = kapazitaet(version, stufe);
  const zeichen = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let raus = '';
  for (let i = 0; i < laenge; i++) raus += zeichen[(i * 37 + (i >> 5)) % zeichen.length];
  return raus;
}

const VERSIONS_REIHE = [1, 2, 3, 5, 7, 10, 14, 20, 27, 33, 40];

const FAELLE = [
  ['kurz', 'klartext', 'Q'],
  ['Fingerprint', 'D00C49315DD8C7973BFA283EACCAC682B9FC696E', 'Q'],
  ['Umlaute', 'Grüße aus Berlin — Äpfel, weiße Wölfe, Straße', 'Q'],
  ['Emoji', 'klartext 🔐 Schlüssel 🗝️ Ende', 'M'],
  ['Einladung Curve25519', `https://klartext.celox.io/e#${'Aa0-_'.repeat(140)}`, 'Q'],
  ['Einladung, RSA-Grösse', `https://klartext.celox.io/e#${'Aa0-_'.repeat(240)}`, 'L'],
  ['Grenzfall 1 Zeichen', 'x', 'H'],
  ['alle vier Stufen: L', 'Stufenprobe', 'L'],
  ['alle vier Stufen: M', 'Stufenprobe', 'M'],
  ['alle vier Stufen: H', 'Stufenprobe', 'H'],
];

// ⚠️ Über HTTP servieren, nicht per setContent: `BarcodeDetector` verlangt
//    einen sicheren Kontext, und `about:blank` ist keiner. Ohne das meldet
//    Chrome auch dort „nicht verfügbar", wo es ihn in Wahrheit gibt.
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>QR-Gegenprobe</title>');
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });

// Die Kapazitäten aus dem gebauten Encoder holen, um die Versionsreihe zu bauen.
const encoderModul = await import(
  `data:text/javascript;base64,${Buffer.from(encoderQuelle, 'utf8').toString('base64')}`);
for (const version of VERSIONS_REIHE) {
  for (const stufe of ['L', 'Q']) {
    const text = fuerVersion(version, stufe, encoderModul.kapazitaet);
    FAELLE.push([`Version ${String(version)} / ${stufe}`, text, stufe]);
  }
}

const browser = await chromium.launch({ headless: true });
const seite = await browser.newPage();
await seite.goto(`http://127.0.0.1:${server.address().port}/`);

const hatBarcodeDetector = await seite.evaluate(async () => {
  if (!('BarcodeDetector' in globalThis)) return false;
  try {
    return (await globalThis.BarcodeDetector.getSupportedFormats()).includes('qr_code');
  } catch { return false; }
});

const ergebnisse = [];
for (const [name, text, stufe] of FAELLE) {
  const lauf = await seite.evaluate(
    async ([encJs, jsqrJs, inhalt, ecc, mitDetector]) => {
      const modul = await import(
        `data:text/javascript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(encJs)))}`);
      const qr = modul.erzeugeQr(inhalt, ecc);

      // Als Bild zeichnen — mit ruhiger Zone, sonst findet kein Decoder etwas.
      const rand = 4;
      // Grosse Symbole brauchen mehr Pixel je Modul, sonst verschmiert der
      // Decoder die Zellen ineinander.
      const skala = qr.groesse > 120 ? 16 : 6;
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
      const bild = ctx.getImageData(0, 0, kante, kante);

      // jsQR als UMD-Modul auswerten.
      const fabrik = new Function('module', 'exports', `${jsqrJs}\nreturn module.exports;`);
      const modulHuelle = { exports: {} };
      const jsQR = fabrik(modulHuelle, modulHuelle.exports).default ?? fabrik(modulHuelle, modulHuelle.exports);
      const jsqrTreffer = jsQR(bild.data, kante, kante);

      let detectorText = null;
      if (mitDetector) {
        const d = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
        detectorText = (await d.detect(leinwand))[0]?.rawValue ?? null;
      }

      return {
        jsqr: jsqrTreffer?.data ?? null,
        detector: detectorText,
        version: qr.version,
        groesse: qr.groesse,
      };
    },
    [encoderQuelle, jsqrQuelle, text, stufe, hatBarcodeDetector],
  );
  ergebnisse.push({ name, erwartet: text, lauf, stufe });
}

await browser.close();
server.close();

// ------------------------------------------------------------------ Bericht

console.log(
  `Decoder: jsQR ✓ · BarcodeDetector ${hatBarcodeDetector ? '✓' : '— (auf dieser Plattform nicht verfügbar)'}\n`,
);

let gut = true;
for (const { name, erwartet, lauf, stufe } of ergebnisse) {
  const jsqrOk = lauf.jsqr === erwartet;
  const detOk = !hatBarcodeDetector || lauf.detector === erwartet;
  const ok = jsqrOk && detOk;
  if (!ok) gut = false;
  console.log(
    `${ok ? '  OK  ' : '  ROT '} ${name} (Stufe ${stufe}, Version ${String(lauf.version)}, ${String(lauf.groesse)}×${String(lauf.groesse)})`,
  );
  if (!jsqrOk) console.log(`         jsQR las: ${String(lauf.jsqr).slice(0, 70)}`);
  if (!detOk) console.log(`         BarcodeDetector las: ${String(lauf.detector).slice(0, 70)}`);
}

// ⚠️ Kein stiller Durchmarsch: wenn gar kein Decoder lief, ist das ein Fehler.
if (ergebnisse.length === 0) {
  console.log('  ROT  Kein einziger Fall geprüft.');
  gut = false;
}
console.log('');
process.exit(gut ? 0 : 1);
