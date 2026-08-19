/**
 * Prüft die Kopfzeilen, die der ECHTE Server schickt.
 *
 * `tests/vertrag.test.ts` vergleicht bereits die CSP an drei Stellen im Repo
 * (nginx, beide Testserver) Direktive für Direktive. Das ist die halbe Miete:
 * es hält die Quellen deckungsgleich, sagt aber nichts darüber, ob der Server
 * die Datei auch tatsächlich anwendet. Genau da ist schon einmal etwas
 * durchgerutscht — eine kopierte vhost-Datei hat TLS abgeräumt, und `nginx -t`
 * war zufrieden, weil die Datei syntaktisch tadellos war.
 *
 * Also: gegen die laufende Seite messen.
 *
 *   node tools/e2e/kopfzeilen.mjs                     (klartext.celox.io)
 *   node tools/e2e/kopfzeilen.mjs http://localhost:…  (eigener Stand)
 */

const ZIEL = process.argv[2] ?? 'https://klartext.celox.io';

let fehler = 0;
const ok = (t) => console.log(`  OK   ${t}`);
const nein = (t, warum) => { fehler += 1; console.log(`  FEHL ${t}\n       ${warum}`); };

function pruefe(name, bedingung, warum) {
  if (bedingung) ok(name); else nein(name, warum);
}

const antwort = await fetch(`${ZIEL}/`, { redirect: 'follow' });
const k = (name) => antwort.headers.get(name) ?? '';

pruefe('die Seite antwortet', antwort.ok, `HTTP ${antwort.status}`);

// ------------------------------------------------------------------------ CSP
const csp = k('content-security-policy');
const erwartet = {
  "default-src": "'none'",
  "script-src": "'self' 'wasm-unsafe-eval'",
  "connect-src": "'self'",
  "object-src": "'none'",
  "base-uri": "'none'",
  "frame-ancestors": "'none'",
  "form-action": "'none'",
  "trusted-types": 'klartext-worker',
};
const teile = new Map(
  csp.split(';').map((t) => t.trim()).filter(Boolean)
    .map((t) => [t.split(/\s+/)[0] ?? '', t.split(/\s+/).slice(1).join(' ')]),
);
for (const [direktive, wert] of Object.entries(erwartet)) {
  pruefe(`CSP ${direktive}`, teile.get(direktive) === wert,
    `erwartet „${wert}", bekommen „${teile.get(direktive) ?? '(fehlt)'}"`);
}
pruefe("CSP verlangt Trusted Types", csp.includes("require-trusted-types-for 'script'"),
  'require-trusted-types-for fehlt');
// ⚠️ Diese beiden sind der Grund, warum die CSP hier ueberhaupt streng ist.
pruefe('CSP erlaubt kein unsafe-inline', !/unsafe-inline/.test(csp), csp);
pruefe('CSP erlaubt kein unsafe-eval ausser fuer WASM',
  !/(^|[^-])'unsafe-eval'/.test(csp), csp);

// -------------------------------------------------------------------- Der Rest
pruefe('HSTS mit mindestens einem Jahr',
  /max-age=(\d+)/.test(k('strict-transport-security')) &&
  Number(/max-age=(\d+)/.exec(k('strict-transport-security'))?.[1]) >= 31_536_000,
  k('strict-transport-security') || '(fehlt)');
pruefe('Referrer-Policy: no-referrer', k('referrer-policy') === 'no-referrer',
  k('referrer-policy') || '(fehlt)');
pruefe('X-Content-Type-Options: nosniff', k('x-content-type-options') === 'nosniff',
  k('x-content-type-options') || '(fehlt)');
pruefe('Permissions-Policy schaltet Mikrofon und Ort ab',
  /microphone=\(\)/.test(k('permissions-policy')) && /geolocation=\(\)/.test(k('permissions-policy')),
  k('permissions-policy') || '(fehlt)');
pruefe('die Kamera bleibt erlaubt (QR-Scan)', /camera=\(self\)/.test(k('permissions-policy')),
  k('permissions-policy') || '(fehlt)');
pruefe('Cross-Origin-Opener-Policy: same-origin', k('cross-origin-opener-policy') === 'same-origin',
  k('cross-origin-opener-policy') || '(fehlt)');

// ⚠️ index.html darf NICHT dauerhaft zwischengespeichert werden: eine
//    ausgelieferte Korrektur an einer Krypto-App muss ankommen.
pruefe('index.html wird nicht dauerhaft gecacht',
  /no-cache|no-store|max-age=0/.test(k('cache-control')), k('cache-control') || '(fehlt)');

// ------------------------------------------------------------------ Der Inhalt
const html = await antwort.text();
pruefe('die Seite traegt eine Baukennung', /name="klartext-build" content="sha256-/.test(html),
  'meta klartext-build fehlt');
pruefe('Skript und Stil tragen integrity',
  (html.match(/integrity="sha256-/g) ?? []).length >= 2,
  `${(html.match(/integrity="sha256-/g) ?? []).length}× gefunden`);
pruefe('kein Inline-Skript', !/<script(?![^>]*\bsrc=)[^>]*>[^<]/.test(html),
  'ein Inline-Skript wuerde an der CSP scheitern');
pruefe('nichts wird von fremden Servern geladen',
  !/(src|href)="https?:\/\/(?!klartext\.celox\.io)/.test(html), 'fremder Verweis im Markup');

// ------------------------------------------------------ Stimmt der Hash wirklich?
const bau = await fetch(`${ZIEL}/build.json`);
// ⚠️ `bau.ok` allein genuegt hier NICHT: der vhost hat einen SPA-Rueckfall auf
//    index.html, also antwortet er auch auf eine fehlende Datei mit HTTP 200
//    und einer HTML-Seite. Beim ersten Lauf hat genau das den Test in ein
//    JSON.parse laufen lassen — und haette bei einer schlampigeren Fassung
//    schlicht „abrufbar" gemeldet, ohne dass die Datei existiert.
const istJson = (bau.headers.get('content-type') ?? '').includes('application/json');
if (!bau.ok || !istJson) {
  nein('build.json ist abrufbar', bau.ok
    ? `HTTP 200, aber content-type „${bau.headers.get('content-type') ?? '(keiner)'}" — vermutlich der SPA-Rueckfall`
    : `HTTP ${bau.status}`);
} else {
  ok('build.json ist abrufbar');
  const { hash, dateien } = await bau.json();
  const imMarkup = /name="klartext-build" content="([^"]+)"/.exec(html)?.[1];
  pruefe('die angezeigte Kennung entspricht build.json', hash === imMarkup,
    `Markup ${imMarkup}, build.json ${hash}`);

  // Eine Stichprobe wirklich nachrechnen — sonst prueft man nur, dass zwei
  // Zahlen zueinander passen, nicht dass sie zu den Dateien passen.
  const { createHash } = await import('node:crypto');
  const name = Object.keys(dateien).find((n) => n.endsWith('.js')) ?? '';
  const datei = await fetch(`${ZIEL}/${name}`);
  const bytes = Buffer.from(await datei.arrayBuffer());
  const echt = `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
  pruefe(`${name} entspricht seinem Eintrag`, echt === dateien[name],
    `gerechnet ${echt}, eingetragen ${dateien[name]}`);
}

console.log(fehler === 0 ? `\nAlle Kopfzeilen und Baukennungen von ${ZIEL} in Ordnung.` : `\n${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
