/**
 * Vollsicherung: Kontakte und Gesprächsverlauf.
 *
 * Die Schlüsselsicherung (`vault.exportiere`) enthält NUR den Schlüssel — sie
 * ist ein OpenPGP-Export, damit GnuPG sie lesen kann. Wer die Browserdaten
 * löscht, bekommt damit den Schlüssel zurück, aber kein einziges Gespräch.
 *
 * ⚠️ Diese Datei ist deshalb ein **eigener** Weg, kein erweiterter Export. Sie
 *    in die Schlüsseldatei zu packen hiesse, ein Format zu verbiegen, das
 *    GnuPG kennt — und eine Datei zu erzeugen, die je nach Herkunft mal
 *    Gespräche enthält und mal nicht.
 *
 * ⚠️ Sie ist an den EIGENEN Schlüssel verschlüsselt. Ohne ihn und seine
 *    Passphrase ist die Datei ein Haufen Zufall. Das ist der Punkt: eine
 *    Sicherung der Gespräche, die man ungeschützt herumliegen lassen könnte,
 *    wäre schlimmer als keine.
 *
 * ⚠️ Der Verlauf wird NICHT entschlüsselt und neu verschlüsselt. Er liegt
 *    ohnehin als Ciphertext vor und wandert wörtlich in die Datei — die
 *    Nachrichten sind dann doppelt geschützt, und der Weg fasst keinen
 *    Klartext an.
 */

import type { PrivateKey, PublicKey } from 'openpgp';

import { KlartextError } from '../crypto/errors.ts';
import type { VerlaufsEintrag } from '../crypto/protocol.ts';
import * as idb from './idb.ts';
import { entschluessele, verschluessele } from './werkzeug.ts';

/** Die Fassung steht drin, damit ein späteres Format erkennbar bleibt. */
export const SICHERUNG_FASSUNG = 1;

export interface Sicherungsinhalt {
  readonly fassung: number;
  readonly erzeugt: string;
  readonly kontakte: readonly unknown[];
  readonly verlauf: readonly VerlaufsEintrag[];
}

export interface Einspielbericht {
  readonly kontakteNeu: number;
  readonly kontakteUebersprungen: number;
  readonly nachrichtenNeu: number;
  readonly nachrichtenUebersprungen: number;
}

export async function erzeuge(
  db: IDBDatabase,
  an: PublicKey,
  signiereMit: PrivateKey | null,
): Promise<string> {
  const inhalt: Sicherungsinhalt = {
    fassung: SICHERUNG_FASSUNG,
    erzeugt: new Date().toISOString(),
    kontakte: await idb.alle<unknown>(db, idb.STORE_CONTACTS),
    verlauf: await idb.alle<VerlaufsEintrag>(db, idb.STORE_MESSAGES),
  };
  return await verschluessele(JSON.stringify(inhalt), [an], signiereMit);
}

/**
 * Spielt eine Sicherung ein — **ergänzend**, nie ersetzend.
 *
 * ⚠️ Vorhandenes wird nicht überschrieben. Wer eine alte Sicherung einspielt,
 *    darf damit keinen neueren Kontakt zurückdrehen und keine
 *    Vertrauensmarkierung verlieren; und eine Nachricht, die schon da ist,
 *    zweimal zu haben wäre auch keine Verbesserung. Der Bericht sagt, was
 *    dabei übersprungen wurde — stillschweigend zu überspringen sähe aus wie
 *    ein fehlgeschlagener Import.
 */
export async function spieleEin(
  db: IDBDatabase,
  armored: string,
  meine: readonly PrivateKey[],
): Promise<Einspielbericht> {
  const { klartext } = await entschluessele(armored, meine, []);

  // ⚠️ NICHT `as Sicherungsinhalt` casten. Der Inhalt kommt aus einer Datei,
  //    die jemand ausgewählt hat — ein Cast wäre eine Behauptung gegenüber dem
  //    Compiler, keine Prüfung. Danach hielte TypeScript jede Feldabfrage für
  //    sicher, und ein fehlendes Feld schlüge erst zur Laufzeit zu.
  let roh: unknown;
  try {
    roh = JSON.parse(klartext);
  } catch {
    throw new KlartextError('NOT_A_BACKUP');
  }
  if (typeof roh !== 'object' || roh === null) throw new KlartextError('NOT_A_BACKUP');

  const inhalt = roh as Record<string, unknown>;
  if (inhalt['fassung'] !== SICHERUNG_FASSUNG) throw new KlartextError('NOT_A_BACKUP');

  const listeVon = (wert: unknown): unknown[] => (Array.isArray(wert) ? wert : []);

  let kontakteNeu = 0, kontakteUebersprungen = 0;
  for (const eintrag of listeVon(inhalt['kontakte'])) {
    const fp = (eintrag as { fingerprint?: unknown } | null)?.fingerprint;
    if (typeof fp !== 'string' || fp.length === 0) { kontakteUebersprungen += 1; continue; }
    if (await idb.lies(db, idb.STORE_CONTACTS, fp) !== undefined) {
      kontakteUebersprungen += 1; continue;
    }
    await idb.schreibe(db, idb.STORE_CONTACTS, eintrag);
    kontakteNeu += 1;
  }

  let nachrichtenNeu = 0, nachrichtenUebersprungen = 0;
  for (const eintrag of listeVon(inhalt['verlauf'])) {
    const e = eintrag as { id?: unknown; ciphertext?: unknown } | null;
    if (typeof e?.id !== 'string' || typeof e.ciphertext !== 'string') {
      nachrichtenUebersprungen += 1; continue;
    }
    if (await idb.lies(db, idb.STORE_MESSAGES, e.id) !== undefined) {
      nachrichtenUebersprungen += 1; continue;
    }
    await idb.schreibe(db, idb.STORE_MESSAGES, eintrag);
    nachrichtenNeu += 1;
  }

  return { kontakteNeu, kontakteUebersprungen, nachrichtenNeu, nachrichtenUebersprungen };
}
