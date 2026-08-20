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

/**
 * Fortschritt mit `SCHRITTE=1 npm run relay`.
 *
 * ⚠️ Fest eingebaut, nicht weggeworfen: bei zwei Browsern und einem echten
 *    Server ist die Frage „wo hängt es?" die häufigste, und sie ohne Ausgabe zu
 *    beantworten kostet jedes Mal eine halbe Stunde. Ich habe es einmal ohne
 *    versucht.
 */
const T0 = Date.now();
const schritt = (was) => {
  if (process.env['SCHRITTE'] === '1') console.log(`  · ${was} (+${String(Date.now() - T0)}ms)`);
};

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
  // ⚠️ Der Assistent endet seit dem Benutzbarkeits-Durchgang beim erzeugten
  //    Schlüssel. Widerrufszertifikat und Sicherung sind Aufgaben auf der
  //    Schlüsselseite geworden — hier ist danach nichts mehr zu klicken.
  await seite.waitForSelector('.fingerprint', { timeout: 90_000 });
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

  // ⚠️ Danach kommt nicht mehr die Liste, sondern der Abschluss-Schirm: eine
  //    Einladung trägt nur den Schlüssel des Absenders. Mit Modus B merkt die
  //    App die eigene Vorstellung vor („Zu den Kontakten"), ohne bleibt der
  //    Weg von Hand („Später").
  //
  // ⚠️ ERST WARTEN, dann fragen. Ein `count()` unmittelbar nach dem Klick
  //    liefert 0, weil das Zeichnen asynchron ist — der Lauf klickte dann auf
  //    „Später", das es in diesem Zweig nie gibt, und hing für immer. Dieselbe
  //    Falle steht schon anderswo in dieser Datei; ich bin trotzdem
  //    hineingelaufen.
  await seite.waitForSelector(
    'button:has-text("Zu den Kontakten"), button:has-text("Später")',
    { timeout: 30_000 });
  const zurueckgeschickt =
    await seite.locator('button:has-text("Zu den Kontakten")').count() > 0;
  await seite.click(zurueckgeschickt
    ? 'button:has-text("Zu den Kontakten")'
    : 'button:has-text("Später")');
  await seite.waitForSelector('.kontakt', { timeout: 20_000 });
  return zurueckgeschickt;
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

schritt('legeSchluesselAn'); await legeSchluesselAn(alice, 'Alice', ALICE_PW);
schritt('modusBEin'); await modusBEin(alice);
schritt('einladungsLink'); const aliceLink = await einladungsLink(alice);

schritt('legeSchluesselAn'); await legeSchluesselAn(bob, 'Bob', BOB_PW);
schritt('modusBEin'); await modusBEin(bob);

// ⚠️ Nur EINE Richtung von Hand: Bob nimmt Alices Einladung an. Ob Alice
//    danach Bob sieht, OHNE selbst etwas zu tun, ist genau die Frage —
//    gemeldet als „der neue Kontakt sieht mich, aber ich sehe ihn nicht".
schritt('nimmEinladungAn'); await nimmEinladungAn(bob, aliceLink);
// ⚠️ Entsperren ist hier kein Beiwerk: der Einladungslink lädt die Seite neu,
//    danach ist Bobs Bund zu — und eine Vorstellung muss signiert werden. Sie
//    wurde also nur vorgemerkt; erst jetzt kann der Wächter sie verschicken.
schritt('entsperre'); await entsperre(bob, BOB_PW);

// Alice tut NICHTS ausser dazusitzen: der Postfachwächter holt von selbst ab.
// (Vorher lief das Abholen nur in einem offenen Gespräch — ohne Kontakt hatte
// sie keines und hätte ewig gewartet.)
schritt('Alice wartet auf die Vorstellung');
await alice.click('.nav-eintrag:has-text("Kontakte")');
const aliceSiehtVorstellung = await alice
  .waitForSelector('.vorstellung', { timeout: 60_000 })
  .then(() => true)
  .catch(() => false);
const aliceSiehtZaehler = await alice.locator('.nav-zaehler').count() > 0;
const vorstellungNennt = aliceSiehtVorstellung
  ? await alice.locator('.vorstellung').first().innerText()
  : '';

// Erst jetzt aufnehmen — sie soll nicht von selbst im Adressbuch landen.
const vorherKontakte = await alice.locator('.kontakt').count();
if (aliceSiehtVorstellung) {
  await alice.click('.vorstellung button:has-text("Aufnehmen")');
  await alice.waitForSelector('.kontakt', { timeout: 20_000 });
}
const nachherKontakte = await alice.locator('.kontakt').count();

schritt('Bob öffnet das Gespräch');
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

schritt('Alice schreibt');
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

schritt('Bob wartet auf den Text');
// Bob holt ab (die Langabfrage sollte ihn ohnehin wecken).
await bob.waitForSelector('.blase.fremd', { timeout: 40_000 }).catch(() => undefined);
const bobHatText = (await bob.locator('.blase.fremd .blase-text').first().textContent().catch(() => null)) ?? '';
const bobSignatur = await bob.locator('.blase.fremd .pille.gut:has-text("signiert")').count();

// Sieht das Relay den Klartext? Die Datei ist jetzt beschrieben.
const rohDatei = readFileSync(relayDb, 'latin1');

schritt('aufräumen');
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
  ['Alice sieht von selbst, dass Bob angenommen hat', aliceSiehtVorstellung],
  ['die Vorstellung nennt Bobs Namen', /Bob/.test(vorstellungNennt)],
  ['die Vorstellung zeigt einen Fingerprint zum Abgleich', /[0-9A-F]{4} [0-9A-F]{4}/.test(vorstellungNennt)],
  ['sie wird NICHT von selbst zum Kontakt', vorherKontakte === 0],
  ['ein Tipp genügt, dann ist sie es', nachherKontakte === 1],
  ['die Leiste zeigt, dass etwas wartet', aliceSiehtZaehler],
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
