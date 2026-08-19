/**
 * Verträge, die über Dateigrenzen hinweg gelten.
 *
 * Jede dieser Zusicherungen hat einen Anlass in der Geschichte dieses Repos —
 * es sind die Stellen, an denen ein stiller Rückschritt teuer wäre und an denen
 * ein gewöhnlicher Unit-Test nicht hinreicht, weil die Sache zwischen zwei
 * Dateien liegt.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const SRC = join(HIER, '..', 'src');

function lies(...teile: string[]): string {
  return readFileSync(join(...teile), 'utf8');
}
/** Ohne Kommentare — die Doku zitiert die verbotenen Dinge absichtlich. */
function pur(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
function alleTs(verzeichnis: string): string[] {
  const raus: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, eintrag);
    if (statSync(pfad).isDirectory()) raus.push(...alleTs(pfad));
    else if (eintrag.endsWith('.ts')) raus.push(pfad);
  }
  return raus;
}

describe('Content-Security-Policy', () => {
  const nginx = lies(WURZEL, 'deploy', 'nginx-klartext.conf');
  const e2e = lies(WURZEL, 'tools', 'e2e', 'nichts-verlaesst-den-browser.mjs');
  const offline = lies(WURZEL, 'tools', 'e2e', 'offline.mjs');

  const direktiven = [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "require-trusted-types-for 'script'",
  ];

  it.each(direktiven)('nginx sendet %s', (direktive) => {
    expect(nginx).toContain(direktive);
  });

  it.each(direktiven)('der Datenabfluss-Test sendet dieselbe Direktive: %s', (direktive) => {
    // ⚠️ Weicht der Testserver von nginx ab, prüft er eine Umgebung, die es
    //    nicht gibt. Genau so blieb unbemerkt, dass Trusted Types die
    //    Anmeldung des Service Workers blockiert.
    expect(e2e).toContain(direktive);
  });

  it.each(direktiven)('der Offline-Test sendet dieselbe Direktive: %s', (direktive) => {
    expect(offline).toContain(direktive);
  });

  it('erlaubt genau die eine Trusted-Types-Richtlinie, die die App anlegt', () => {
    const { POLICY_NAME } = { POLICY_NAME: 'klartext-worker' };
    expect(lies(SRC, 'trusted.ts')).toContain(`'${POLICY_NAME}'`);
    expect(nginx).toContain(`trusted-types ${POLICY_NAME}`);
    expect(e2e).toContain(`trusted-types ${POLICY_NAME}`);
    expect(offline).toContain(`trusted-types ${POLICY_NAME}`);
  });

  it('gibt genau die Kamera frei — und sonst nichts', () => {
    // Seit Phase 3 wird sie zum Abscannen des Fingerprints gebraucht. Alles
    // andere bleibt zu; eine Freigabe ohne Nutzung wäre unnötige Angriffsfläche.
    expect(nginx).toMatch(/Permissions-Policy\s+"camera=\(self\)/);
    for (const recht of ['microphone', 'geolocation', 'payment', 'usb', 'bluetooth']) {
      expect(nginx, recht).toMatch(new RegExp(`${recht}=\\(\\)`));
    }
    const benutztKamera = alleTs(SRC).some((d) => /getUserMedia/.test(pur(lies(d))));
    expect(benutztKamera).toBe(true);
  });

  it('schaltet die Kamera ausdrücklich wieder ab', () => {
    // ⚠️ Ein weiterlaufender Kamerastrom hinter einer verlassenen Ansicht wäre
    //    unentschuldbar — und man sieht ihn der App nicht an.
    const scanner = pur(lies(SRC, 'ui', 'components', 'scanner.ts'));
    expect(scanner).toMatch(/getTracks\(\)/);
    expect(scanner).toMatch(/\.stop\(\)/);
    expect(pur(lies(SRC, 'main.ts'))).toMatch(/kontakte\.verlasse\(\)/);
  });

  it('wiederholt die Header im index.html-Block', () => {
    // ⚠️ Ein add_header in einem location-Block wirft ALLE geerbten Header weg,
    //    und try_files leitet intern genau dorthin um. Ohne Wiederholung führe
    //    ausgerechnet die Startseite ohne CSP aus.
    const block = nginx.slice(nginx.indexOf('location = /index.html'));
    expect(block).toContain('Content-Security-Policy');
    expect(block).toContain('Strict-Transport-Security');
    expect(block).toContain('Referrer-Policy');
  });
});

describe('Trennung von Main-Thread und Krypto', () => {
  it('openpgp wird ausschließlich unter worker/ importiert', () => {
    const suender = alleTs(SRC)
      .filter((d) => /from\s*['"]openpgp['"]/.test(pur(lies(d))))
      .filter((d) => !relative(SRC, d).startsWith('worker'));
    expect(suender).toEqual([]);
  });

  it('der Vertrag kennt openpgp nicht einmal als Typ', () => {
    expect(pur(lies(SRC, 'crypto', 'protocol.ts'))).not.toMatch(/openpgp/);
  });

  it('jede Operation des Vertrags wird im Worker behandelt', () => {
    // Der `never`-Zweig im Worker erzwingt das beim Bauen; hier steht es
    // zusätzlich als lesbare Zusicherung.
    const vertrag = lies(SRC, 'crypto', 'protocol.ts');
    const worker = lies(SRC, 'worker', 'index.ts');
    const ops = [...vertrag.matchAll(/^\s*'([a-z]+\.[a-zA-Z]+)':\s*\{/gm)].map((m) => m[1] ?? '');
    expect(ops.length).toBeGreaterThan(15);
    for (const op of ops) expect(worker, op).toContain(`case '${op}'`);
  });

  it('der Worker reicht keine Bibliotheksmeldung nach draußen', () => {
    const worker = pur(lies(SRC, 'worker', 'index.ts'));
    expect(worker).toContain('toWire(fehler)');
    expect(worker).not.toMatch(/error:\s*\{[^}]*message:\s*(fehler|error)\b/);
  });
});

describe('Keine stillen Kanäle', () => {
  it('das Netz wird an GENAU EINER Stelle angesprochen', () => {
    // Seit Phase 4 gibt es Modus B — und damit einen Ort, der fetch benutzt.
    // Der Wächter wird dadurch nicht schwächer, sondern schärfer: es ist
    // ausgerechnet EINE Datei, und sie heisst so, dass man sie findet.
    const suender: string[] = [];
    for (const datei of alleTs(SRC)) {
      const p = pur(lies(datei));
      if (/\bfetch\s*\(|XMLHttpRequest|new WebSocket|EventSource|sendBeacon/.test(p)) {
        suender.push(relative(SRC, datei).split('\\').join('/'));
      }
    }
    expect(suender).toEqual(['relay/client.ts']);
  });

  it('der Relay-Client verschickt nur, was ihm gereicht wird', () => {
    // ⚠️ Die erste Fassung suchte nach dem Wort „klartext" als Ersatz für
    //    „Klartext" — im Deutschen ist das Wort für unverschlüsselten Text
    //    aber dasselbe wie der Name der App. Die Prüfung war damit
    //    bedeutungslos und schlug beim ersten Satz an, der die App erwähnt.
    //
    //    Aussagekräftig ist stattdessen: der Client kennt keine Kryptografie,
    //    kein Schlüsselmaterial und keine Passphrase. Er reicht durch.
    const client = pur(lies(SRC, 'relay', 'client.ts'));
    expect(client).not.toMatch(/openpgp/);
    expect(client).not.toMatch(/\bpassphrase\b/i);
    expect(client).not.toMatch(/privat(er|e)?[A-Za-z]*Schluessel|PrivateKey/);
    // Alles, was in einen Rumpf geschrieben wird, kommt aus einem Parameter.
    for (const treffer of client.matchAll(/JSON\.stringify\(\{([^}]*)\}\)/g)) {
      const felder = (treffer[1] ?? '').split(',').map((f) => f.trim()).filter(Boolean);
      for (const feld of felder) {
        expect(['blob', 'kennung', 'schluessel', 'nonce', 'signatur', 'ids'], feld).toContain(feld);
      }
    }
  });

  it('der Relay-Client gibt nichts preis, was er nicht muss', () => {
    const client = pur(lies(SRC, 'relay', 'client.ts'));
    expect(client).toMatch(/credentials: 'omit'/);
    expect(client).toMatch(/referrerPolicy: 'no-referrer'/);
    expect(client).toMatch(/cache: 'no-store'/);
  });

  it('spricht ausschliesslich die eigene Herkunft an', () => {
    // Die CSP erlaubt `connect-src 'self'`. Der Client prüft das zusätzlich
    // selbst, damit in den Einstellungen nichts landet, das nie geht.
    const client = pur(lies(SRC, 'relay', 'client.ts'));
    expect(client).toMatch(/pruefeHerkunft/);
    expect(client).toMatch(/url\.origin !== new URL\(eigeneHerkunft\)\.origin/);
    expect(lies(WURZEL, 'deploy', 'nginx-klartext.conf')).toMatch(/location \/relay\//);
  });

  it('App und Relay leiten die Postfach-Kennung gleich ab', () => {
    // ⚠️ Weichen die Präfixe voneinander ab, schreibt ein Absender in ein
    //    Postfach, das der Empfänger nie abfragt — und niemand bekommt eine
    //    Fehlermeldung. Das fiele erst im Betrieb auf.
    const appSeite = lies(SRC, 'relay', 'kennung.ts');
    const relaySeite = lies(WURZEL, 'relay', 'src', 'postfach.ts');
    for (const konstante of ['klartext-mailbox-v1|', 'klartext-relay-auth:v1:']) {
      expect(appSeite, konstante).toContain(konstante);
      expect(relaySeite, konstante).toContain(konstante);
    }
  });

  it('kein Analyse-Werkzeug, keine Telemetrie', () => {
    // ⚠️ Mit WORTGRENZEN. Die erste Fassung suchte Teilzeichenketten und schlug
    //    auf `gueltigTage` an — kleingeschrieben steckt darin „gtag". Ein
    //    Wächter, der Fehlalarme schlägt, wird irgendwann abgeschaltet, und
    //    dann bewacht er nichts mehr.
    const alles = alleTs(SRC).map((d) => pur(lies(d))).join('\n');
    for (const wort of ['analytics', 'gtag', 'sentry', 'umami', 'plausible', 'matomo', 'mixpanel']) {
      expect(alles, wort).not.toMatch(new RegExp(`\\b${wort}\\b`, 'i'));
    }
  });

  it('der nginx-vhost lädt kein Umami — und sagt, dass das Absicht ist', () => {
    const nginx = lies(WURZEL, 'deploy', 'nginx-klartext.conf');
    expect(nginx).not.toMatch(/sub_filter\s+'<\/head>'/);
    expect(nginx).toMatch(/Umami/);
  });
});

describe('Abhängigkeiten', () => {
  const paket = JSON.parse(lies(HIER, '..', 'package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it('hat genau EINE Laufzeit-Abhängigkeit', () => {
    expect(Object.keys(paket.dependencies ?? {})).toEqual(['openpgp']);
  });

  it('pinnt alle Versionen genau — für den reproduzierbaren Build', () => {
    const alle = { ...paket.dependencies, ...paket.devDependencies };
    for (const [name, wert] of Object.entries(alle)) {
      expect(wert, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe('Wortlaut', () => {
  const VERBOTEN = [
    /militärisch/i, /military[- ]grade/i, /100\s*%\s*sicher/i, /unknackbar/i,
    /absolut sicher/i, /bankensicher/i, /unhackbar/i, /vollkommen anonym/i,
    /garantiert sicher/i, /völlig sicher/i,
  ];

  /**
   * ⚠️ Erwähnen ist nicht Behaupten. Der Info-Screen sagt ausdrücklich
   *    `Kein „militärisch", kein „100 % sicher"` — das IST die Regel, nicht ihr
   *    Bruch. Deutsche Anführungszeichen markieren in diesem Projekt ein Zitat,
   *    deshalb wird ihr Inhalt vor der Prüfung entfernt. Der Mutationstest
   *    darunter hält fest, dass die Suche trotzdem beißt.
   */
  function ohneZitate(text: string): string {
    return text.replace(/„[^""]*"/g, '');
  }

  it('kein Marketing-Superlativ im gesamten Anwendungscode', () => {
    // „Klartext reden" ist der Markenkern, nicht nur der Name.
    const treffer: string[] = [];
    for (const datei of alleTs(SRC)) {
      const p = ohneZitate(pur(lies(datei)));
      for (const muster of VERBOTEN) {
        if (muster.test(p)) treffer.push(`${relative(SRC, datei)}: ${muster.source}`);
      }
    }
    expect(treffer).toEqual([]);
  });

  it('die Suche beißt auch nach der Zitat-Ausnahme noch', () => {
    // Ohne diese Gegenprobe wäre die Ausnahme oben ein Freifahrtschein.
    const behauptung = 'Diese App bietet militärische Verschlüsselung und ist 100 % sicher.';
    const gefunden = VERBOTEN.filter((m) => m.test(ohneZitate(behauptung)));
    expect(gefunden.length).toBeGreaterThanOrEqual(2);
  });

  it('der Info-Screen nennt jede nummerierte Grenze aus dem Threat-Model', () => {
    // ⚠️ Vorher stand hier die feste Zahl 8. Eine getippte Zahl ist keine
    //    Verknüpfung: sie sagt nur, dass sich die App nicht geändert hat, nicht
    //    dass sie zum Dokument passt. Jetzt kommt die Erwartung aus dem
    //    Dokument selbst — wer dort einen Punkt ergänzt, wird an die App
    //    erinnert, und umgekehrt.
    const info = lies(SRC, 'ui', 'views', 'info.ts');
    const modell = lies(WURZEL, 'THREAT-MODEL.md');
    const abschnitte = (modell.match(/^## \d+\. /gm) ?? []).length;
    const eintraege = (info.match(/^\s*titel:/gm) ?? []).length;
    expect(abschnitte).toBeGreaterThanOrEqual(8);
    expect(eintraege, 'Info-Screen und THREAT-MODEL zählen verschieden')
      .toBe(abschnitte);
  });

  it('THREAT-MODEL.md und Info-Screen behandeln dieselben Themen', () => {
    const modell = lies(WURZEL, 'THREAT-MODEL.md');
    for (const thema of [
      'Forward Secrecy', 'Metadaten', 'Browser', 'Speicher', 'SHA-1',
      'unverifizierter Kontakt', 'Passphrase',
    ]) {
      expect(modell, thema).toContain(thema.split(' ')[0] ?? thema);
    }
  });

  it('jede Grenze aus dem Info-Screen steht auch im THREAT-MODEL', () => {
    // ⚠️ Die erste Fassung prüfte nur, ob ein paar Stichwörter im Dokument
    //    vorkommen. Das ließ die beiden Seiten auseinanderlaufen: im
    //    Info-Screen stand noch „kommt in Phase 4", als Phase 4 längst lief.
    //    Jetzt wird jeder Titel der App im Dokument gesucht — an seinen
    //    tragenden Wörtern, damit eine Umformulierung nicht sofort rot wird,
    //    ein *neuer* Punkt ohne Gegenstück aber schon.
    const modell = lies(WURZEL, 'THREAT-MODEL.md').toLowerCase();
    const info = lies(SRC, 'ui', 'views', 'info.ts');
    const titel = [...info.matchAll(/titel: '([^']+)'/g)].map((t) => t[1] ?? '');
    expect(titel.length).toBeGreaterThanOrEqual(8);

    for (const t of titel) {
      const tragend = t
        .toLowerCase()
        .split(/[^a-zäöüß0-9-]+/)
        .filter((w) => w.length > 5);
      const gefunden = tragend.filter((w) => modell.includes(w));
      expect(gefunden.length, `„${t}" hat kein Gegenstück im THREAT-MODEL`)
        .toBeGreaterThanOrEqual(Math.max(1, Math.ceil(tragend.length / 2)));
    }
  });

  it('der Info-Screen verspricht nichts fuer spaeter', () => {
    // Ein Hinweis auf eine kommende Phase ist ab dem Tag falsch, an dem sie
    // fertig ist — und niemand liest den Info-Screen danach noch einmal.
    const info = lies(SRC, 'ui', 'views', 'info.ts');
    expect(info).not.toMatch(/kommt in Phase|folgt in Phase|ab Phase|demn(ae|ä)chst/i);
  });
});
