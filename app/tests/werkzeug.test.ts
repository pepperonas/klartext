/**
 * Das Werkzeug gegen echtes GnuPG — in beide Richtungen.
 *
 * Der wichtigste Test hier ist der über verfälschte Signaturen: `verified` ist
 * ein Promise, das WIRFT statt `false` zu liefern. Wer den Fehler verschluckt,
 * meldet jede kaputte Signatur als gültig.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { KlartextError } from '../src/crypto/errors.ts';
import { leseOeffentlich, leseUndEntsperre } from '../src/worker/keys.ts';
import {
  entschluessele,
  erkenne,
  leseEmpfaenger,
  pruefe,
  signiere,
  verschluessele,
} from '../src/worker/werkzeug.ts';
import { KLARTEXT, lies, meta } from './fixtures.ts';

function gpgVorhanden(): boolean {
  try { execFileSync('gpg', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const HAT_GPG = gpgVorhanden();
if (process.env['KLARTEXT_GPG'] === '1' && !HAT_GPG) {
  throw new Error('KLARTEXT_GPG=1 gesetzt, aber gpg fehlt.');
}

interface GpgLauf { readonly stdout: string; readonly stderr: string }

function mitGpg<T>(fn: (g: (args: string[], eingabe?: string) => GpgLauf) => T): T {
  const home = mkdtempSync(join(tmpdir(), 'klartext-wz-'));
  try {
    const g = (args: string[], eingabe?: string): GpgLauf => {
      const r = spawnSync('gpg', ['--batch', '--yes', '--pinentry-mode', 'loopback', ...args], {
        env: { ...process.env, GNUPGHOME: home }, input: eingabe, encoding: 'utf8',
      });
      return { stdout: r.stdout, stderr: r.stderr };
    };
    return fn(g);
  } finally {
    try { execFileSync('gpgconf', ['--kill', 'gpg-agent'], { env: { ...process.env, GNUPGHOME: home }, stdio: 'ignore' }); } catch { /* egal */ }
    rmSync(home, { recursive: true, force: true });
  }
}

const rsaSec = async () => await leseUndEntsperre(lies('rsa4096.sec.asc'), meta.passphrase);
const eccSec = async () => await leseUndEntsperre(lies('ed25519.sec.asc'), meta.passphrase);
const rsaPub = async () => await leseOeffentlich(lies('rsa4096.pub.asc'));
const eccPub = async () => await leseOeffentlich(lies('ed25519.pub.asc'));

// ================================================================== Erkennen

describe('Erkennen', () => {
  it.each([
    ['msg.rsa.enc.asc', 'nachricht'],
    ['sig.rsa.clear.asc', 'signierter-text'],
    ['sig.rsa.detached.asc', 'signatur'],
    ['rsa4096.pub.asc', 'oeffentlicher-key'],
    ['rsa4096.sec.asc', 'privater-key'],
  ])('erkennt %s als %s', async (datei, art) => {
    const e = await erkenne(lies(datei), []);
    expect(e.art).toBe(art);
    expect(e.beschreibung.length).toBeGreaterThan(10);
  });

  it('erkennt gewöhnlichen Text als Klartext', async () => {
    const e = await erkenne('Hallo, wie geht es dir?', []);
    expect(e.art).toBe('klartext');
  });

  it('nennt bei Schlüsseln Fingerprint und Kennung', async () => {
    const e = await erkenne(lies('rsa4096.pub.asc'), []);
    expect(e.fingerprint).toBe(meta.rsa.fingerprint);
    expect(e.userIds).toContain(meta.rsa.userId);
  });

  it('sagt, ob eine Nachricht an uns geht', async () => {
    const fremd = await erkenne(lies('msg.rsa.enc.asc'), []);
    expect(fremd.fuerUns).toBe(false);
    expect(fremd.empfaenger.length).toBeGreaterThan(0);

    const unser = await erkenne(lies('msg.rsa.enc.asc'), [await rsaPub()]);
    expect(unser.fuerUns).toBe(true);
    expect(unser.beschreibung).toMatch(/an dich/);
  });

  it('kommt mit Fließtext um den Block herum zurecht', async () => {
    const e = await erkenne(`Hi!\n\n${lies('msg.rsa.enc.asc')}\n\nGruß`, []);
    expect(e.art).toBe('nachricht');
  });

  it('meldet einen beschädigten Block als solchen, statt ihn zu verschweigen', async () => {
    const kaputt = lies('msg.rsa.enc.asc').replace(/^[A-Za-z0-9+/]{20}/m, 'XXXXXXXXXXXXXXXXXXXX');
    const e = await erkenne(kaputt, []);
    expect(e.art).toBe('nachricht');
    expect(e.beschreibung).toMatch(/beschädigt|lesen/i);
  });
});

// ========================================================= gpg -> klartext

describe('gpg -> klartext', () => {
  it('entschlüsselt und meldet die gültige Signatur mit Namen', async () => {
    const e = await entschluessele(lies('msg.rsa.signed-enc.asc'), [await rsaSec()], [await rsaPub()]);
    expect(e.klartext).toBe(KLARTEXT);
    expect(e.signaturen).toHaveLength(1);
    expect(e.signaturen[0]?.zustand).toBe('gueltig');
    expect(e.signaturen[0]?.wer).toBe(meta.rsa.userId);
    expect(e.signaturen[0]?.fingerprint).toBe(meta.rsa.fingerprint);
  });

  it('unterscheidet „unbekannter Schlüssel" von „ungültig"', async () => {
    // Ohne den Schlüssel des Unterzeichners lässt sich nichts beurteilen —
    // das als „ungültig" darzustellen wäre eine Falschaussage.
    const e = await entschluessele(lies('msg.rsa.signed-enc.asc'), [await rsaSec()], [await eccPub()]);
    expect(e.signaturen[0]?.zustand).toBe('unbekannter-schluessel');
    expect(e.signaturen[0]?.wer).toBeNull();
  });

  it('prüft eine Klartext-Signatur und gibt den Text zurück', async () => {
    const e = await pruefe(lies('sig.rsa.clear.asc'), null, [await rsaPub()]);
    expect(e.signaturen[0]?.zustand).toBe('gueltig');
    expect(e.klartext).toBe(KLARTEXT.replace(/\n$/, ''));
  });

  it('prüft eine abgetrennte Signatur', async () => {
    const e = await pruefe(KLARTEXT, lies('sig.ecc.detached.asc'), [await eccPub()]);
    expect(e.signaturen[0]?.zustand).toBe('gueltig');
  });

  it('meldet eine verfälschte Signatur als UNGÜLTIG, nicht als gültig', async () => {
    // ⚠️ `verified` wirft, statt false zu liefern. Wer den Fehler verschluckt,
    //    meldet jede kaputte Signatur als in Ordnung.
    const e = await pruefe(`${KLARTEXT}manipuliert`, lies('sig.ecc.detached.asc'), [await eccPub()]);
    expect(e.signaturen[0]?.zustand).toBe('ungueltig');
  });

  it('meldet einen verfälschten Klartext-Signaturblock als ungültig', async () => {
    const verfaelscht = lies('sig.rsa.clear.asc').replace('Hallo aus GnuPG.', 'Hallo aus Bosheit.');
    const e = await pruefe(verfaelscht, null, [await rsaPub()]);
    expect(e.signaturen[0]?.zustand).toBe('ungueltig');
  });

  it('weist eine Nachricht ab, für die kein Schlüssel da ist', async () => {
    // Beide Codes sind vertretbar: „kein passender Schlüssel" ist die genauere
    // Diagnose, „Entschlüsseln fehlgeschlagen" die vorsichtigere.
    const fehler = await entschluessele(lies('msg.rsa.enc.asc'), [await eccSec()], [])
      .then(() => null, (e: unknown) => e);
    expect(fehler).toBeInstanceOf(KlartextError);
    expect(['NO_MATCHING_KEY', 'DECRYPT_FAILED']).toContain((fehler as KlartextError).code);
  });

  it('weist Unsinn als „keine Nachricht" ab', async () => {
    await expect(entschluessele('völliger Unsinn', [await rsaSec()], []))
      .rejects.toMatchObject({ code: 'NOT_A_MESSAGE' });
  });
});

// ========================================================= klartext -> gpg

describe('klartext -> gpg', () => {
  it('verschlüsselt an einen gpg-Schlüssel', async () => {
    const geheim = 'Nachricht aus dem Werkzeug. Umlaute: Grueezi, Aepfel.';
    const armored = await verschluessele(geheim, [await rsaPub()], null);

    const raus = mitGpg((g) => {
      g(['--import'], lies('rsa4096.sec.asc'));
      return g(['--passphrase', meta.passphrase, '--decrypt'], armored).stdout;
    });
    expect(raus).toBe(geheim);
  });

  it('verschlüsselt an ZWEI Empfänger — beide kommen dran', async () => {
    const geheim = 'An beide.';
    const armored = await verschluessele(geheim, [await rsaPub(), await eccPub()], null);
    for (const sec of ['rsa4096.sec.asc', 'ed25519.sec.asc']) {
      const raus = mitGpg((g) => {
        g(['--import'], lies(sec));
        return g(['--passphrase', meta.passphrase, '--decrypt'], armored).stdout;
      });
      expect(raus).toBe(geheim);
    }
  });

  it('verschlüsselt UND signiert — gpg bestätigt beides', async () => {
    const geheim = 'Verschlüsselt und unterschrieben.';
    const armored = await verschluessele(geheim, [await rsaPub()], await eccSec());

    const lauf = mitGpg((g) => {
      g(['--import'], lies('rsa4096.sec.asc'));
      g(['--import'], lies('ed25519.pub.asc'));
      return g(['--passphrase', meta.passphrase, '--decrypt'], armored);
    });
    expect(lauf.stdout).toBe(geheim);
    expect(lauf.stderr).toMatch(/Good signature|Korrekte Signatur/i);
  });

  it('gpg prüft eine hier erzeugte Klartext-Signatur', async () => {
    const text = 'Von klartext im Klartext signiert.';
    const armored = await signiere(text, await eccSec(), false);
    expect(armored).toContain('BEGIN PGP SIGNED MESSAGE');

    const lauf = mitGpg((g) => {
      g(['--import'], lies('ed25519.pub.asc'));
      return g(['--verify'], armored);
    });
    expect(lauf.stderr).toMatch(/Good signature|Korrekte Signatur/i);
  });

  it('gpg prüft eine hier erzeugte abgetrennte Signatur', async () => {
    const text = 'Abgetrennt unterschrieben.';
    const armored = await signiere(text, await rsaSec(), true);

    const lauf = mitGpg((g) => {
      g(['--import'], lies('rsa4096.pub.asc'));
      const dir = mkdtempSync(join(tmpdir(), 'klartext-ds-'));
      const t = join(dir, 't.txt');
      const sg = join(dir, 't.sig');
      writeFileSync(t, text);
      writeFileSync(sg, armored);
      try { return g(['--verify', sg, t]); } finally { rmSync(dir, { recursive: true, force: true }); }
    });
    expect(lauf.stderr).toMatch(/Good signature|Korrekte Signatur/i);
  });
});

// ================================================================= Rundlauf

describe('Rundlauf im eigenen Haus', () => {
  it('verschlüsseln und wieder entschlüsseln erhält den Text — auch mit Umlauten und Emoji', async () => {
    const texte = [
      'Kurz.',
      'Mit Umlauten: Grüße, Äpfel, weiße Wölfe, Straße.',
      'Mit Emoji: 🔐 klartext 🗝️',
      'Mit Zeilen:\n\nabsatz\n\tund Tabulator',
      'x'.repeat(50_000),
    ];
    const pub = await rsaPub();
    const sec = await rsaSec();
    for (const text of texte) {
      const armored = await verschluessele(text, [pub], null);
      const zurueck = await entschluessele(armored, [sec], []);
      expect(zurueck.klartext).toBe(text);
    }
  });

  it('nimmt einen frisch eingefügten fremden Schlüssel als Empfänger an', async () => {
    const empfaenger = await leseEmpfaenger([lies('ed25519.pub.asc')]);
    const armored = await verschluessele('Für den eingefügten Schlüssel.', empfaenger, null);
    const zurueck = await entschluessele(armored, [await eccSec()], []);
    expect(zurueck.klartext).toBe('Für den eingefügten Schlüssel.');
  });

  it('verlangt mindestens einen Empfänger', async () => {
    await expect(verschluessele('x', [], null)).rejects.toMatchObject({ code: 'NO_MATCHING_KEY' });
  });
});
