/**
 * Das Kontaktbuch.
 *
 * Der wichtigste Test ist der über den Schlüsselwechsel: dass unter bekanntem
 * Namen auftauchendes fremdes Schlüsselmaterial NIEMALS stillschweigend
 * übernommen wird. Das ist die einzige Stelle, an der ein Angreifer sich
 * einschleichen könnte, ohne dass jemand hinschaut.
 */

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DB_NAME, oeffne } from '../src/worker/idb.ts';
import { Kontaktbuch } from '../src/worker/kontakte.ts';
import { lies, meta } from './fixtures.ts';

let db: IDBDatabase;
let buch: Kontaktbuch;

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => { resolve(); };
    req.onerror = () => { resolve(); };
    req.onblocked = () => { resolve(); };
  });
  db = await oeffne();
  buch = new Kontaktbuch(db);
});
afterEach(() => { db.close(); });

const RSA = () => lies('rsa4096.pub.asc');
const ECC = () => lies('ed25519.pub.asc');

describe('Aufnehmen', () => {
  it('nimmt einen Schlüssel auf und rechnet den Fingerprint selbst aus', async () => {
    const k = await buch.uebernimm(RSA(), null, 'Rosa');
    expect(k.fingerprint).toBe(meta.rsa.fingerprint);
    expect(k.name).toBe('Rosa');
    expect(k.userIds).toContain(meta.rsa.userId);
    expect(k.bits).toBe(4096);
  });

  it('nimmt einen Schlüssel auch binär entgegen — so kommt er aus der Einladung', async () => {
    const armor = ECC();
    const zeilen = armor.split(/\r?\n/);
    const s = zeilen.findIndex((z) => z.startsWith('-----BEGIN'));
    const e = zeilen.findIndex((z) => z.startsWith('-----END'));
    const binaer = Uint8Array.from(Buffer.from(
      zeilen.slice(s + 1, e).filter((z) => z.length > 0 && !z.includes(':') && !z.startsWith('=')).join(''),
      'base64',
    ));
    const k = await buch.uebernimm(null, binaer, 'Ede');
    expect(k.fingerprint).toBe(meta.ecc.fingerprint);
  });

  it('ist IMMER zuerst unverifiziert — ganz gleich, woher der Schlüssel kam', async () => {
    // ⚠️ Auch aus einem Einladungslink. Der Link beweist nichts darüber, wer
    //    ihn geschickt hat.
    const k = await buch.uebernimm(RSA(), null, 'Rosa');
    expect(k.vertrauen).toBe('unverifiziert');
    expect(k.verifiziertAm).toBeNull();
  });

  it('nimmt den Namen aus der Benutzerkennung, wenn keiner angegeben ist', async () => {
    const k = await buch.uebernimm(RSA(), null, '   ');
    expect(k.name).toBe(meta.rsa.userId);
  });

  it('liefert die Wörter zum Vorlesen gleich mit', async () => {
    const k = await buch.uebernimm(RSA(), null, 'Rosa');
    expect(k.woerter).toHaveLength(13);
    expect(k.woerter.every((w) => /^[a-z]+$/.test(w))).toBe(true);
  });

  it('weist Unsinn als „kein Schlüssel" ab', async () => {
    await expect(buch.uebernimm('völliger Unsinn', null, 'X')).rejects.toMatchObject({ code: 'NOT_A_KEY' });
    await expect(buch.uebernimm(null, null, 'X')).rejects.toMatchObject({ code: 'NOT_A_KEY' });
  });

  it('sortiert die Liste nach Namen', async () => {
    await buch.uebernimm(RSA(), null, 'Zora');
    await buch.uebernimm(ECC(), null, 'Anton');
    expect((await buch.liste()).map((k) => k.name)).toEqual(['Anton', 'Zora']);
  });
});

describe('Vorabprüfung', () => {
  it('meldet einen unbekannten Schlüssel als neu', async () => {
    const ergebnis = await buch.pruefe(RSA(), null, 'Rosa');
    expect(ergebnis.art).toBe('neu');
  });

  it('meldet einen schon vorhandenen als bekannt', async () => {
    await buch.uebernimm(RSA(), null, 'Rosa');
    const ergebnis = await buch.pruefe(RSA(), null, 'Rosa');
    expect(ergebnis.art).toBe('bekannt');
  });

  it('MELDET EINEN SCHLÜSSELWECHSEL, statt ihn zu übernehmen', async () => {
    // ⚠️ Der Kern der Sache: derselbe Name, ein anderer Schlüssel. Entweder
    //    hat die Person einen neuen — oder jemand setzt sich dazwischen. Von
    //    aussen ist das nicht zu unterscheiden, also entscheidet der Mensch.
    await buch.uebernimm(RSA(), null, 'Rosa');
    const ergebnis = await buch.pruefe(ECC(), null, 'Rosa');
    expect(ergebnis.art).toBe('schluesselwechsel');
    if (ergebnis.art === 'schluesselwechsel') {
      expect(ergebnis.bisher.fingerprint).toBe(meta.rsa.fingerprint);
      expect(ergebnis.kontakt.fingerprint).toBe(meta.ecc.fingerprint);
    }
  });

  it('erkennt den Wechsel auch bei anderer Schreibweise des Namens', async () => {
    await buch.uebernimm(RSA(), null, 'Rosa');
    expect((await buch.pruefe(ECC(), null, '  ROSA ')).art).toBe('schluesselwechsel');
  });

  it('ändert bei der Vorabprüfung nichts am Bestand', async () => {
    await buch.uebernimm(RSA(), null, 'Rosa');
    await buch.pruefe(ECC(), null, 'Rosa');
    const liste = await buch.liste();
    expect(liste).toHaveLength(1);
    expect(liste[0]?.fingerprint).toBe(meta.rsa.fingerprint);
  });
});

describe('Schlüsselwechsel übernehmen', () => {
  it('merkt sich den alten Fingerprint als Historie', async () => {
    await buch.uebernimm(RSA(), null, 'Rosa');
    const neu = await buch.uebernimm(ECC(), null, 'Rosa');
    expect(neu.fingerprint).toBe(meta.ecc.fingerprint);
    expect(neu.frühereFingerprints).toContain(meta.rsa.fingerprint);
  });

  it('hinterlässt nur EINEN Eintrag für die Person', async () => {
    await buch.uebernimm(RSA(), null, 'Rosa');
    await buch.uebernimm(ECC(), null, 'Rosa');
    expect(await buch.liste()).toHaveLength(1);
  });

  it('der neue Schlüssel ist wieder unverifiziert — auch wenn der alte es war', async () => {
    // ⚠️ Sonst erbte ein untergeschobener Schlüssel das Vertrauen des echten.
    await buch.uebernimm(RSA(), null, 'Rosa');
    await buch.verifiziere(meta.rsa.fingerprint, true);
    const neu = await buch.uebernimm(ECC(), null, 'Rosa');
    expect(neu.vertrauen).toBe('unverifiziert');
  });
});

describe('Verifizieren', () => {
  it('setzt und entzieht das Vertrauen', async () => {
    await buch.uebernimm(RSA(), null, 'Rosa');
    const ja = await buch.verifiziere(meta.rsa.fingerprint, true);
    expect(ja.vertrauen).toBe('verifiziert');
    expect(ja.verifiziertAm).not.toBeNull();

    const nein = await buch.verifiziere(meta.rsa.fingerprint, false);
    expect(nein.vertrauen).toBe('unverifiziert');
    expect(nein.verifiziertAm).toBeNull();
  });

  it('überlebt einen erneuten Import desselben Schlüssels', async () => {
    await buch.uebernimm(RSA(), null, 'Rosa');
    await buch.verifiziere(meta.rsa.fingerprint, true);
    const wieder = await buch.uebernimm(RSA(), null, 'Rosa neu benannt');
    expect(wieder.vertrauen).toBe('verifiziert');
    expect(wieder.name).toBe('Rosa neu benannt');
  });

  it('weist einen unbekannten Fingerprint ab', async () => {
    await expect(buch.verifiziere('0'.repeat(40), true)).rejects.toMatchObject({ code: 'KEY_NOT_FOUND' });
  });
});

describe('Verwalten', () => {
  it('benennt um, ohne das Vertrauen anzufassen', async () => {
    await buch.uebernimm(RSA(), null, 'Rosa');
    await buch.verifiziere(meta.rsa.fingerprint, true);
    const k = await buch.umbenennen(meta.rsa.fingerprint, 'Rosa L.');
    expect(k.name).toBe('Rosa L.');
    expect(k.vertrauen).toBe('verifiziert');
  });

  it('löscht', async () => {
    await buch.uebernimm(RSA(), null, 'Rosa');
    expect(await buch.loesche(meta.rsa.fingerprint)).toEqual([]);
  });

  it('gibt den öffentlichen Schlüssel wieder heraus', async () => {
    await buch.uebernimm(RSA(), null, 'Rosa');
    const armored = await buch.armored(meta.rsa.fingerprint);
    expect(armored).toContain('BEGIN PGP PUBLIC KEY BLOCK');
  });

  it('liefert alle Schlüssel zum Prüfen von Signaturen', async () => {
    await buch.uebernimm(RSA(), null, 'Rosa');
    await buch.uebernimm(ECC(), null, 'Ede');
    expect(await buch.alleSchluessel()).toHaveLength(2);
  });
});
