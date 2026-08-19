/**
 * Die beiden S2K-Profile aus PLAN.md §3.2.
 *
 * Der Unterschied ist der Kern des Kompatibilitaets-Kompromisses und in Phase 0
 * gegen echtes gpg gemessen:
 *
 *   Argon2id + AEAD  -> `gpg 2.5.21 --import` meldet "bearbeitete Schluessel: 0"
 *   iterated+salted  -> `gpg 2.5.21 --import` meldet "geheime Schluessel importiert: 1"
 *
 * Deshalb liegt im Vault das eine Format und im Export das andere. Der
 * Fingerprint bleibt dabei identisch, es ist derselbe Schluessel.
 */

import { enums, type PartialConfig } from 'openpgp';

/** Gemeinsame Praeferenzen: SHA-512 + AES-256, wie in PLAN.md §3.1 festgelegt. */
const BASIS = {
  preferredHashAlgorithm: enums.hash.sha512,
  preferredSymmetricAlgorithm: enums.symmetric.aes256,
  // Keine Bibliotheksversion und kein Kommentar in den Armor-Header: das ist
  // Fingerprinting-Material und sagt einem Angreifer, welche Luecken zu suchen sind.
  showVersion: false,
  showComment: false,
  v6Keys: false,
} as const satisfies PartialConfig;

/**
 * Ruhezustand in IndexedDB. Argon2id erzwingt AEAD — ohne das lehnt OpenPGP.js
 * mit "Using Argon2 S2K without AEAD is not allowed" ab.
 *
 * memoryExponent 16 = 64 MiB. Das ist die obere Kante dessen, was aeltere
 * Android-Geraete im Browser noch hergeben; die Rueckfallstufen stehen darunter.
 */
export const VAULT_CONFIG: PartialConfig = {
  ...BASIS,
  s2kType: enums.s2k.argon2,
  aeadProtect: true,
  s2kArgon2Params: { passes: 3, parallelism: 4, memoryExponent: 16 },
};

/**
 * Gestufter Rueckfall bei Argon2OutOfMemoryError: 64 -> 32 -> 16 MiB.
 * Wird nur beschritten, wenn der Browser den Speicher wirklich verweigert; der
 * Nutzer erfaehrt es, statt dass wir stillschweigend schwaecher werden.
 */
export const VAULT_CONFIG_FALLBACKS: readonly PartialConfig[] = [
  { ...VAULT_CONFIG, s2kArgon2Params: { passes: 3, parallelism: 4, memoryExponent: 15 } },
  { ...VAULT_CONFIG, s2kArgon2Params: { passes: 4, parallelism: 4, memoryExponent: 14 } },
];

/**
 * Export als .asc. iterated+salted mit maximalem Zaehler (255 -> ~65 Mio.
 * SHA-256-Runden), kein AEAD. Genau das, was `gpg --import` annimmt.
 *
 * Das ist schwaecher als der Vault. Der Export-Dialog sagt das im Klartext,
 * statt es zu verschweigen.
 */
export const EXPORT_CONFIG: PartialConfig = {
  ...BASIS,
  s2kType: enums.s2k.iterated,
  s2kIterationCountByte: 255,
  aeadProtect: false,
};

/** Lesen: tolerant gegenueber allem, was gpg und Altbestand erzeugen. */
export const READ_CONFIG: PartialConfig = {
  ...BASIS,
};
