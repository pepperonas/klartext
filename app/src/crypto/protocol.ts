/**
 * Vertrag zwischen Main-Thread und Krypto-Worker.
 *
 * ⚠️ Diese Datei importiert NICHTS aus `openpgp` — auch keine Typen. Sie ist die
 *    Grenze, an der der Main-Thread aufhoert, etwas ueber Schluesselmaterial zu
 *    wissen. `tests/no-crypto-in-main.test.ts` haelt das fest.
 */

import type { WireError } from './errors.ts';

export type KeyAlgorithm = 'rsa4096' | 'curve25519';

export interface UserId {
  readonly name: string;
  readonly email: string;
}

/**
 * Alles, was der Main-Thread ueber einen Schluessel wissen darf.
 * Bewusst `| null` statt optionaler Felder: ein Wire-Format soll vollstaendig
 * sein, nicht teilweise vorhanden.
 */
export interface KeyInfo {
  readonly fingerprint: string;
  readonly keyId: string;
  readonly algorithm: string;
  readonly bits: number | null;
  readonly curve: string | null;
  readonly userIds: readonly string[];
  readonly created: string;
  readonly expires: string | null;
  readonly isRevoked: boolean;
  readonly isDefault: boolean;
  readonly label: string;
  /**
   * Wurde der private Schlüssel je als Datei ausgegeben?
   *
   * Die Passphrase ist KEIN Backup — sie entsperrt einen gespeicherten
   * Schlüssel, sie stellt ihn nicht wieder her. Ohne Sicherungsdatei ist er
   * nach gelöschten Browserdaten verloren. Deshalb merkt sich der Vault das
   * und die Oberfläche sagt es, bis es erledigt ist.
   */
  readonly hasBackup: boolean;
  /** ISO-Zeitstempel der letzten Sicherung, sonst null. */
  readonly backupAt: string | null;
}

export type VaultState = 'empty' | 'locked' | 'unlocked';

export type LockReason = 'manual' | 'idle' | 'hidden' | 'unload' | 'error';

export interface VaultStatus {
  readonly state: VaultState;
  readonly keyCount: number;
  /** Zeitstempel (epoch ms), zu dem automatisch gesperrt wird. null wenn gesperrt oder nie. */
  readonly lockAt: number | null;
  readonly lastLockReason: LockReason | null;
}

export interface VaultSettings {
  /** Leerlauf bis zur Sperre, in Minuten. 0 = nie. */
  readonly autoLockMinutes: number;
  /** Karenz in Sekunden nach Tab-Wechsel. 0 = sofort, -1 = nie sperren. */
  readonly lockOnHiddenSeconds: number;
}

export const STANDARD_EINSTELLUNGEN: VaultSettings = {
  autoLockMinutes: 15,
  lockOnHiddenSeconds: 30,
};

/** Ergebnis einer Schluesselerzeugung. Der private Teil bleibt im Worker. */
export interface GeneratedKey {
  readonly info: KeyInfo;
  /** Widerrufszertifikat — muss der Nutzer sofort woanders sichern. */
  readonly revocationCertificate: string;
}

export interface ExportResult {
  readonly armored: string;
  readonly filename: string;
  /** true, wenn der Export mit iterated+salted geschrieben wurde (GnuPG-lesbar). */
  readonly gpgCompatible: boolean;
}

/**
 * op -> { req, res }. Aus dieser Tabelle werden Request- und Response-Typen
 * abgeleitet, damit ein neuer Aufruf nicht an drei Stellen gepflegt werden muss.
 */
export interface Ops {
  'vault.status': { req: Record<never, never>; res: VaultStatus };
  'vault.unlock': { req: { passphrase: string }; res: VaultStatus };
  'vault.lock': { req: { reason: LockReason }; res: VaultStatus };
  'vault.touch': { req: Record<never, never>; res: VaultStatus };
  'settings.get': { req: Record<never, never>; res: VaultSettings };
  'settings.set': { req: { settings: Partial<VaultSettings> }; res: VaultSettings };

  'keys.list': { req: Record<never, never>; res: readonly KeyInfo[] };
  'keys.generate': {
    req: { algorithm: KeyAlgorithm; userId: UserId; passphrase: string | null };
    res: GeneratedKey;
  };
  'keys.import': { req: { armored: string; passphrase: string | null }; res: KeyInfo };
  'keys.export': {
    req: { fingerprint: string; secret: boolean; exportPassphrase: string | null };
    res: ExportResult;
  };
  'keys.delete': { req: { fingerprint: string }; res: readonly KeyInfo[] };
  'keys.setDefault': { req: { fingerprint: string }; res: readonly KeyInfo[] };
  'keys.revocationCertificate': { req: { fingerprint: string }; res: { armored: string } };
  'keys.applyRevocation': { req: { armored: string }; res: KeyInfo };
}

export type Op = keyof Ops;
export type ReqBody<K extends Op> = Ops[K]['req'];
export type ResBody<K extends Op> = Ops[K]['res'];

export type RequestFor<K extends Op> = { readonly id: number; readonly op: K } & ReqBody<K>;
export type AnyRequest = { [K in Op]: RequestFor<K> }[Op];

export type WorkerEvent = { readonly kind: 'vault.changed'; readonly status: VaultStatus };

export type AnyResponse =
  | { readonly type: 'reply'; readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly type: 'reply'; readonly id: number; readonly ok: false; readonly error: WireError }
  | { readonly type: 'event'; readonly event: WorkerEvent }
  | { readonly type: 'ready' };
