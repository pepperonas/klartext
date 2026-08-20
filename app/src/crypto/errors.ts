/**
 * Geschlossene Fehlerliste mit deutschen Klartext-Meldungen.
 *
 * ⚠️ Meldungen der Bibliothek werden NIE durchgereicht: sie enthalten je nach
 *    Fall Paketstrukturen, Algorithmus-Interna oder Pfade. Der Originalfehler
 *    haengt an `cause` — der bleibt im Worker und wird nicht serialisiert.
 */

export type KlartextErrorCode =
  | 'VAULT_LOCKED'
  | 'VAULT_EMPTY'
  | 'WRONG_PASSPHRASE'
  | 'KEY_NOT_FOUND'
  | 'KEY_EXISTS'
  | 'NOT_A_KEY'
  | 'NOT_A_BACKUP'
  | 'NOT_A_SECRET_KEY'
  | 'NOT_A_MESSAGE'
  | 'NOT_A_SIGNATURE'
  | 'DECRYPT_FAILED'
  | 'NO_MATCHING_KEY'
  | 'SIGNATURE_INVALID'
  | 'PASSPHRASE_REQUIRED'
  | 'ARGON2_MEMORY'
  | 'UNSUPPORTED'
  | 'INTERNAL';

const MELDUNGEN: Readonly<Record<KlartextErrorCode, string>> = {
  VAULT_LOCKED: 'Der Schlüsselbund ist gesperrt. Bitte erst entsperren.',
  VAULT_EMPTY: 'Es liegt noch kein Schlüssel in diesem Browser.',
  WRONG_PASSPHRASE: 'Passphrase falsch.',
  KEY_NOT_FOUND: 'Diesen Schlüssel gibt es hier nicht.',
  KEY_EXISTS: 'Dieser Schlüssel liegt bereits im Schlüsselbund.',
  NOT_A_KEY: 'Das ist kein OpenPGP-Schlüssel.',
  NOT_A_BACKUP: 'Das ist keine klartext-Sicherung — oder eine aus einer anderen Fassung.',
  NOT_A_SECRET_KEY: 'Das ist ein öffentlicher Schlüssel — hier wird ein privater gebraucht.',
  NOT_A_MESSAGE: 'Das ist keine OpenPGP-Nachricht.',
  NOT_A_SIGNATURE: 'Das ist keine OpenPGP-Signatur.',
  DECRYPT_FAILED: 'Die Nachricht ließ sich nicht entschlüsseln.',
  NO_MATCHING_KEY: 'Für diese Nachricht liegt hier kein passender Schlüssel.',
  SIGNATURE_INVALID: 'Die Signatur stimmt nicht.',
  PASSPHRASE_REQUIRED: 'Dieser Schlüssel ist passphrase-geschützt.',
  ARGON2_MEMORY:
    'Für den Schlüsselschutz fehlt dem Browser Arbeitsspeicher. Versuche es mit einem schwächeren Profil.',
  UNSUPPORTED: 'Das unterstützt klartext nicht.',
  INTERNAL: 'Unerwarteter Fehler.',
};

export class KlartextError extends Error {
  readonly code: KlartextErrorCode;

  constructor(code: KlartextErrorCode, cause?: unknown) {
    super(MELDUNGEN[code], cause === undefined ? undefined : { cause });
    this.code = code;
    this.name = 'KlartextError';
  }
}

/** Wire-Form: nur Code und deutsche Meldung. Kein Stack, kein cause. */
export interface WireError {
  readonly code: KlartextErrorCode;
  readonly message: string;
}

export function toWire(error: unknown): WireError {
  const code = error instanceof KlartextError ? error.code : 'INTERNAL';
  return { code, message: MELDUNGEN[code] };
}

export function fromWire(error: WireError): KlartextError {
  return new KlartextError(error.code);
}

/**
 * Uebersetzt Bibliotheksfehler in unsere Codes. Bewusst konservativ: was nicht
 * sicher erkannt wird, ist INTERNAL — lieber eine unspezifische Meldung als
 * eine falsche Behauptung darueber, was schiefging.
 */
export function uebersetze(error: unknown, fallback: KlartextErrorCode = 'INTERNAL'): KlartextError {
  if (error instanceof KlartextError) return error;

  const text = error instanceof Error ? error.message : String(error);

  if (/Argon2|allocate required memory|grow memory|Out of memory/i.test(text)) {
    return new KlartextError('ARGON2_MEMORY', error);
  }
  if (/Incorrect key passphrase|Wrong (?:password|passphrase)|decryption failed/i.test(text)) {
    return new KlartextError('WRONG_PASSPHRASE', error);
  }
  if (/Session key decryption failed|No decryption key packets found/i.test(text)) {
    return new KlartextError('NO_MATCHING_KEY', error);
  }
  if (/Misformed armored text|Unknown ASCII armor type|CRC/i.test(text)) {
    return new KlartextError(fallback, error);
  }
  return new KlartextError(fallback, error);
}
