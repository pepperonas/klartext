/**
 * Kontakte — die öffentlichen Schlüssel anderer Leute.
 *
 * Zwei Dinge sind hier nicht verhandelbar:
 *
 *  1. **Ein Schlüsselwechsel wird niemals stillschweigend übernommen.** Wenn
 *     unter demselben Namen ein anderer Schlüssel auftaucht, ist das entweder
 *     ein neuer Schlüssel derselben Person — oder jemand, der sich
 *     dazwischensetzt. Der Unterschied ist von aussen nicht erkennbar, also
 *     muss der Mensch entscheiden.
 *  2. **`unverifiziert` ist der Normalfall**, kein Sonderfall. Ein Schlüssel
 *     wird erst verifiziert, wenn jemand den Fingerprint über einen ZWEITEN
 *     Kanal abgeglichen hat. Bis dahin markiert die Oberfläche ihn dauerhaft.
 */

import * as openpgp from 'openpgp';
import type { PublicKey } from 'openpgp';

import { KlartextError, uebersetze } from '../crypto/errors.ts';
import type { Kontakt, KontaktAufnahme, Vertrauen } from '../crypto/protocol.ts';
import { alsWoerter } from '../contacts/wortabgleich.ts';
import * as idb from './idb.ts';
import { entpackeArmorBlock, normalisiereFingerprint } from './keys.ts';
import { READ_CONFIG } from './openpgp-config.ts';

interface GespeicherterKontakt {
  readonly fingerprint: string;
  readonly name: string;
  readonly armoredPublic: string;
  readonly vertrauen: Vertrauen;
  readonly angelegtAm: string;
  readonly verifiziertAm: string | null;
  readonly frühereFingerprints: readonly string[];
}

export async function leseSchluessel(
  armored: string | null,
  binaer: Uint8Array | null,
): Promise<PublicKey> {
  try {
    if (binaer !== null && binaer.length > 0) {
      return await openpgp.readKey({ binaryKey: binaer, config: READ_CONFIG });
    }
    if (armored !== null && armored.trim().length > 0) {
      return await openpgp.readKey({ armoredKey: entpackeArmorBlock(armored), config: READ_CONFIG });
    }
  } catch (fehler) {
    throw uebersetze(fehler, 'NOT_A_KEY');
  }
  throw new KlartextError('NOT_A_KEY');
}

async function beschreibe(zeile: GespeicherterKontakt): Promise<Kontakt> {
  const key = await openpgp.readKey({ armoredKey: zeile.armoredPublic, config: READ_CONFIG });
  const algo = key.getAlgorithmInfo();
  return {
    fingerprint: zeile.fingerprint,
    name: zeile.name,
    userIds: key.getUserIDs(),
    algorithm: algo.algorithm,
    bits: algo.bits ?? null,
    curve: algo.curve ?? null,
    vertrauen: zeile.vertrauen,
    angelegtAm: zeile.angelegtAm,
    verifiziertAm: zeile.verifiziertAm,
    isRevoked: await key.isRevoked(),
    frühereFingerprints: zeile.frühereFingerprints,
    woerter: alsWoerter(zeile.fingerprint),
  };
}

export class Kontaktbuch {
  readonly #db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.#db = db;
  }

  async #alle(): Promise<GespeicherterKontakt[]> {
    return await idb.alle<GespeicherterKontakt>(this.#db, idb.STORE_CONTACTS);
  }

  async liste(): Promise<Kontakt[]> {
    const zeilen = await this.#alle();
    const raus: Kontakt[] = [];
    for (const zeile of zeilen) raus.push(await beschreibe(zeile));
    return raus.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  /**
   * Was würde die Aufnahme dieses Schlüssels bedeuten?
   *
   * Bewusst getrennt vom Übernehmen: die Oberfläche soll erst zeigen können,
   * WAS passiert — vor allem, wenn es ein Schlüsselwechsel wäre.
   */
  async pruefe(armored: string | null, binaer: Uint8Array | null, name: string): Promise<KontaktAufnahme> {
    const key = await leseSchluessel(armored, binaer);
    const fingerprint = normalisiereFingerprint(key.getFingerprint());
    const zeilen = await this.#alle();

    const vorhanden = zeilen.find((z) => z.fingerprint === fingerprint);
    if (vorhanden !== undefined) return { art: 'bekannt', kontakt: await beschreibe(vorhanden) };

    const kandidat = await beschreibe(this.#neueZeile(key, fingerprint, name, []));

    // Gleicher Anzeigename oder gleiche Benutzerkennung, anderer Schlüssel.
    const kennungen = new Set(key.getUserIDs());
    const bisher = zeilen.find((z) =>
      z.name.trim().toLocaleLowerCase('de') === name.trim().toLocaleLowerCase('de') ||
      z.name.length > 0 && [...kennungen].some((k) => k.includes(z.name)));

    if (bisher !== undefined) {
      return { art: 'schluesselwechsel', kontakt: kandidat, bisher: await beschreibe(bisher) };
    }
    return { art: 'neu', kontakt: kandidat };
  }

  async uebernimm(armored: string | null, binaer: Uint8Array | null, name: string): Promise<Kontakt> {
    const key = await leseSchluessel(armored, binaer);
    const fingerprint = normalisiereFingerprint(key.getFingerprint());
    const zeilen = await this.#alle();

    const vorhanden = zeilen.find((z) => z.fingerprint === fingerprint);
    if (vorhanden !== undefined) {
      // Schon da: nur den Namen auffrischen, Vertrauen NICHT anfassen.
      const aktualisiert = { ...vorhanden, name: name.trim().length > 0 ? name.trim() : vorhanden.name };
      await idb.schreibe(this.#db, idb.STORE_CONTACTS, aktualisiert);
      return await beschreibe(aktualisiert);
    }

    // Bei einem Schlüsselwechsel die alte Kennung als Historie mitnehmen und
    // den alten Eintrag entfernen — zwei Einträge für eine Person verwirren.
    const alt = zeilen.find((z) => z.name.trim().toLocaleLowerCase('de') === name.trim().toLocaleLowerCase('de'));
    const historie = alt === undefined ? [] : [...alt.frühereFingerprints, alt.fingerprint];
    if (alt !== undefined) await idb.loesche(this.#db, idb.STORE_CONTACTS, alt.fingerprint);

    const zeile = this.#neueZeile(key, fingerprint, name, historie);
    await idb.schreibe(this.#db, idb.STORE_CONTACTS, zeile);
    return await beschreibe(zeile);
  }

  #neueZeile(
    key: PublicKey,
    fingerprint: string,
    name: string,
    historie: readonly string[],
  ): GespeicherterKontakt {
    const gewaehlt = name.trim();
    return {
      fingerprint,
      name: gewaehlt.length > 0 ? gewaehlt : (key.getUserIDs()[0] ?? fingerprint),
      armoredPublic: key.armor(),
      // ⚠️ IMMER unverifiziert. Ein neu aufgenommener Schlüssel ist nie geprüft,
      //    ganz gleich, woher er kam — auch nicht aus einem Einladungslink.
      vertrauen: 'unverifiziert',
      angelegtAm: new Date().toISOString(),
      verifiziertAm: null,
      frühereFingerprints: historie,
    };
  }

  async verifiziere(fingerprint: string, bestaetigt: boolean): Promise<Kontakt> {
    const normal = normalisiereFingerprint(fingerprint);
    const zeile = await idb.lies<GespeicherterKontakt>(this.#db, idb.STORE_CONTACTS, normal);
    if (zeile === undefined) throw new KlartextError('KEY_NOT_FOUND');
    const neu: GespeicherterKontakt = {
      ...zeile,
      vertrauen: bestaetigt ? 'verifiziert' : 'unverifiziert',
      verifiziertAm: bestaetigt ? new Date().toISOString() : null,
    };
    await idb.schreibe(this.#db, idb.STORE_CONTACTS, neu);
    return await beschreibe(neu);
  }

  async umbenennen(fingerprint: string, name: string): Promise<Kontakt> {
    const normal = normalisiereFingerprint(fingerprint);
    const zeile = await idb.lies<GespeicherterKontakt>(this.#db, idb.STORE_CONTACTS, normal);
    if (zeile === undefined) throw new KlartextError('KEY_NOT_FOUND');
    const neu = { ...zeile, name: name.trim().length > 0 ? name.trim() : zeile.name };
    await idb.schreibe(this.#db, idb.STORE_CONTACTS, neu);
    return await beschreibe(neu);
  }

  async loesche(fingerprint: string): Promise<Kontakt[]> {
    await idb.loesche(this.#db, idb.STORE_CONTACTS, normalisiereFingerprint(fingerprint));
    return await this.liste();
  }

  async armored(fingerprint: string): Promise<string> {
    const zeile = await idb.lies<GespeicherterKontakt>(
      this.#db, idb.STORE_CONTACTS, normalisiereFingerprint(fingerprint));
    if (zeile === undefined) throw new KlartextError('KEY_NOT_FOUND');
    return zeile.armoredPublic;
  }

  /** Alle Kontaktschlüssel — zum Prüfen von Signaturen. */
  async alleSchluessel(): Promise<PublicKey[]> {
    const zeilen = await this.#alle();
    const keys: PublicKey[] = [];
    for (const zeile of zeilen) {
      keys.push(await openpgp.readKey({ armoredKey: zeile.armoredPublic, config: READ_CONFIG }));
    }
    return keys;
  }
}
