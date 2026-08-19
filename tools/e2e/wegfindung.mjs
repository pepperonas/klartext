/**
 * Wegfindung: kein Zustand darf eine Sackgasse sein.
 *
 * Anlass war die Frage „wie komme ich hier zurück?" — im gesperrten Zustand gab
 * es genau einen Handgriff und keinen Ausweg. Damit so etwas beim Bauen auffällt
 * und nicht beim Benutzen, prüft dieser Lauf für JEDEN Zustand:
 *
 *   1. Es gibt eine Überschrift, die sagt, wo man ist.
 *   2. Es gibt mindestens einen Weg heraus.
 *   3. Kein sichtbarer Knopf tut nichts (kein „Sperren", wenn schon gesperrt).
 *   4. Die Zurück-Geste des Browsers führt dorthin, wo man herkam.
 *
 * Aufruf: node tools/e2e/wegfindung.mjs
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
};

// SPA-Rückfall wie in nginx: jeder unbekannte Pfad liefert index.html.
const server = createServer((req, res) => {
  const pfad = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
  const datei = pfad === '/' ? 'index.html' : pfad.replace(/^\/+/, '');
  readFile(join(DIST, datei))
    .then((inhalt) => {
      res.writeHead(200, { 'Content-Type': TYPEN[extname(datei)] ?? 'application/octet-stream' });
      res.end(inhalt);
    })
    .catch(() => {
      readFile(join(DIST, 'index.html')).then((inhalt) => {
        res.writeHead(200, { 'Content-Type': TYPEN['.html'] });
        res.end(inhalt);
      }).catch(() => { res.writeHead(404); res.end('nicht gefunden'); });
    });
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const basis = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true });
const seite = await browser.newPage();
const fehler = [];
seite.on('pageerror', (e) => { fehler.push(`Seitenfehler: ${e.message.split('\n')[0]}`); });

/** Liest den sichtbaren Zustand aus. */
async function lage() {
  return await seite.evaluate(() => {
    const sichtbar = (n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden';
    };
    const q = (s) => [...document.querySelectorAll(s)].filter(sichtbar);
    return {
      pfad: location.pathname,
      ueberschriften: q('h1,h2,h3').map((n) => n.textContent.trim()).filter(Boolean),
      knoepfe: q('button').map((n) => n.textContent.trim() || n.getAttribute('aria-label') || '?'),
      felder: q('input,textarea,select').length,
    };
  });
}

const ergebnisse = [];
function pruefe(name, lage, wegeHeraus) {
  const probleme = [];
  if (lage.ueberschriften.length === 0) probleme.push('keine Überschrift — man weiß nicht, wo man ist');
  if (wegeHeraus.length === 0) probleme.push('kein Weg heraus');
  ergebnisse.push({ name, probleme, wege: wegeHeraus, pfad: lage.pfad });
}

/** Knöpfe, die aus diesem Zustand herausführen (Navigation, Zurück, Abbrechen). */
function wegeHeraus(lage) {
  const raus = /Schlüssel|Info|klartext|Zurück|Abbrechen|Weiter|Übersicht|Werkzeug|Was klartext nicht kann/i;
  return lage.knoepfe.filter((k) => raus.test(k));
}

// ---------------------------------------------------------------- Durchlauf

await seite.goto(basis, { waitUntil: 'networkidle' });
await seite.waitForSelector('.nav');

let l = await lage();
pruefe('A · leerer Schlüsselbund', l, wegeHeraus(l));
const sperrenImLeeren = l.knoepfe.includes('Sperren');

await seite.click('button:has-text("Was klartext nicht kann")');
await seite.waitForSelector('h2:has-text("Was klartext nicht kann")');
l = await lage();
pruefe('B · Info', l, wegeHeraus(l));
const infoPfad = l.pfad;

// Zurück-Geste des Browsers
await seite.goBack();
await seite.waitForSelector('.karte');
const nachZurueck = (await lage()).pfad;

// Geführter Ablauf
await seite.click('button:has-text("Schlüssel anlegen")');
await seite.waitForSelector('.schrittleiste');
l = await lage();
pruefe('C · Anlegen, Schritt 1', l, wegeHeraus(l));
const schrittPfad = l.pfad;

await seite.fill('#name', 'Wegprobe');
await seite.click('button:has-text("Weiter")');
await seite.waitForSelector('.wahlreihe');
l = await lage();
pruefe('D · Anlegen, Verfahren', l, wegeHeraus(l));

await seite.click('.wahlkarte:has-text("Curve25519")');
await seite.click('button:has-text("Weiter")');
await seite.waitForSelector('.vorschlag-woerter');
l = await lage();
pruefe('E · Anlegen, Passphrase', l, wegeHeraus(l));
const woerter = await seite.$$eval('.vw-text', (ns) => ns.map((n) => n.textContent ?? ''));
// So lautet die Passphrase — nach einem Neuladen brauchen wir sie wieder.
const PASSPHRASE = woerter.join('-');

await seite.click('button:has-text("Weiter")');
await seite.waitForSelector('.wortproben');
l = await lage();
pruefe('F · Anlegen, Sichern', l, wegeHeraus(l));

// Die Wortabfrage muss falsche Antworten wirklich zurückweisen.
const proben = await seite.locator('.wortprobe').all();
await proben[0].fill('falschesWort');
const gesperrtBeiFalsch = await seite.isDisabled('button:has-text("Schlüssel jetzt erzeugen")');

const positionen = await seite.$$eval('.wortprobe', (ns) =>
  ns.map((n) => Number((n.getAttribute('aria-label') ?? '').replace(/\D+/g, ''))));
for (let i = 0; i < proben.length; i++) await proben[i].fill(woerter[positionen[i] - 1] ?? '');
const freiBeiRichtig = await seite.isEnabled('button:has-text("Schlüssel jetzt erzeugen")');

await seite.click('button:has-text("Schlüssel jetzt erzeugen")');
await seite.waitForSelector('textarea[aria-label="Widerrufszertifikat"]', { timeout: 60_000 });
l = await lage();
pruefe('G · Anlegen, Widerruf', l, wegeHeraus(l));
const weiterOhneDownload = await seite.isDisabled('.schritt-fuss button:has-text("Weiter")');

await seite.click('button:has-text("Widerrufszertifikat herunterladen")');
await seite.click('.schritt-fuss button:has-text("Weiter")');
await seite.waitForSelector('#backup-pw');
l = await lage();
pruefe('H · Anlegen, Backup', l, [...wegeHeraus(l), ...l.knoepfe.filter((k) => /Ohne Sicherung/.test(k))]);

await seite.click('button:has-text("Ohne Sicherung fortfahren")');
await seite.click('button:has-text("Verstanden")');
await seite.waitForSelector('.fingerprint', { timeout: 20_000 });
l = await lage();
pruefe('I · Schlüssel vorhanden', l, wegeHeraus(l));
const mahntOhneBackup = (await seite.locator('.warnkasten.mahnung').count()) > 0;

// Werkzeug — der Bereich aus Phase 2.
await seite.click('.nav-eintrag:has-text("Werkzeug")');
await seite.waitForSelector('#wz-eingabe');
l = await lage();
pruefe('K · Werkzeug, leer', l, wegeHeraus(l));

await seite.fill('#wz-eingabe', 'Ein Satz zum Verschlüsseln.');
await seite.waitForSelector('.erkannt-marke:has-text("Klartext")', { timeout: 10_000 });
l = await lage();
pruefe('L · Werkzeug, Klartext erkannt', l, wegeHeraus(l));
const bietetVerschluesseln = l.knoepfe.some((k) => /^Verschlüsseln$/.test(k));

await seite.click('button:has-text("Verschlüsseln")');
await seite.waitForSelector('h3:has-text("Verschlüsselt")', { timeout: 30_000 });
await seite.waitForTimeout(600);
l = await lage();
pruefe('M · Werkzeug, Ergebnis', l, wegeHeraus(l));

await seite.click('button:has-text("Ins Eingabefeld übernehmen")');
await seite.waitForSelector('.erkannt-marke:has-text("Verschlüsselt")', { timeout: 10_000 });
l = await lage();
pruefe('N · Werkzeug, Nachricht erkannt', l, wegeHeraus(l));
const bietetEntschluesseln = l.knoepfe.some((k) => /^Entschlüsseln$/.test(k));

// Kontakte — Phase 3.
await seite.click('.nav-eintrag:has-text("Kontakte")');
await seite.waitForSelector('#kontakt-key');
l = await lage();
pruefe('O · Kontakte, leer', l, wegeHeraus(l));

await seite.click('button:has-text("Jemanden einladen")');
await seite.waitForSelector('#einladung-url');
l = await lage();
pruefe('P · Einladung erzeugen', l, wegeHeraus(l));
const einladungsUrl = await seite.inputValue('#einladung-url');

// Die Einladung von der anderen Seite her öffnen — mit demselben Schlüssel,
// damit der Weg vollständig durchlaufen wird.
const fragment = einladungsUrl.slice(einladungsUrl.indexOf('#'));
await seite.goto(`${basis}/e${fragment}`, { waitUntil: 'domcontentloaded' });
await seite.waitForSelector('.woerter', { timeout: 20_000 });
l = await lage();
pruefe('Q · Einladung empfangen', l, wegeHeraus(l));
const einladungZeigtWoerter = (await seite.locator('.wort').count()) === 13;

// ⚠️ Nach dem `goto` ist der Schlüsselbund gesperrt — ein Neuladen verliert
//    den entsperrten Zustand, und genau so soll es sein. Also wieder auf.
await seite.click('.nav-eintrag:has-text("Schlüssel")');
await seite.waitForSelector('#pw', { timeout: 20_000 });
const gesperrtNachNeuladen = true;
await seite.fill('#pw', PASSPHRASE);
await seite.click('button[type=submit]');
await seite.waitForSelector('.fingerprint', { timeout: 30_000 });

// DER Zustand, um den es ging.
await seite.click('.kopf-knoepfe button:has-text("Sperren")');
await seite.waitForSelector('#pw');
l = await lage();
pruefe('J · GESPERRT', l, wegeHeraus(l));
const gesperrtZeigtSchluessel = (await seite.locator('.fingerprint').count()) > 0;
const sperrenImGesperrten = l.knoepfe.includes('Sperren');
const oeffentlichAuchGesperrt = l.knoepfe.some((k) => /Öffentlichen Schlüssel/.test(k));

await browser.close();
server.close();

// ------------------------------------------------------------------ Bericht

const zusatz = [
  ['ein Neuladen sperrt den Schlüsselbund', gesperrtNachNeuladen],
  ['die Einladung trägt die Nutzlast im Fragment', einladungsUrl.includes('/e#') && !einladungsUrl.includes('?')],
  ['die empfangene Einladung zeigt dreizehn Abgleich-Wörter', einladungZeigtWoerter],
  ['Werkzeug bietet bei Klartext das Verschlüsseln an', bietetVerschluesseln],
  ['Werkzeug bietet bei einer Nachricht das Entschlüsseln an', bietetEntschluesseln],
  ['„Sperren" fehlt im leeren Schlüsselbund', !sperrenImLeeren],
  ['„Sperren" fehlt, wenn schon gesperrt', !sperrenImGesperrten],
  ['Browser-Zurück führt aus der Info heraus', infoPfad === '/info' && nachZurueck === '/'],
  ['jeder Schritt hat eine eigene Adresse', /^\/neu\/\d+$/.test(schrittPfad)],
  ['falsches Wort sperrt das Weitergehen', gesperrtBeiFalsch],
  ['richtige Wörter geben es frei', freiBeiRichtig],
  ['ohne Herunterladen kein Weitergehen beim Widerruf', weiterOhneDownload],
  ['ohne Sicherung wird dauerhaft gemahnt', mahntOhneBackup],
  ['gesperrt bleiben die Schlüssel sichtbar', gesperrtZeigtSchluessel],
  ['gesperrt lässt sich der öffentliche Schlüssel weiterhin geben', oeffentlichAuchGesperrt],
  ['keine Seitenfehler', fehler.length === 0],
];

let gut = true;
for (const { name, probleme, wege } of ergebnisse) {
  if (probleme.length === 0) {
    console.log(`  OK   ${name}  (Wege heraus: ${wege.join(', ')})`);
  } else {
    gut = false;
    console.log(`  ROT  ${name}`);
    for (const p of probleme) console.log(`         ${p}`);
  }
}
console.log('');
for (const [was, ok] of zusatz) {
  console.log(`${ok ? '  OK  ' : '  ROT '} ${was}`);
  if (!ok) gut = false;
}
if (fehler.length > 0) for (const f of fehler) console.log(`         ${f}`);
console.log('');
process.exit(gut ? 0 : 1);
