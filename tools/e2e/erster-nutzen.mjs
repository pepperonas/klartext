/**
 * „Erster Nutzen ohne Verpflichtung."
 *
 * Wer hierher kommt, weil eine Freundin ihm einen öffentlichen Schlüssel
 * geschickt hat, soll ihr antworten können — ohne vorher einen eigenen
 * Schlüssel anzulegen. Das war lange verboten, obwohl der Krypto-Kern es
 * konnte; dieser Lauf hält fest, dass es geht und dass es die RICHTIGEN
 * Grenzen behält.
 *
 * ⚠️ Der Block wird mit echtem `gpg` entschlüsselt. Ein Test, der nur prüft,
 *    ob „BEGIN PGP MESSAGE" dasteht, prüft eine Zeichenkette und nicht, ob
 *    jemand die Nachricht auch lesen kann.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const WURZEL = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(WURZEL, 'app', 'dist');
const CSP = /set \$klartext_csp "([^"]+)"/
  .exec(readFileSync(join(WURZEL, 'deploy', 'nginx-klartext.conf'), 'utf8'))?.[1] ?? '';

const TYP = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.md': 'text/plain', '.txt': 'text/plain',
};

let fehler = 0;
const ok = (t) => { console.log(`  OK   ${t}`); };
const nein = (t, warum) => { fehler += 1; console.log(`  FEHL ${t}\n       ${warum}`); };
const pruefe = (t, b, warum) => { if (b) ok(t); else nein(t, warum); };

// -------------------------------------------------- Ein gpg-Schlüssel als Gegenüber
const gnupg = mkdtempSync(join(tmpdir(), 'klartext-gpg-'));
const gpg = (args, eingabe) =>
  spawnSync('gpg', ['--homedir', gnupg, '--batch', '--yes', ...args],
    { input: eingabe, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });

writeFileSync(join(gnupg, 'params'), [
  'Key-Type: eddsa', 'Key-Curve: Ed25519', 'Key-Usage: sign',
  'Subkey-Type: ecdh', 'Subkey-Curve: Curve25519', 'Subkey-Usage: encrypt',
  'Name-Real: Freundin', 'Name-Email: freundin@fixture.invalid',
  '%no-protection', '%commit', '',
].join('\n'));
gpg(['--gen-key', join(gnupg, 'params')]);
const fremderKey = gpg(['--armor', '--export', 'freundin@fixture.invalid']).stdout;
if (!fremderKey.includes('BEGIN PGP PUBLIC KEY BLOCK')) {
  console.log('gpg konnte keinen Schlüssel erzeugen — Lauf abgebrochen.');
  process.exit(1);
}

// ------------------------------------------------------------------- Testserver
const server = createServer((req, res) => {
  const pfad = (req.url ?? '/').split('?')[0];
  let datei = join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  try { readFileSync(datei); } catch { datei = join(DIST, 'index.html'); }
  // ⚠️ Dieselbe CSP wie nginx — sonst fällt ein Trusted-Types-Bruch erst im
  //    Betrieb auf (Hausregel, einmal teuer gelernt).
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Content-Type', TYP[extname(datei)] ?? 'application/octet-stream');
  res.end(readFileSync(datei));
}).listen(0);
const basis = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
// Die Zwischenablage ist hier kein Beiwerk: sie ist der Weg, auf dem der
// Ciphertext die App verlässt (siehe unten).
const kontext = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const seite = await kontext.newPage();
const seitenfehler = [];
seite.on('pageerror', (e) => { seitenfehler.push(e.message.split('\n')[0]); });

const GEHEIM = 'Der Schlüssel liegt unter dem dritten Blumentopf.';

await seite.goto(basis, { waitUntil: 'networkidle' });
await seite.waitForSelector('.nav');

// --------------------------------------------------------------- Der Ablauf
await seite.click('.nav-eintrag:has-text("Werkzeug")');
await seite.waitForSelector('#wz-eingabe', { timeout: 10_000 })
  .catch(() => { nein('das Werkzeug ist ohne Schlüssel erreichbar', 'kein Eingabefeld'); });

pruefe('das Werkzeug steht ohne eigenen Schlüssel offen',
  await seite.locator('#wz-eingabe').count() > 0, 'Eingabefeld fehlt');

pruefe('es sagt, was ohne Schlüssel geht',
  await seite.locator('.hinweiskasten:has-text("sofort loslegen")').count() > 0,
  'Hinweiskasten fehlt');

await seite.fill('#wz-fremd', fremderKey);
await seite.fill('#wz-eingabe', GEHEIM);
await seite.waitForTimeout(600);

pruefe('Verschlüsseln ist freigeschaltet',
  await seite.locator('button:has-text("Verschlüsseln"):not([disabled])').count() > 0,
  'der Knopf ist gesperrt');

// ⚠️ Die Gegenprobe: was einen EIGENEN Schlüssel braucht, muss gesperrt bleiben.
pruefe('Signieren bleibt gesperrt — mit dem richtigen Grund',
  await seite.locator('button:has-text("Signieren")[disabled]').count() > 0
  && (await seite.locator('.knopfreihe:has-text("Verschlüsseln")').innerText()).includes('eigenen Schlüssel'),
  `Beschriftung: ${await seite.locator('.knopfreihe:has-text("Verschlüsseln")').innerText().catch(() => '—')}`);

await seite.click('button:has-text("Verschlüsseln")');
// ⚠️ NICHT über `textContent` des Ergebnisfeldes lesen. Die Zerfalls-Animation
//    setzt Zeilenumbrüche als <br> ins DOM (so dokumentiert in zerfall.ts), und
//    `textContent` liefert sie nicht — der Block käme einzeilig heraus und gpg
//    sagt dazu „no valid OpenPGP data found". Mich hat das einmal gekostet.
//    Richtig ist ohnehin der Weg des Nutzers: der Kopierknopf. Der gibt die
//    Originalzeichenkette aus, und genau die schickt man weiter.
await seite.waitForSelector('.ergebnis', { timeout: 20_000 }).catch(() => undefined);
await seite.click('button:has-text("Ergebnis kopieren")');
await seite.waitForTimeout(300);
const block = await seite.evaluate(() => navigator.clipboard.readText());

pruefe('es kommt ein PGP-Block heraus', block.includes('BEGIN PGP MESSAGE'), block.slice(0, 60));
pruefe('der kopierte Block hat echte Zeilenumbrüche',
  block.split('\n').length > 3, `nur ${String(block.split('\n').length)} Zeilen`);

// ------------------------------------------------- Kann die Freundin es lesen?
const entschluesselt = gpg(['--decrypt'], block);
pruefe('echtes gpg liest die Nachricht im Wortlaut',
  entschluesselt.stdout.trim() === GEHEIM,
  `gpg sagt: ${(entschluesselt.stderr || entschluesselt.stdout).slice(0, 200)}`);

// Und: sie ist NICHT signiert, weil es keinen eigenen Schlüssel gibt.
pruefe('ohne eigenen Schlüssel wird nichts signiert',
  !/Good signature|Signature made/.test(entschluesselt.stderr),
  'gpg meldet eine Signatur, obwohl es keinen eigenen Schlüssel gibt');

// ------------------------------------------------- Eine Nachricht AN UNS geht nicht
await seite.fill('#wz-eingabe', block);
await seite.waitForTimeout(600);
pruefe('Entschlüsseln bleibt ohne eigenen Schlüssel gesperrt',
  await seite.locator('button:has-text("Entschlüsseln")[disabled]').count() > 0,
  'Entschlüsseln war anklickbar');

pruefe('keine Seitenfehler', seitenfehler.length === 0, seitenfehler.join(' | '));

await browser.close();
server.close();
rmSync(gnupg, { recursive: true, force: true });

console.log(fehler === 0 ? '\nErster Nutzen ohne eigenen Schlüssel: geht.' : `\n${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
