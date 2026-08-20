/**
 * Die Vollsicherung von Kontakten und Verlauf.
 *
 * Zwei Eigenschaften, die sie tragen — und beide sind es wert, festgehalten zu
 * werden, weil ihr Bruch nicht auffiele:
 *
 *  1. **Sie ergänzt, sie ersetzt nicht.** Wer eine alte Sicherung einspielt,
 *     darf damit keinen neueren Kontakt zurückdrehen und keine
 *     Vertrauensmarkierung verlieren.
 *  2. **Sie ist verschlüsselt.** Eine Datei mit allen Gesprächen, die man
 *     ungeschützt herumliegen lassen könnte, wäre schlimmer als keine.
 */

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SICHERUNG_FASSUNG,
  erzeuge,
  spieleEin,
} from '../src/worker/sicherung.ts';
import {
  DB_NAME, STORE_CONTACTS, STORE_MESSAGES, alle, oeffne, schreibe,
} from '../src/worker/idb.ts';

/**
 * Die Krypto wird ausgetauscht — hier geht es um die Sicherungslogik.
 *
 * ⚠️ Die Attrappe verpackt den Klartext SICHTBAR (`ENC(<inhalt>)`), damit sich
 *    nachher prüfen lässt, was in der Datei landet. Sie darf die geprüfte
 *    Eigenschaft dabei nicht selbst verletzen: geprüft wird, dass die
 *    Sicherung ÜBERHAUPT durch die Verschlüsselung läuft — nicht, dass diese
 *    Attrappe gut verschlüsselt.
 */
vi.mock('../src/worker/werkzeug.ts', () => ({
  verschluessele: (klartext: string) => Promise.resolve(`ENC(${klartext})`),
  entschluessele: (armored: string) => {
    const treffer = /^ENC\(([\s\S]*)\)$/.exec(armored);
    if (treffer === null) throw new Error('nicht entschlüsselbar');
    return Promise.resolve({ klartext: treffer[1] ?? '', signaturen: [] });
  },
}));

let db: IDBDatabase;
const SCHLUESSEL = [] as never[];
const EMPFAENGER = {} as never;

const kontakt = (fp: string, name = 'Rosa') => ({
  fingerprint: fp, name, armoredPublic: 'KEY', vertrauen: 'unverifiziert',
  angelegtAm: '2026-01-01T00:00:00.000Z', verifiziertAm: null, frühereFingerprints: [],
});
const nachricht = (id: string, fp = 'A'.repeat(40)) => ({
  id, kontaktFp: fp, richtung: 'ein', ciphertext: `C-${id}`, zeit: 1, zugestellt: true,
});

beforeEach(async () => {
  await new Promise((fertig) => {
    const a = indexedDB.deleteDatabase(DB_NAME);
    a.onsuccess = fertig; a.onerror = fertig; a.onblocked = fertig;
  });
  db = await oeffne();
});
afterEach(() => { db.close(); });

describe('Erzeugen', () => {
  it('nimmt Kontakte und Verlauf mit', async () => {
    await schreibe(db, STORE_CONTACTS, kontakt('A'.repeat(40)));
    await schreibe(db, STORE_MESSAGES, nachricht('m1'));
    const datei = await erzeuge(db, EMPFAENGER, null);
    expect(datei).toContain('"kontakte"');
    expect(datei).toContain('"verlauf"');
    expect(datei).toContain('m1');
  });

  it('läuft durch die Verschlüsselung — die Datei ist kein blankes JSON', async () => {
    // ⚠️ Der eigentliche Punkt: hier liegen ALLE Gespräche in einer Datei.
    //    Ginge sie unverschlüsselt hinaus, wäre sie die grösste Schwachstelle
    //    der App — und man sähe es ihr nicht an.
    const datei = await erzeuge(db, EMPFAENGER, null);
    expect(datei.startsWith('ENC(')).toBe(true);
    expect(datei.startsWith('{')).toBe(false);
  });

  it('trägt eine Fassungsnummer', async () => {
    const datei = await erzeuge(db, EMPFAENGER, null);
    expect(datei).toContain(`"fassung":${String(SICHERUNG_FASSUNG)}`);
  });

  it('funktioniert auch, wenn nichts da ist', async () => {
    const datei = await erzeuge(db, EMPFAENGER, null);
    expect(datei).toContain('"kontakte":[]');
    expect(datei).toContain('"verlauf":[]');
  });

  it('reicht den Verlauf als Ciphertext durch, ohne ihn zu öffnen', async () => {
    // Er ist bereits verschlüsselt. Ihn zu entschlüsseln und neu zu
    // verschlüsseln hiesse, den Klartext unnötig anzufassen.
    await schreibe(db, STORE_MESSAGES, nachricht('m1'));
    expect(await erzeuge(db, EMPFAENGER, null)).toContain('C-m1');
  });
});

describe('Einspielen', () => {
  it('spielt in einen leeren Bestand ein', async () => {
    await schreibe(db, STORE_CONTACTS, kontakt('A'.repeat(40)));
    await schreibe(db, STORE_MESSAGES, nachricht('m1'));
    const datei = await erzeuge(db, EMPFAENGER, null);

    // Bestand leeren, dann zurückspielen.
    db.close(); await new Promise((f) => {
      const a = indexedDB.deleteDatabase(DB_NAME); a.onsuccess = f; a.onerror = f; a.onblocked = f;
    });
    db = await oeffne();

    const bericht = await spieleEin(db, datei, SCHLUESSEL);
    expect(bericht).toEqual({
      kontakteNeu: 1, kontakteUebersprungen: 0, nachrichtenNeu: 1, nachrichtenUebersprungen: 0,
    });
    expect((await alle(db, STORE_CONTACTS)).length).toBe(1);
  });

  it('überschreibt einen vorhandenen Kontakt NICHT', async () => {
    // ⚠️ Der wichtigste Zweig. Eine alte Sicherung darf keine inzwischen
    //    gesetzte Verifikation zurückdrehen — das wäre ein Sicherheitsverlust
    //    durch eine Handlung, die wie Fürsorge aussieht.
    await schreibe(db, STORE_CONTACTS, kontakt('A'.repeat(40), 'Alt'));
    const alteSicherung = await erzeuge(db, EMPFAENGER, null);

    await schreibe(db, STORE_CONTACTS,
      { ...kontakt('A'.repeat(40), 'Neu'), vertrauen: 'verifiziert' });

    const bericht = await spieleEin(db, alteSicherung, SCHLUESSEL);
    expect(bericht.kontakteNeu).toBe(0);
    expect(bericht.kontakteUebersprungen).toBe(1);

    const [jetzt] = await alle<{ name: string; vertrauen: string }>(db, STORE_CONTACTS);
    expect(jetzt?.name).toBe('Neu');
    expect(jetzt?.vertrauen).toBe('verifiziert');
  });

  it('legt eine vorhandene Nachricht nicht ein zweites Mal ab', async () => {
    await schreibe(db, STORE_MESSAGES, nachricht('m1'));
    const datei = await erzeuge(db, EMPFAENGER, null);
    const bericht = await spieleEin(db, datei, SCHLUESSEL);
    expect(bericht.nachrichtenNeu).toBe(0);
    expect(bericht.nachrichtenUebersprungen).toBe(1);
    expect((await alle(db, STORE_MESSAGES)).length).toBe(1);
  });

  it('ergänzt das Fehlende und lässt das Vorhandene stehen', async () => {
    await schreibe(db, STORE_MESSAGES, nachricht('m1'));
    await schreibe(db, STORE_MESSAGES, nachricht('m2'));
    const datei = await erzeuge(db, EMPFAENGER, null);

    db.close(); await new Promise((f) => {
      const a = indexedDB.deleteDatabase(DB_NAME); a.onsuccess = f; a.onerror = f; a.onblocked = f;
    });
    db = await oeffne();
    await schreibe(db, STORE_MESSAGES, nachricht('m1'));

    const bericht = await spieleEin(db, datei, SCHLUESSEL);
    expect(bericht.nachrichtenNeu).toBe(1);
    expect(bericht.nachrichtenUebersprungen).toBe(1);
    expect((await alle(db, STORE_MESSAGES)).length).toBe(2);
  });

  it('ist mehrfach einspielbar, ohne etwas zu verdoppeln', async () => {
    await schreibe(db, STORE_MESSAGES, nachricht('m1'));
    const datei = await erzeuge(db, EMPFAENGER, null);
    await spieleEin(db, datei, SCHLUESSEL);
    await spieleEin(db, datei, SCHLUESSEL);
    expect((await alle(db, STORE_MESSAGES)).length).toBe(1);
  });
});

describe('Was keine Sicherung ist', () => {
  it.each([
    ['blanker Text', 'guten Tag'],
    ['ein PGP-Block, der keine Sicherung ist', 'ENC(-----BEGIN PGP MESSAGE-----)'],
    ['leer', 'ENC()'],
  ])('weist %s ab', async (_name, eingabe) => {
    await expect(spieleEin(db, eingabe, SCHLUESSEL)).rejects.toThrow();
  });

  it('weist eine andere Fassung ab, statt zu raten', async () => {
    // Ein späteres Format könnte Felder anders deuten. Lieber ehrlich
    // scheitern als etwas Halbes einspielen.
    const fremd = `ENC(${JSON.stringify({ fassung: 99, kontakte: [], verlauf: [] })})`;
    await expect(spieleEin(db, fremd, SCHLUESSEL)).rejects.toThrow();
  });

  it('überspringt kaputte Einträge, statt am ganzen Einspielen zu scheitern', async () => {
    // Eine Sicherung mit einer beschädigten Zeile ist immer noch besser als
    // gar keine — und der Bericht sagt, dass etwas fehlte.
    const gemischt = `ENC(${JSON.stringify({
      fassung: SICHERUNG_FASSUNG,
      erzeugt: '2026-01-01T00:00:00.000Z',
      kontakte: [kontakt('B'.repeat(40)), { name: 'ohne Fingerprint' }],
      verlauf: [nachricht('m1'), { id: 'm2' }, null],
    })})`;
    const bericht = await spieleEin(db, gemischt, SCHLUESSEL);
    expect(bericht.kontakteNeu).toBe(1);
    expect(bericht.kontakteUebersprungen).toBe(1);
    expect(bericht.nachrichtenNeu).toBe(1);
    expect(bericht.nachrichtenUebersprungen).toBe(2);
  });

  it('kommt mit fehlenden Listen zurecht', async () => {
    const knapp = `ENC(${JSON.stringify({ fassung: SICHERUNG_FASSUNG })})`;
    await expect(spieleEin(db, knapp, SCHLUESSEL)).resolves.toEqual({
      kontakteNeu: 0, kontakteUebersprungen: 0, nachrichtenNeu: 0, nachrichtenUebersprungen: 0,
    });
  });
});
