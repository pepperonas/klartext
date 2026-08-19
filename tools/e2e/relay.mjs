/**
 * Der Abnahmetest für Modus B: zwei Browser tauschen eine Nachricht über ein
 * ECHTES Relay — gebaut, gestartet, angesprochen.
 *
 * Das ist die einzige Prüfung, die die ganze Kette abdeckt: Postfach ableiten,
 * Besitz nachweisen, verschlüsseln, zustellen, abholen, entschlüsseln,
 * Signatur prüfen. Jede Stufe einzeln zu testen sagt nichts darüber, ob sie
 * zusammenpassen.
 *
 * ⚠️ Zum Schluss wird die Datenbankdatei des Relays gelesen und darauf geprüft,
 *    dass der Klartext dort NICHT steht. Der Zero-Knowledge-Test aus der
 *    Relay-Suite tut das gegen einen Server im selben Prozess — hier gegen
 *    einen, mit dem zwei echte Browser gesprochen haben.
 *
 * Aufruf: node tools/e2e/relay.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const DIST = join(WURZEL, 'app', 'dist');

const GEHEIM = 'RELAY-KLARTEXT-MARKER-9c2f Hallo über den Zustellserver! Grüße.';

// ------------------------------------------------------- Relay hochfahren

const relayVerzeichnis = mkdtempSync(join(tmpdir(), 'klartext-relay-e2e-'));
const relayDb = join(relayVerzeichnis, 'relay.db');
// Freien Port suchen statt einen festen zu nehmen: ein hängengebliebener
// Server aus einem früheren Lauf liess den neuen sonst still scheitern — und
// der Test sprach dann mit dem alten.
const RELAY_PORT = await (async () => {
  const probe = createServer();
  await new Promise((r) => { probe.listen(0, '127.0.0.1', r); });
  const port = probe.address().port;
  await new Promise((r) => { probe.close(r); });
  return port;
})();

const relay = spawn('node', [join(WURZEL, 'relay', 'dist', 'server.js')], {
  env: { ...process.env, KLARTEXT_DB: relayDb, PORT: String(RELAY_PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const relayAusgabe = [];
relay.stdout.on('data', (d) => relayAusgabe.push(String(d)));
relay.stderr.on('data', (d) => relayAusgabe.push(String(d)));

async function warteAufRelay() {
  for (let i = 0; i < 50; i++) {
    try {
      const a = await fetch(`http://127.0.0.1:${String(RELAY_PORT)}/v1/status`);
      if (a.ok) return true;
    } catch { /* noch nicht da */ }
    await new Promise((r) => { setTimeout(r, 200); });
  }
  return false;
}
const relayLaeuft = await warteAufRelay();
if (!relayLaeuft) {
  console.log('  ROT  Das Relay ist nicht hochgekommen.');
  console.log(relayAusgabe.join('').slice(0, 500));
  relay.kill();
  process.exit(1);
}

// Aufräumen, was auch immer passiert — ein hängender Serverprozess sabotiert
// den nächsten Lauf.
for (const signal of ['exit', 'SIGINT', 'SIGTERM', 'uncaughtException']) {
  process.on(signal, () => { relay.kill(); });
}

// ------------------------------------------------------- App ausliefern

const TYPEN = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
/**
 * ⚠️ Der Zustellserver wird unter `/relay/` DESSELBEN Ursprungs durchgereicht —
 *    genau wie nginx es in Produktion tut. Ein eigener Port ginge nicht: die
 *    CSP der App erlaubt `connect-src 'self'`, der Browser liesse die Anfrage
 *    gar nicht erst los. Genau daran ist der erste Anlauf gescheitert.
 */
const server = createServer((req, res) => {
  if ((req.url ?? '').startsWith('/relay/')) {
    const ziel = `http://127.0.0.1:${String(RELAY_PORT)}${(req.url ?? '').slice('/relay'.length)}`;
    const teile = [];
    req.on('data', (d) => teile.push(d));
    req.on('end', () => {
      fetch(ziel, {
        method: req.method,
        headers: Object.fromEntries(
          Object.entries(req.headers).filter(([k]) => ['content-type', 'authorization'].includes(k)),
        ),
        body: ['GET', 'HEAD'].includes(req.method ?? '') ? undefined : Buffer.concat(teile),
      })
        .then(async (a) => {
          res.writeHead(a.status, { 'Content-Type': 'application/json' });
          res.end(await a.text());
        })
        .catch((f) => { res.writeHead(502); res.end(String(f)); });
    });
    return;
  }
  const pfad = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
  const datei = pfad === '/' ? 'index.html' : pfad.replace(/^\/+/, '');
  readFile(join(DIST, datei))
    .then((inhalt) => {
      res.writeHead(200, { 'Content-Type': TYPEN[extname(datei)] ?? 'application/octet-stream' });
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

// ----------------------------------------------------------- Hilfsablauf

const browser = await chromium.launch({ headless: true });
const fehler = [];

/** Legt einen Schlüssel an (Curve25519, selbst gewählte Passphrase). */
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
  await seite.waitForSelector('textarea[aria-label="Widerrufszertifikat"]', { timeout: 60_000 });
  await seite.click('button:has-text("Widerrufszertifikat herunterladen")');
  await seite.click('.schritt-fuss button:has-text("Weiter")');
  await seite.waitForSelector('#backup-pw');
  await seite.click('button:has-text("Ohne Sicherung fortfahren")');
  await seite.click('button:has-text("Verstanden")');
  await seite.waitForSelector('.fingerprint', { timeout: 20_000 });
}

/** Schaltet Modus B ein und trägt die Relay-Adresse ein. */
async function modusBEin(seite) {
  await seite.click('.nav-eintrag:has-text("Einstellungen")');
  await seite.waitForSelector('#relay-url');
  await seite.fill('#relay-url', '/relay');
  await seite.check('#relay-an');
  await seite.waitForSelector('.meldung[data-art=gut]', { timeout: 10_000 });
}

/** Holt den eigenen Einladungslink. */
async function einladungsLink(seite) {
  await seite.click('.nav-eintrag:has-text("Kontakte")');
  await seite.waitForSelector('#kontakt-key');
  await seite.click('button:has-text("Jemanden einladen")');
  await seite.waitForSelector('#einladung-url');
  return await seite.inputValue('#einladung-url');
}

/** Nimmt eine fremde Einladung an. */
async function nimmEinladungAn(seite, url) {
  const fragment = url.slice(url.indexOf('#'));
  await seite.goto(`${basis}/e${fragment}`, { waitUntil: 'domcontentloaded' });
  await seite.waitForSelector('.woerter', { timeout: 20_000 });
  await seite.click('button:has-text("Kontakt aufnehmen")');
  await seite.waitForSelector('.kontakt', { timeout: 20_000 });
}

/**
 * Entsperrt nach einem Neuladen.
 *
 * ⚠️ NICHT auf `.fingerprint` warten: die Schlüsselliste steht seit dem
 *    Benutzbarkeits-Durchgang AUCH im gesperrten Zustand da (öffentliche
 *    Schlüssel sind nicht geheim). Der Selektor trifft also sofort, und der
 *    Test läuft weiter, während der Bund noch zu ist. Die Sperranzeige ist das
 *    verlässliche Signal.
 */
async function entsperre(seite, passphrase) {
  await seite.click('.nav-eintrag:has-text("Schlüssel")');
  // ⚠️ WARTEN, nicht zählen: das Zeichnen der Ansicht ist asynchron, ein
  //    `count()` unmittelbar nach dem Klick liefert null und der Test läuft
  //    stillschweigend am Entsperren vorbei.
  try {
    await seite.waitForSelector('#pw', { timeout: 5_000 });
  } catch {
    return; // schon offen
  }
  await seite.fill('#pw', passphrase);
  await seite.click('button[type=submit]');
  try {
    await seite.waitForSelector('.kerbe[data-zustand=unlocked]', { timeout: 20_000 });
  } catch {
    console.log('ENTSPERRE gescheitert. Meldung:', await seite.textContent('.meldung').catch(()=>null));
    throw new Error('Entsperren misslungen');
  }
}

const ALICE_PW = 'alice-passphrase-lang-genug';
const BOB_PW = 'bob-passphrase-lang-genug';

const alice = await (await browser.newContext()).newPage();
const bob = await (await browser.newContext()).newPage();
for (const [name, seite] of [['Alice', alice], ['Bob', bob]]) {
  seite.on('pageerror', (e) => { fehler.push(`${name}: ${e.message.split('\n')[0]}`); });
}

// ------------------------------------------------------------- Der Ablauf

await legeSchluesselAn(alice, 'Alice', ALICE_PW);
await modusBEin(alice);
const aliceLink = await einladungsLink(alice);

await legeSchluesselAn(bob, 'Bob', BOB_PW);
await modusBEin(bob);
const bobLink = await einladungsLink(bob);

// Gegenseitig aufnehmen (ein Neuladen sperrt — also danach entsperren).
await nimmEinladungAn(alice, bobLink);
await entsperre(alice, ALICE_PW);
await nimmEinladungAn(bob, aliceLink);
await entsperre(bob, BOB_PW);

// Bob richtet sein Postfach ein und wartet.
await bob.click('.nav-eintrag:has-text("Kontakte")');
await bob.waitForSelector('.kontakt');
await bob.click('.kontakt button:has-text("Schreiben")');
try {
  await bob.waitForSelector('#gespraech-text', { timeout: 20_000 });
} catch {
  const lage = await bob.evaluate(() => ({
    pfad: location.pathname,
    ueberschriften: [...document.querySelectorAll('h1,h2,h3')].map((n) => n.textContent?.trim()),
    kerbe: document.querySelector('.kerbe')?.textContent?.trim(),
  }));
  console.log('BOB steckt fest:', JSON.stringify(lage));
  throw new Error('Gesprächsansicht öffnete nicht');
}
const bobRichtetEin = await bob.locator('button:has-text("Postfach einrichten")').count() > 0;
if (bobRichtetEin) {
  await bob.click('button:has-text("Postfach einrichten")');
  try {
    await bob.waitForSelector('.pille.gut:has-text("Modus B")', { timeout: 20_000 });
  } catch {
    console.log('POSTFACH-Meldung:', await bob.textContent('.meldung').catch(()=>null));
    console.log('Relay sagt:', relayAusgabe.join('').slice(0,300));
    throw new Error('Postfach nicht eingerichtet');
  }
}
const bobModusB = await bob.locator('.pille.gut:has-text("Modus B")').count() > 0;

// Alice schreibt.
await alice.click('.nav-eintrag:has-text("Kontakte")');
await alice.waitForSelector('.kontakt');
await alice.click('.kontakt button:has-text("Schreiben")');
await alice.waitForSelector('#gespraech-text', { timeout: 20_000 });
if (await alice.locator('button:has-text("Postfach einrichten")').count() > 0) {
  await alice.click('button:has-text("Postfach einrichten")');
  await alice.waitForSelector('.pille.gut:has-text("Modus B")', { timeout: 20_000 });
}
await alice.fill('#gespraech-text', GEHEIM);
await alice.click('button:has-text("Verschlüsseln und senden")');
// ⚠️ Auf DIESE Meldung warten, nicht auf irgendeine grüne: die vorherige
//    („Postfach eingerichtet") steht noch da und der Selektor träfe sie sofort.
await alice.waitForSelector('.meldung[data-art=gut]:has-text("Zugestellt")', { timeout: 30_000 })
  .catch(() => undefined);
const zustellMeldung = (await alice.textContent('.meldung[data-art=gut]')) ?? '';

// Bob holt ab (die Langabfrage sollte ihn ohnehin wecken).
await bob.waitForSelector('.blase.fremd', { timeout: 40_000 }).catch(() => undefined);
const bobHatText = (await bob.locator('.blase.fremd .blase-text').first().textContent().catch(() => null)) ?? '';
const bobSignatur = await bob.locator('.blase.fremd .pille.gut:has-text("signiert")').count();

// Sieht das Relay den Klartext? Die Datei ist jetzt beschrieben.
const rohDatei = readFileSync(relayDb, 'latin1');

await browser.close();
server.close();
relay.kill();

// ------------------------------------------------------------------ Bericht

const pruefungen = [
  ['das gebaute Relay startet und antwortet', relayLaeuft],
  ['Bob richtet sein Postfach per Besitznachweis ein', bobModusB],
  ['Alice bekommt eine Zustellbestätigung', /zugestellt/i.test(zustellMeldung)],
  ['Bob empfängt den Text unverändert', bobHatText.trim() === GEHEIM],
  ['Bob sieht die Signatur als gültig', bobSignatur > 0],
  ['die Relay-Datenbank enthält KEINEN Klartext', !rohDatei.includes('RELAY-KLARTEXT-MARKER')],
  ['die Relay-Datenbank enthält keinen Namen', !rohDatei.includes('Alice') && !rohDatei.includes('Bob')],
  ['keine Seitenfehler in beiden Browsern', fehler.length === 0],
];

let gut = true;
for (const [was, ok] of pruefungen) {
  console.log(`${ok ? '  OK  ' : '  ROT '} ${was}`);
  if (!ok) gut = false;
}
if (fehler.length > 0) { console.log('\nSeitenfehler:'); for (const f of fehler) console.log(`   ${f}`); }
if (!gut) {
  console.log(`\nZustellmeldung : ${zustellMeldung.slice(0, 90)}`);
  console.log(`Bob las        : ${bobHatText.slice(0, 90)}`);
  console.log(`Relay-Ausgabe  : ${relayAusgabe.join('').slice(0, 300)}`);
}
rmSync(relayVerzeichnis, { recursive: true, force: true });
console.log('');
process.exit(gut ? 0 : 1);
