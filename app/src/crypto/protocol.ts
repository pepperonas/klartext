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

  /**
   * Modus B — der Zustellserver.
   *
   * ⚠️ Voreingestellt AUS. Er ist eine Bequemlichkeit, kein Sicherheitsgewinn;
   *    Modus A braucht keinen Server. Wer ihn einschaltet, soll das bewusst tun
   *    und dabei gelesen haben, was er über einen mitbekommt.
   */
  readonly relayAktiv: boolean;
  readonly relayUrl: string;
  /**
   * Lesetoken je Postfach-Kennung.
   *
   * ⚠️ Liegt UNVERSCHLÜSSELT in IndexedDB. Es berechtigt zum Abholen und
   *    Löschen von Ciphertext im eigenen Postfach — nicht zum Entschlüsseln.
   *    Wer die Browserdatenbank in die Hand bekommt, hat ohnehin den
   *    (verschlüsselten) privaten Schlüssel. Das steht so im Threat-Model.
   */
  readonly relayTokens: Readonly<Record<string, string>>;
}

export const STANDARD_EINSTELLUNGEN: VaultSettings = {
  autoLockMinutes: 15,
  lockOnHiddenSeconds: 30,
  relayAktiv: false,
  relayUrl: '',
  relayTokens: {},
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

  /** Was ist das? Grundlage dafür, dass die Oberfläche nicht raten muss. */
  'tool.erkenne': { req: { eingabe: string }; res: Erkennung };

  'tool.verschluessele': {
    req: {
      klartext: string;
      /** Eigene Schlüssel aus dem Bund. */
      anFingerprints: readonly string[];
      /** Zusätzlich eingefügte fremde öffentliche Schlüssel (armored). */
      anArmored: readonly string[];
      /** Fingerprint des eigenen Schlüssels zum Signieren, oder null. */
      signiereMit: string | null;
    };
    res: { armored: string };
  };

  'tool.entschluessele': {
    req: { armored: string; pruefeMit: readonly string[] };
    res: EntschluesseltesErgebnis;
  };

  'tool.signiere': {
    req: { text: string; fingerprint: string; abgetrennt: boolean };
    res: { armored: string };
  };

  'tool.pruefe': {
    req: { text: string; signatur: string | null; schluessel: readonly string[] };
    res: { signaturen: readonly SignaturBefund[]; klartext: string | null };
  };

  'datei.verschluessele': {
    req: {
      datei: File;
      anFingerprints: readonly string[];
      anArmored: readonly string[];
      signiereMit: string | null;
    };
    res: { daten: Uint8Array; dateiname: string };
  };

  'datei.entschluessele': {
    req: { datei: File; pruefeMit: readonly string[] };
    res: DateiErgebnis;
  };

  'kontakte.liste': { req: Record<never, never>; res: readonly Kontakt[] };
  /** Nimmt einen öffentlichen Schlüssel entgegen — armored oder binär. */
  'kontakte.pruefe': {
    req: { armored: string | null; binaer: Uint8Array | null; name: string };
    res: KontaktAufnahme;
  };
  'kontakte.uebernimm': {
    req: { armored: string | null; binaer: Uint8Array | null; name: string };
    res: Kontakt;
  };
  'kontakte.verifiziere': { req: { fingerprint: string; bestaetigt: boolean }; res: Kontakt };
  'kontakte.umbenennen': { req: { fingerprint: string; name: string }; res: Kontakt };
  'kontakte.loesche': { req: { fingerprint: string }; res: readonly Kontakt[] };
  /** Öffentlicher Schlüssel eines Kontakts, zum Verschlüsseln. */
  'kontakte.schluessel': { req: { fingerprint: string }; res: { armored: string } };
  /** Eigener öffentlicher Schlüssel binär — für den Einladungslink. */
  'keys.exportBinaer': { req: { fingerprint: string }; res: { daten: Uint8Array } };

  /** Signiert die Postfach-Herausforderung — braucht den privaten Schlüssel. */
  'relay.signiere': {
    req: { fingerprint: string; text: string };
    res: { signatur: string; schluessel: string };
  };

  'verlauf.liste': { req: { kontaktFp: string }; res: readonly EntfaltetesGespraech[] };
  'verlauf.lege': { req: { eintrag: VerlaufsEintrag }; res: readonly EntfaltetesGespraech[] };
  'verlauf.loesche': { req: { kontaktFp: string }; res: readonly EntfaltetesGespraech[] };
  /** Wie viele ungelesene je Kontakt — für die Kontaktliste. */
  'verlauf.zaehler': { req: Record<never, never>; res: Readonly<Record<string, number>> };
}

/** Was in einem eingefügten Block steckt — Grundlage der Werkzeug-Ansicht. */
export type BlockArt =
  | 'nachricht'          // -----BEGIN PGP MESSAGE-----
  | 'signierter-text'    // -----BEGIN PGP SIGNED MESSAGE-----
  | 'signatur'           // -----BEGIN PGP SIGNATURE----- (abgetrennt)
  | 'oeffentlicher-key'
  | 'privater-key'
  | 'klartext';          // gar kein OpenPGP

export interface Erkennung {
  readonly art: BlockArt;
  /** Kurzbeschreibung im Klartext, direkt anzeigbar. */
  readonly beschreibung: string;
  /** Bei Schlüsseln: Fingerprint und Benutzerkennungen. */
  readonly fingerprint: string | null;
  readonly userIds: readonly string[];
  /** Bei Nachrichten: an wen sie verschlüsselt wurde (Key-IDs, hex). */
  readonly empfaenger: readonly string[];
  /** true, wenn wir für mindestens einen Empfänger den Schlüssel haben. */
  readonly fuerUns: boolean;
}

export type SignaturZustand = 'gueltig' | 'ungueltig' | 'unbekannter-schluessel';

export interface SignaturBefund {
  readonly keyId: string;
  readonly zustand: SignaturZustand;
  /** Benutzerkennung des Unterzeichners, falls bekannt. */
  readonly wer: string | null;
  readonly fingerprint: string | null;
  readonly zeitpunkt: string | null;
}

export interface EntschluesseltesErgebnis {
  readonly klartext: string;
  readonly signaturen: readonly SignaturBefund[];
  /** Dateiname aus dem Literal-Paket, falls gesetzt. */
  readonly dateiname: string | null;
}

export interface DateiErgebnis {
  readonly daten: Uint8Array;
  readonly dateiname: string;
  readonly signaturen: readonly SignaturBefund[];
}

/**
 * Wie sicher ist, dass dieser Schlüssel wirklich der Person gehört?
 *
 * ⚠️ `unverifiziert` ist kein Makel, sondern der ehrliche Normalfall: über
 *    einen Kanal empfangene Schlüssel KÖNNEN untergeschoben sein. Die
 *    Oberfläche markiert das dauerhaft, nicht nur beim Anlegen.
 */
export type Vertrauen = 'unverifiziert' | 'verifiziert';

export interface Kontakt {
  readonly fingerprint: string;
  readonly name: string;
  readonly userIds: readonly string[];
  readonly algorithm: string;
  readonly bits: number | null;
  readonly curve: string | null;
  readonly vertrauen: Vertrauen;
  readonly angelegtAm: string;
  readonly verifiziertAm: string | null;
  readonly isRevoked: boolean;
  /** Fingerprints, unter denen diese Person früher bekannt war. */
  readonly frühereFingerprints: readonly string[];
  /** Wörter zum Vorlesen — vom Worker gerechnet, damit die Liste dort bleibt. */
  readonly woerter: readonly string[];
}

export type KontaktAufnahme =
  | { readonly art: 'neu'; readonly kontakt: Kontakt }
  | { readonly art: 'bekannt'; readonly kontakt: Kontakt }
  | {
      /**
       * ⚠️ Derselbe Name, ein ANDERER Schlüssel. Das ist entweder ein neuer
       *    Schlüssel derselben Person — oder jemand, der sich dazwischensetzt.
       *    Wird niemals stillschweigend übernommen.
       */
      readonly art: 'schluesselwechsel';
      readonly kontakt: Kontakt;
      readonly bisher: Kontakt;
    };

export type Richtung = 'ein' | 'aus';

/**
 * Eine Nachricht im lokalen Verlauf.
 *
 * ⚠️ Gespeichert wird der CIPHERTEXT, nicht der Klartext — und zwar ohne
 *    zusätzliche Schicht: eine Nachricht an mich ist per Definition an meinen
 *    Schlüssel verschlüsselt, eine von mir nehme ich als Empfänger mit auf.
 *    Der Verlauf ist damit im Ruhezustand verschlüsselt, ohne dass irgendwo
 *    eigene Kryptografie dazukäme. Lesen setzt einen entsperrten Bund voraus.
 */
export interface VerlaufsEintrag {
  readonly id: string;
  readonly kontaktFp: string;
  readonly richtung: Richtung;
  readonly ciphertext: string;
  readonly zeit: number;
  readonly zugestellt: boolean;
}

export interface EntfaltetesGespraech {
  readonly eintrag: VerlaufsEintrag;
  /** Klartext, falls entschlüsselbar; sonst null mit Begründung. */
  readonly klartext: string | null;
  readonly fehler: string | null;
  readonly signaturen: readonly SignaturBefund[];
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
