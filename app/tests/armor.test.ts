import { describe, expect, it } from 'vitest';

import { entpackeArmorBlock, gruppiereFingerprint, normalisiereFingerprint } from '../src/worker/keys.ts';
import { lies } from './fixtures.ts';

describe('entpackeArmorBlock', () => {
  it('laesst einen sauberen Block unveraendert', () => {
    const rein = lies('rsa4096.pub.asc').trimEnd();
    expect(entpackeArmorBlock(rein).trimEnd()).toBe(rein);
  });

  it('entfernt den Schutz-Doppelpunkt, den gpg vor Widerrufszertifikate setzt', () => {
    const roh = lies('rsa4096.revoke.asc');
    const block = entpackeArmorBlock(roh);
    expect(block.startsWith('-----BEGIN PGP PUBLIC KEY BLOCK-----')).toBe(true);
    expect(block).not.toContain(':-----BEGIN');
  });

  it('schneidet Fliesstext vor und nach dem Block weg', () => {
    const pub = lies('ed25519.pub.asc');
    const umgeben = `Hi, hier mein Schluessel:\n\n${pub}\n\nGruesse!\n`;
    const block = entpackeArmorBlock(umgeben);
    expect(block.startsWith('-----BEGIN')).toBe(true);
    expect(block.trimEnd().endsWith('-----END PGP PUBLIC KEY BLOCK-----')).toBe(true);
    expect(block).not.toContain('Gruesse');
  });

  it('behaelt bei einer Klartext-Signatur BEIDE Teilbloecke', () => {
    const clear = lies('sig.rsa.clear.asc');
    const block = entpackeArmorBlock(`Zitat:\n${clear}\n-- \nSignatur der Mail\n`);
    expect(block).toContain('BEGIN PGP SIGNED MESSAGE');
    expect(block).toContain('BEGIN PGP SIGNATURE');
    expect(block.trimEnd().endsWith('-----END PGP SIGNATURE-----')).toBe(true);
    expect(block).not.toContain('Signatur der Mail');
  });

  it('gibt Text ohne Armor unveraendert zurueck — die Bibliothek soll den Fehler melden', () => {
    expect(entpackeArmorBlock('nur text')).toBe('nur text');
  });

  it('kommt mit CRLF zurecht (Windows-Zwischenablage)', () => {
    const crlf = lies('ed25519.pub.asc').replace(/\n/g, '\r\n');
    expect(entpackeArmorBlock(crlf).startsWith('-----BEGIN')).toBe(true);
  });
});

describe('Fingerprint-Darstellung', () => {
  it('normalisiert auf Grossbuchstaben ohne Leerzeichen', () => {
    expect(normalisiereFingerprint('d00c 4931 5dd8 c797')).toBe('D00C49315DD8C797');
  });

  it('gruppiert in Vierergruppen zum Vorlesen', () => {
    const fp = 'D00C49315DD8C7973BFA283EACCAC682B9FC696E';
    const gruppiert = gruppiereFingerprint(fp);
    expect(gruppiert).toBe('D00C 4931 5DD8 C797 3BFA 283E ACCA C682 B9FC 696E');
    expect(gruppiert.split(' ')).toHaveLength(10);
  });
});

describe('Verfahrensnamen im UI', () => {
  // Die internen Bezeichner von OpenPGP.js ("ed25519Legacy") sind korrekt, aber
  // keine Sprache, die man einem Menschen zeigt. Auf der Live-Seite stand das
  // eine Runde lang so da.
  it('kennt keine internen OID-Namen mehr im ausgelieferten Bundle-Text', async () => {
    const { readFileSync: lese } = await import('node:fs');
    const quelle = lese(new URL('../src/ui/views/schluessel.ts', import.meta.url), 'utf8');
    // Der Bezeichner darf nur noch als Schluessel der Uebersetzungstabelle
    // vorkommen, nicht als Wert, der ins DOM wandert.
    expect(quelle).toMatch(/ed25519Legacy:\s*'Curve25519'/);
  });
});
