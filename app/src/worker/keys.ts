/**
 * Schluesseloperationen. Reine Funktionen ohne Worker- oder DOM-Bezug, damit
 * sie in Node gegen die echten gpg-Fixtures laufen koennen.
 */

import * as openpgp from 'openpgp';
import type { PrivateKey, PublicKey } from 'openpgp';

import { KlartextError, uebersetze } from '../crypto/errors.ts';
import type { KeyAlgorithm, KeyInfo, UserId } from '../crypto/protocol.ts';
import {
  EXPORT_CONFIG,
  READ_CONFIG,
  VAULT_CONFIG,
  VAULT_CONFIG_FALLBACKS,
} from './openpgp-config.ts';

/** gpg zeigt Fingerprints in Grossbuchstaben; OpenPGP.js liefert sie klein. */
export function normalisiereFingerprint(fingerprint: string): string {
  return fingerprint.replace(/\s+/g, '').toUpperCase();
}

/** 40 Hex-Zeichen in 10 Gruppen zu 4 — die Form, in der man ihn vorliest. */
export function gruppiereFingerprint(fingerprint: string): string {
  return (normalisiereFingerprint(fingerprint).match(/.{1,4}/g) ?? []).join(' ');
}

/**
 * Schneidet den Armor-Block aus umgebendem Text heraus und entschaerft die
 * gpg-Sperre.
 *
 * Zwei Befunde aus dem Test gegen echtes GnuPG:
 *
 *  1. Ein `.rev`-Widerrufszertifikat traegt einen langen erklaerenden Vorspann
 *     (und zwar in der Sprache des Erzeugers — hier lag er auf Deutsch vor).
 *  2. gpg setzt vor die BEGIN-Zeile eines Widerrufszertifikats einen
 *     **Doppelpunkt**, damit es nicht versehentlich angewandt wird. Der Nutzer
 *     soll ihn von Hand entfernen. Wer das nicht weiss, bekommt von der
 *     Bibliothek nur "Unknown ASCII armor type" zu sehen.
 *
 * Beides faengt diese Funktion ab. Sie hilft darueber hinaus bei allem, was aus
 * einer E-Mail oder einem Chatfenster kopiert wurde und Zitatzeichen oder
 * Fliesstext um den Block herum mitbringt.
 */
export function entpackeArmorBlock(text: string): string {
  const zeilen = text.split(/\r?\n/);
  const beginn = zeilen.findIndex((z) => /^:?-----BEGIN PGP [A-Z0-9 ]+-----\s*$/.test(z));
  if (beginn === -1) return text;

  // Bei einer Klartext-Signatur (clearsign) folgt auf den SIGNED-MESSAGE-Block
  // noch der SIGNATURE-Block — dort zaehlt das LETZTE END, sonst das erste.
  const istClearsign = /SIGNED MESSAGE/.test(zeilen[beginn] ?? '');
  const endeRegex = /^-----END PGP [A-Z0-9 ]+-----\s*$/;
  const ende = istClearsign
    ? zeilen.findLastIndex((z) => endeRegex.test(z))
    : zeilen.findIndex((z, i) => i > beginn && endeRegex.test(z));
  if (ende === -1) return text;

  const block = zeilen.slice(beginn, ende + 1);
  // Die Schutz-Doppelpunkte entfernen, die gpg vor die Trennlinien setzt.
  return block.map((z) => z.replace(/^:(-----(?:BEGIN|END) PGP )/, '$1')).join('\n');
}

export async function beschreibeSchluessel(
  key: PublicKey,
  extra: { isDefault: boolean; label: string },
): Promise<KeyInfo> {
  const algo = key.getAlgorithmInfo();
  const ablauf = await key.getExpirationTime();

  return {
    fingerprint: normalisiereFingerprint(key.getFingerprint()),
    keyId: key.getKeyID().toHex().toUpperCase(),
    algorithm: algo.algorithm,
    bits: algo.bits ?? null,
    curve: algo.curve ?? null,
    userIds: key.getUserIDs(),
    created: key.getCreationTime().toISOString(),
    // getExpirationTime() liefert `Infinity` fuer "laeuft nie ab" — das ueberlebt
    // keine Serialisierung (JSON macht daraus null, structuredClone behaelt es).
    // Deshalb hier einmal sauber auf null normalisieren.
    expires: ablauf instanceof Date ? ablauf.toISOString() : null,
    isRevoked: await key.isRevoked(),
    isDefault: extra.isDefault,
    label: extra.label,
  };
}

export async function leseOeffentlich(armored: string): Promise<PublicKey> {
  try {
    return await openpgp.readKey({ armoredKey: entpackeArmorBlock(armored), config: READ_CONFIG });
  } catch (error) {
    throw uebersetze(error, 'NOT_A_KEY');
  }
}

/**
 * Liest einen privaten Schluessel und entsperrt ihn. Versteht beide S2K-Profile,
 * weil ein Import von gpg iterated+salted mitbringt und ein eigener Vault-Key
 * Argon2id.
 */
export async function leseUndEntsperre(armored: string, passphrase: string | null): Promise<PrivateKey> {
  let key: PrivateKey;
  try {
    key = await openpgp.readPrivateKey({ armoredKey: entpackeArmorBlock(armored), config: READ_CONFIG });
  } catch (error) {
    // readPrivateKey wirft auch bei einem gueltigen *oeffentlichen* Schluessel.
    // Der Unterschied ist fuer den Nutzer wichtig, also wird er geprueft.
    try {
      await openpgp.readKey({ armoredKey: entpackeArmorBlock(armored), config: READ_CONFIG });
      throw new KlartextError('NOT_A_SECRET_KEY', error);
    } catch (inner) {
      if (inner instanceof KlartextError) throw inner;
      throw uebersetze(error, 'NOT_A_KEY');
    }
  }

  if (key.isDecrypted()) return key;
  if (passphrase === null) throw new KlartextError('PASSPHRASE_REQUIRED');

  try {
    return await openpgp.decryptKey({ privateKey: key, passphrase, config: READ_CONFIG });
  } catch (error) {
    throw uebersetze(error, 'WRONG_PASSPHRASE');
  }
}

/**
 * Verschluesselt einen entsperrten Schluessel fuer den Vault (Argon2id + AEAD).
 * Faellt bei Speichermangel gestuft auf kleinere Argon2-Parameter zurueck,
 * statt die Schluesselerzeugung platzen zu lassen.
 */
export async function schuetzeFuerVault(key: PrivateKey, passphrase: string): Promise<string> {
  const profile = [VAULT_CONFIG, ...VAULT_CONFIG_FALLBACKS];
  let letzter: unknown;

  for (const config of profile) {
    try {
      const geschuetzt = await openpgp.encryptKey({ privateKey: key, passphrase, config });
      return geschuetzt.armor();
    } catch (error) {
      letzter = error;
      const meldung = error instanceof Error ? error.message : '';
      const speicherproblem = /Argon2|allocate|grow memory|Out of memory/i.test(meldung);
      if (!speicherproblem) throw uebersetze(error);
    }
  }
  throw uebersetze(letzter, 'ARGON2_MEMORY');
}

/**
 * Verschluesselt einen entsperrten Schluessel fuer den Export (iterated+salted).
 * Das ist das Format, das GnuPG annimmt — siehe openpgp-config.ts.
 */
export async function schuetzeFuerExport(key: PrivateKey, passphrase: string): Promise<string> {
  try {
    const geschuetzt = await openpgp.encryptKey({
      privateKey: key,
      passphrase,
      config: EXPORT_CONFIG,
    });
    return geschuetzt.armor();
  } catch (error) {
    throw uebersetze(error);
  }
}

export interface ErzeugtesSchluesselpaar {
  readonly armoredPublic: string;
  /** Bereits mit Argon2id + AEAD geschuetzt. */
  readonly armoredSecret: string;
  readonly revocationCertificate: string;
  readonly privateKey: PrivateKey;
}

export async function erzeugeSchluessel(
  algorithm: KeyAlgorithm,
  userId: UserId,
  passphrase: string,
): Promise<ErzeugtesSchluesselpaar> {
  // Zuerst OHNE Passphrase erzeugen und danach schuetzen: nur so greift der
  // gestufte Argon2-Rueckfall aus schuetzeFuerVault(). Wuerde `generateKey` die
  // Passphrase gleich mitnehmen, waere ein Speicherfehler das Ende des Vorgangs
  // und die teure RSA-Erzeugung waere umsonst gewesen.
  const optionen =
    algorithm === 'rsa4096'
      ? ({ type: 'rsa', rsaBits: 4096 } as const)
      : ({ type: 'ecc', curve: 'ed25519Legacy' } as const);

  let erzeugt;
  try {
    erzeugt = await openpgp.generateKey({
      ...optionen,
      userIDs: [{ name: userId.name, email: userId.email }],
      format: 'object',
      config: VAULT_CONFIG,
    });
  } catch (error) {
    throw uebersetze(error);
  }

  const armoredSecret = await schuetzeFuerVault(erzeugt.privateKey, passphrase);

  return {
    armoredPublic: erzeugt.publicKey.armor(),
    armoredSecret,
    revocationCertificate: erzeugt.revocationCertificate,
    privateKey: erzeugt.privateKey,
  };
}

/**
 * `getRevocationCertificate()` liefert `string | Stream<string>`. Der
 * Streaming-Fall tritt hier praktisch nie ein, aber "praktisch nie" ist kein
 * Typ — also wird er behandelt statt gecastet.
 */
async function sammleText(wert: openpgp.MaybeStream<string>): Promise<string> {
  if (typeof wert === 'string') return wert;
  const reader = (wert as ReadableStream<string>).getReader();
  const teile: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    teile.push(value);
  }
  return teile.join('');
}

/**
 * Erzeugt ein Widerrufszertifikat fuer einen entsperrten Schluessel.
 * Das Zertifikat allein widerruft nichts — es muss veroeffentlicht bzw.
 * angewandt werden. Das UI sagt das dazu.
 */
export async function erzeugeWiderrufszertifikat(key: PrivateKey): Promise<string> {
  try {
    const { publicKey } = await openpgp.revokeKey({ key, format: 'object', config: READ_CONFIG });
    const zertifikat = await publicKey.getRevocationCertificate();
    if (zertifikat === undefined) throw new KlartextError('INTERNAL');
    return await sammleText(zertifikat);
  } catch (error) {
    throw uebersetze(error);
  }
}

/** Wendet ein Widerrufszertifikat auf einen vorhandenen Schluessel an. */
export async function wendeWiderrufAn(key: PublicKey, revocationCertificate: string): Promise<PublicKey> {
  try {
    const { publicKey } = await openpgp.revokeKey({
      key,
      revocationCertificate: entpackeArmorBlock(revocationCertificate),
      format: 'object',
      config: READ_CONFIG,
    });
    return publicKey;
  } catch (error) {
    throw uebersetze(error, 'NOT_A_SIGNATURE');
  }
}
