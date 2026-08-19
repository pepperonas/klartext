/**
 * Fehler duerfen die Bibliothek nicht durchscheinen lassen — und sie duerfen
 * nicht werben. Beides wird hier festgehalten.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { KlartextError, toWire, uebersetze } from '../src/crypto/errors.ts';
import { leseOeffentlich, leseUndEntsperre } from '../src/worker/keys.ts';
import { lies } from './fixtures.ts';

const HIER = dirname(fileURLToPath(import.meta.url));

describe('Wire-Form', () => {
  it('traegt nur Code und Meldung — kein Stack, kein cause', () => {
    const wire = toWire(new KlartextError('WRONG_PASSPHRASE', new Error('Incorrect key passphrase at 0x1234')));
    expect(Object.keys(wire).sort()).toEqual(['code', 'message']);
    expect(JSON.stringify(wire)).not.toContain('0x1234');
    expect(JSON.stringify(wire)).not.toContain('Incorrect key passphrase');
  });

  it('macht aus einem unbekannten Fehler INTERNAL statt ihn durchzureichen', () => {
    const wire = toWire(new Error('/Users/geheim/pfad/openpgp.mjs:2368 sagt irgendwas'));
    expect(wire.code).toBe('INTERNAL');
    expect(wire.message).not.toContain('/Users/');
    expect(wire.message).not.toContain('openpgp');
  });

  it('behaelt den Originalfehler nur lokal an cause', () => {
    const original = new Error('interner Text');
    const fehler = uebersetze(original, 'NOT_A_KEY');
    expect(fehler.cause).toBe(original);
    expect(fehler.message).not.toContain('interner Text');
  });
});

describe('echte Fehlerwege', () => {
  it('kaputter Armor ergibt NOT_A_KEY ohne Bibliothekstext', async () => {
    await expect(leseOeffentlich('-----BEGIN PGP PUBLIC KEY BLOCK-----\nkaputt\n-----END PGP PUBLIC KEY BLOCK-----'))
      .rejects.toMatchObject({ code: 'NOT_A_KEY' });
  });

  it('voelliger Unsinn ergibt NOT_A_KEY', async () => {
    await expect(leseOeffentlich('hallo welt')).rejects.toMatchObject({ code: 'NOT_A_KEY' });
  });

  it('eine Nachricht statt eines Schluessels wird als solche abgewiesen', async () => {
    await expect(leseUndEntsperre(lies('msg.rsa.enc.asc'), 'x')).rejects.toMatchObject({ code: 'NOT_A_KEY' });
  });

  it('keine Fehlermeldung verraet Bibliothek, Pfad oder Stack', async () => {
    // "OpenPGP" als FORMATname ist erwuenscht ("Das ist kein OpenPGP-Schluessel")
    // — verboten ist die Bibliothek: Dateinamen, Pfade, Stack-Frames.
    const VERRAET = [/openpgp\.(m?js|cjs)/i, /node_modules/, /\/Users\//, /\bat .+:\d+:\d+/];
    const faelle = ['hallo welt', lies('msg.rsa.enc.asc'), '', '-----BEGIN PGP PUBLIC KEY BLOCK-----\nx\n-----END PGP PUBLIC KEY BLOCK-----'];
    for (const eingabe of faelle) {
      const fehler = await leseOeffentlich(eingabe).then(() => null, (e: unknown) => e);
      expect(fehler).toBeInstanceOf(KlartextError);
      for (const muster of VERRAET) {
        expect((fehler as KlartextError).message).not.toMatch(muster);
      }
    }
  });
});

describe('Wortlaut', () => {
  // "Klartext reden" ist der Markenkern, nicht nur der Name. Superlative, die
  // niemand einloesen kann, sind hier ein Testfehler.
  const VERBOTEN = [
    /militärisch/i, /military[- ]grade/i, /100\s*%\s*sicher/i, /unknackbar/i,
    /absolut sicher/i, /bankensicher/i, /unhackbar/i, /vollkommen anonym/i,
    /garantiert sicher/i,
  ];

  it('die Fehlermeldungen werben nicht', () => {
    const quelle = readFileSync(join(HIER, '..', 'src', 'crypto', 'errors.ts'), 'utf8');
    // ⚠️ Kommentarfrei pruefen: die Doku dieses Projekts zitiert die verbotenen
    //    Begriffe woertlich, um zu erklaeren, warum sie verboten sind.
    const pur = quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const muster of VERBOTEN) {
      expect(pur).not.toMatch(muster);
    }
  });
});
