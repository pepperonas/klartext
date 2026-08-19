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

  it('gibt die Kamera nicht frei, solange nichts sie benutzt', () => {
    // Phase 3 bringt das Abscannen von QR-Codes — DANN muss hier (self) stehen.
    // Bis dahin ist die engste Einstellung die richtige.
    expect(nginx).toMatch(/Permissions-Policy[^;]*camera=\(\)/);
    const benutztKamera = alleTs(SRC).some((d) => /getUserMedia|BarcodeDetector/.test(pur(lies(d))));
    expect(benutztKamera).toBe(false);
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
  it('kein fetch, kein XMLHttpRequest, kein WebSocket im Quelltext', () => {
    // klartext spricht mit niemandem. Modus B (Phase 4) bekommt dafür einen
    // eigenen, klar benannten Ort — bis dahin darf hier nichts stehen.
    const suender: string[] = [];
    for (const datei of alleTs(SRC)) {
      const p = pur(lies(datei));
      if (/\bfetch\s*\(|XMLHttpRequest|new WebSocket|EventSource|sendBeacon/.test(p)) {
        suender.push(relative(SRC, datei));
      }
    }
    expect(suender).toEqual([]);
  });

  it('kein Analyse-Werkzeug, keine Telemetrie', () => {
    const alles = alleTs(SRC).map((d) => pur(lies(d))).join('\n');
    for (const wort of ['analytics', 'gtag', 'sentry', 'umami', 'plausible', 'matomo']) {
      expect(alles.toLowerCase()).not.toContain(wort);
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

  it('der Info-Screen nennt alle acht Grenzen aus dem Threat-Model', () => {
    const info = lies(SRC, 'ui', 'views', 'info.ts');
    const anzahl = (info.match(/^\s*titel:/gm) ?? []).length;
    expect(anzahl).toBe(8);
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
});
