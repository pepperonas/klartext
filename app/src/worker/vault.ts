/**
 * Der Schluesselbund.
 *
 * Zwei Regeln bestimmen den Aufbau:
 *
 *  1. Der entsperrte private Schluessel und die Passphrase existieren nur hier,
 *     im Worker, im Arbeitsspeicher. Nichts davon geht je nach draussen.
 *  2. Es gibt keine "Vault-Datei" und keinen selbstgebauten Passwort-Pruefwert.
 *     Der Zustand ergibt sich: keine Schluessel = leer, Schluessel ohne
 *     entsperrte Kopie im RAM = gesperrt. Die Passphrase wird dadurch geprueft,
 *     dass ein echter Schluessel damit aufgeht — nicht gegen ein Sentinel, das
 *     wir uns selbst ausgedacht haetten.
 */

import type { Key, PrivateKey, PublicKey } from 'openpgp';

import { KlartextError } from '../crypto/errors.ts';
import type {
  KeyAlgorithm,
  KeyInfo,
  LockReason,
  UserId,
  VaultSettings,
  VaultStatus,
} from '../crypto/protocol.ts';
import { STANDARD_EINSTELLUNGEN } from '../crypto/protocol.ts';

/**
 * Obergrenze für eine Beschriftung.
 *
 * ⚠️ Nicht Zierde: die Beschriftung wird angezeigt, und ein 10-kB-„Name"
 *    zerlegt jede Liste. Sie kommt aus dem Eingabefeld des Nutzers, also gilt
 *    sie als fremde Eingabe — auch wenn der Nutzer selbst sie tippt.
 */
const MAX_LABEL = 120;
import { AutoLock } from './autolock.ts';
import { Kontaktbuch } from './kontakte.ts';
import { Verlauf } from './verlauf.ts';
import * as idb from './idb.ts';
import * as sicherung from './sicherung.ts';
import { signiere as signiereText } from './werkzeug.ts';
import {
  beschreibeSchluessel,
  erzeugeSchluessel,
  erzeugeWiderrufszertifikat,
  leseOeffentlich,
  leseUndEntsperre,
  normalisiereFingerprint,
  schuetzeFuerExport,
  schuetzeFuerVault,
  wendeWiderrufAn,
} from './keys.ts';

interface GespeicherterSchluessel {
  readonly fingerprint: string;
  readonly label: string;
  readonly isDefault: boolean;
  readonly armoredPublic: string;
  /** Argon2id + AEAD. Absichtlich NICHT das Format, das gpg liest. */
  readonly armoredSecret: string;
  readonly importedAt: string;
  /** Wann der private Schlüssel zuletzt als Datei ausgegeben wurde. */
  readonly backupAt?: string | null;
  readonly widerrufAt?: string | null;
}

interface EinstellungsZeile {
  readonly key: 'vault';
  readonly value: VaultSettings;
}

export class Vault {
  #db: IDBDatabase | null = null;
  #passphrase: string | null = null;
  #entsperrt = new Map<string, PrivateKey>();
  #einstellungen: VaultSettings = STANDARD_EINSTELLUNGEN;
  #letzterGrund: LockReason | null = null;
  readonly #autoLock: AutoLock;
  readonly #beiAenderung: () => void;

  constructor(beiAenderung: () => void) {
    this.#beiAenderung = beiAenderung;
    this.#autoLock = new AutoLock(() => { this.sperre('idle'); });
  }

  #kontaktbuch: Kontaktbuch | null = null;
  #verlauf: Verlauf | null = null;

  /** Der Gesprächsverlauf teilt sich die Datenbank mit dem Schlüsselbund. */
  get verlauf(): Verlauf {
    this.#verlauf ??= new Verlauf(this.#datenbank);
    return this.#verlauf;
  }

  /** Das Kontaktbuch teilt sich die Datenbank mit dem Schlüsselbund. */
  get kontakte(): Kontaktbuch {
    this.#kontaktbuch ??= new Kontaktbuch(this.#datenbank);
    return this.#kontaktbuch;
  }

  async starte(): Promise<void> {
    this.#db = await idb.oeffne();
    const zeile = await idb.lies<EinstellungsZeile>(this.#db, idb.STORE_SETTINGS, 'vault');
    if (zeile !== undefined) {
      this.#einstellungen = { ...STANDARD_EINSTELLUNGEN, ...zeile.value };
    }
    this.#autoLock.konfiguriere(this.#einstellungen.autoLockMinutes);
  }

  /**
   * Gibt die IndexedDB-Verbindung frei und sperrt.
   *
   * Ohne das bleibt die Verbindung bis zum Ende des Realms offen — ein
   * `deleteDatabase()` (oder eine Schema-Migration in einem anderen Tab) wird
   * dadurch blockiert. Aufgefallen ist es in der Testsuite, wo mehrere Vaults
   * nacheinander entstehen; im Betrieb trifft es den Migrationspfad.
   */
  schliesse(): void {
    this.sperre('unload');
    this.#db?.close();
    this.#db = null;
  }

  get #datenbank(): IDBDatabase {
    if (this.#db === null) throw new KlartextError('INTERNAL');
    return this.#db;
  }

  // ---------------------------------------------------------------- Zustand

  async status(): Promise<VaultStatus> {
    const gespeichert = await this.#alleGespeicherten();
    const state = gespeichert.length === 0 ? 'empty' : this.#passphrase === null ? 'locked' : 'unlocked';
    return {
      state,
      keyCount: gespeichert.length,
      lockAt: state === 'unlocked' ? this.#autoLock.lockAt : null,
      lastLockReason: this.#letzterGrund,
    };
  }

  async einstellungen(): Promise<VaultSettings> {
    return await Promise.resolve(this.#einstellungen);
  }

  async setzeEinstellungen(teil: Partial<VaultSettings>): Promise<VaultSettings> {
    this.#einstellungen = { ...this.#einstellungen, ...teil };
    const zeile: EinstellungsZeile = { key: 'vault', value: this.#einstellungen };
    await idb.schreibe(this.#datenbank, idb.STORE_SETTINGS, zeile);
    this.#autoLock.konfiguriere(this.#einstellungen.autoLockMinutes);
    if (this.#passphrase !== null) this.#autoLock.beruehre();
    this.#beiAenderung();
    return this.#einstellungen;
  }

  // ------------------------------------------------------------ Auf und Zu

  /**
   * Entsperrt ALLE gespeicherten Schluessel. Nicht die faule Variante: solange
   * "entsperrt" auf dem Schirm steht, soll es auch fuer jeden Schluessel gelten.
   * Kosten: eine Argon2-Ableitung je Schluessel (~0,3 s bei 64 MiB).
   */
  async entsperre(passphrase: string): Promise<VaultStatus> {
    const gespeichert = await this.#alleGespeicherten();
    if (gespeichert.length === 0) throw new KlartextError('VAULT_EMPTY');

    const geoeffnet = new Map<string, PrivateKey>();
    for (const zeile of gespeichert) {
      geoeffnet.set(zeile.fingerprint, await leseUndEntsperre(zeile.armoredSecret, passphrase));
    }

    this.#entsperrt = geoeffnet;
    this.#passphrase = passphrase;
    this.#letzterGrund = null;
    this.#autoLock.beruehre();
    this.#beiAenderung();
    return await this.status();
  }

  /**
   * ⚠️ Ehrlichkeit an der Stelle, an der man gern schwindelt: JavaScript kann
   * Speicher nicht zuverlaessig ueberschreiben. Strings sind unveraenderlich,
   * die Freigabe entscheidet der GC. Wir lassen die Referenzen fallen und
   * verkleinern damit das Zeitfenster — mehr ist es nicht, und genau so steht
   * es auch im Info-Screen.
   */
  sperre(reason: LockReason): void {
    this.#entsperrt.clear();
    this.#passphrase = null;
    this.#letzterGrund = reason;
    this.#autoLock.stoppe();
    this.#beiAenderung();
  }

  beruehre(): void {
    if (this.#passphrase !== null) this.#autoLock.beruehre();
  }

  #fordereEntsperrt(): string {
    if (this.#passphrase === null) throw new KlartextError('VAULT_LOCKED');
    return this.#passphrase;
  }

  #privaterSchluessel(fingerprint: string): PrivateKey {
    this.#fordereEntsperrt();
    const key = this.#entsperrt.get(normalisiereFingerprint(fingerprint));
    if (key === undefined) throw new KlartextError('KEY_NOT_FOUND');
    return key;
  }

  // -------------------------------------------------------------- Schluessel

  async #alleGespeicherten(): Promise<GespeicherterSchluessel[]> {
    return await idb.alle<GespeicherterSchluessel>(this.#datenbank, idb.STORE_KEYS);
  }

  async liste(): Promise<KeyInfo[]> {
    const zeilen = await this.#alleGespeicherten();
    const infos: KeyInfo[] = [];
    for (const zeile of zeilen) {
      const oeffentlich = await leseOeffentlich(zeile.armoredPublic);
      infos.push(await beschreibeSchluessel(oeffentlich, {
        isDefault: zeile.isDefault,
        label: zeile.label,
        backupAt: zeile.backupAt ?? null,
        widerrufAt: zeile.widerrufAt ?? null,
      }));
    }
    return infos.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.created.localeCompare(b.created));
  }

  /**
   * Der erste Schluessel legt die Vault-Passphrase fest. Danach wird die im RAM
   * liegende benutzt und der Parameter ignoriert — es gibt nur EINE Passphrase
   * fuer den Schluesselbund, sonst waere der Sperr-Indikator eine Halbwahrheit.
   */
  async erzeuge(algorithm: KeyAlgorithm, userId: UserId, passphrase: string | null): Promise<{
    info: KeyInfo;
    revocationCertificate: string;
  }> {
    const vorhanden = await this.#alleGespeicherten();
    let benutzte: string;

    if (vorhanden.length === 0) {
      if (passphrase === null || passphrase.length === 0) throw new KlartextError('PASSPHRASE_REQUIRED');
      benutzte = passphrase;
    } else {
      benutzte = this.#fordereEntsperrt();
    }

    const erzeugt = await erzeugeSchluessel(algorithm, userId, benutzte);
    const fingerprint = normalisiereFingerprint(erzeugt.privateKey.getFingerprint());
    // Ohne Adresse darf hier kein "Martin <>" stehen. OpenPGP.js laesst eine
    // leere E-Mail von sich aus weg — die Beschriftung muss das mitmachen.
    const bezeichnung = userId.email.length > 0
      ? `${userId.name} <${userId.email}>`
      : userId.name;

    await this.#speichere({
      fingerprint,
      label: bezeichnung,
      isDefault: vorhanden.length === 0,
      armoredPublic: erzeugt.armoredPublic,
      armoredSecret: erzeugt.armoredSecret,
      importedAt: new Date().toISOString(),
    });

    // Der frisch erzeugte Schluessel ist bereits entsperrt — er wandert direkt
    // in den RAM, damit der erste Schluessel den Vault auch gleich oeffnet.
    this.#entsperrt.set(fingerprint, erzeugt.privateKey);
    this.#passphrase = benutzte;
    this.#autoLock.beruehre();
    this.#beiAenderung();

    const info = await beschreibeSchluessel(erzeugt.privateKey.toPublic(), {
      isDefault: vorhanden.length === 0,
      label: bezeichnung,
    });

    return { info, revocationCertificate: erzeugt.revocationCertificate };
  }

  /**
   * Import aus gpg oder einem Backup. Der Schluessel wird mit SEINER Passphrase
   * geoeffnet und mit der VAULT-Passphrase neu geschuetzt — ab da gilt hier
   * eine Passphrase fuer alles.
   */
  async importiere(armored: string, passphrase: string | null): Promise<KeyInfo> {
    const vorhanden = await this.#alleGespeicherten();
    if (vorhanden.length === 0) throw new KlartextError('VAULT_EMPTY');
    const vaultPassphrase = this.#fordereEntsperrt();

    const key = await leseUndEntsperre(armored, passphrase);
    const fingerprint = normalisiereFingerprint(key.getFingerprint());
    if (vorhanden.some((z) => z.fingerprint === fingerprint)) throw new KlartextError('KEY_EXISTS');

    const armoredSecret = await schuetzeFuerVault(key, vaultPassphrase);
    const label = key.getUserIDs()[0] ?? fingerprint;

    await this.#speichere({
      fingerprint,
      label,
      isDefault: false,
      armoredPublic: key.toPublic().armor(),
      armoredSecret,
      importedAt: new Date().toISOString(),
    });
    this.#entsperrt.set(fingerprint, key);
    this.#beiAenderung();

    return await beschreibeSchluessel(key.toPublic(), { isDefault: false, label });
  }

  async exportiere(
    fingerprint: string,
    secret: boolean,
    exportPassphrase: string | null,
  ): Promise<{ armored: string; filename: string; gpgCompatible: boolean }> {
    const normal = normalisiereFingerprint(fingerprint);
    const zeile = await idb.lies<GespeicherterSchluessel>(this.#datenbank, idb.STORE_KEYS, normal);
    if (zeile === undefined) throw new KlartextError('KEY_NOT_FOUND');

    const kurz = normal.slice(-16);

    if (!secret) {
      return {
        armored: zeile.armoredPublic,
        filename: `klartext-${kurz}.pub.asc`,
        gpgCompatible: true,
      };
    }

    if (exportPassphrase === null || exportPassphrase.length === 0) {
      throw new KlartextError('PASSPHRASE_REQUIRED');
    }
    const key = this.#privaterSchluessel(normal);
    const armored = await schuetzeFuerExport(key, exportPassphrase);
    // Erst nach dem erfolgreichen Verschlüsseln vermerken — sonst stünde
    // „gesichert" da, obwohl der Vorgang gescheitert ist.
    await this.#speichere({ ...zeile, backupAt: new Date().toISOString() });
    this.#beiAenderung();
    return {
      armored,
      filename: `klartext-${kurz}.sec.asc`,
      gpgCompatible: true,
    };
  }

  /** Der eigene öffentliche Schlüssel binär — für den Einladungslink. */
  async binaerOeffentlich(fingerprint: string): Promise<Uint8Array> {
    const zeile = await idb.lies<GespeicherterSchluessel>(
      this.#datenbank, idb.STORE_KEYS, normalisiereFingerprint(fingerprint));
    if (zeile === undefined) throw new KlartextError('KEY_NOT_FOUND');
    const key = await leseOeffentlich(zeile.armoredPublic);
    return key.write();
  }

  /**
   * Signiert die Postfach-Herausforderung und gibt den öffentlichen Schlüssel
   * dazu — der Server braucht beides, um die Bindung selbst nachzurechnen.
   */
  async signiereFuerRelay(fingerprint: string, text: string): Promise<{ signatur: string; schluessel: string }> {
    const privat = this.#privaterSchluessel(fingerprint);
    return {
      // abgetrennt: der Server prüft die Signatur gegen den Text, den er selbst bildet.
      signatur: await signiereText(text, privat, true),
      schluessel: privat.toPublic().armor(),
    };
  }

  async widerrufszertifikat(fingerprint: string): Promise<string> {
    const normal = normalisiereFingerprint(fingerprint);
    const armored = await erzeugeWiderrufszertifikat(this.#privaterSchluessel(normal));
    // Erst nach dem erfolgreichen Erzeugen vermerken — wie beim Backup: ein
    // Haken an einer gescheiterten Handlung wäre schlimmer als kein Haken.
    const zeile = (await this.#alleGespeicherten()).find((z) => z.fingerprint === normal);
    if (zeile !== undefined) {
      await this.#speichere({ ...zeile, widerrufAt: new Date().toISOString() });
      this.#beiAenderung();
    }
    return armored;
  }

  async wendeWiderrufAn(armored: string): Promise<KeyInfo> {
    const zeilen = await this.#alleGespeicherten();
    for (const zeile of zeilen) {
      const oeffentlich = await leseOeffentlich(zeile.armoredPublic);
      try {
        const widerrufen = await wendeWiderrufAn(oeffentlich, armored);
        if (!(await widerrufen.isRevoked())) continue;
        await this.#speichere({ ...zeile, armoredPublic: widerrufen.armor() });
        this.#beiAenderung();
        return await beschreibeSchluessel(widerrufen, {
          isDefault: zeile.isDefault,
          label: zeile.label,
        });
      } catch {
        // Zertifikat gehoert zu einem anderen Schluessel — naechsten probieren.
      }
    }
    throw new KlartextError('KEY_NOT_FOUND');
  }

  async loesche(fingerprint: string): Promise<KeyInfo[]> {
    const normal = normalisiereFingerprint(fingerprint);
    await idb.loesche(this.#datenbank, idb.STORE_KEYS, normal);
    this.#entsperrt.delete(normal);

    // Ohne Standardschluessel steht die App ohne Absender da — der aelteste
    // verbleibende rueckt nach.
    const rest = await this.#alleGespeicherten();
    if (rest.length > 0 && !rest.some((z) => z.isDefault)) {
      const ersatz = rest.reduce((a, b) => (a.importedAt <= b.importedAt ? a : b));
      await this.#speichere({ ...ersatz, isDefault: true });
    }
    if (rest.length === 0) this.sperre('manual');
    this.#beiAenderung();
    return await this.liste();
  }

  async setzeStandard(fingerprint: string): Promise<KeyInfo[]> {
    const normal = normalisiereFingerprint(fingerprint);
    const zeilen = await this.#alleGespeicherten();
    if (!zeilen.some((z) => z.fingerprint === normal)) throw new KlartextError('KEY_NOT_FOUND');
    for (const zeile of zeilen) {
      await this.#speichere({ ...zeile, isDefault: zeile.fingerprint === normal });
    }
    this.#beiAenderung();
    return await this.liste();
  }

  /**
   * Setzt die örtliche Beschriftung. Der Schlüssel bleibt unangetastet.
   *
   * Eine leere Eingabe stellt die User-ID wieder her, statt eine namenlose
   * Zeile zu hinterlassen — „" ist keine Beschriftung, sondern ein Loch.
   */
  async beschrifte(fingerprint: string, label: string): Promise<KeyInfo[]> {
    const normal = normalisiereFingerprint(fingerprint);
    const zeilen = await this.#alleGespeicherten();
    const zeile = zeilen.find((z) => z.fingerprint === normal);
    if (zeile === undefined) throw new KlartextError('KEY_NOT_FOUND');

    const sauber = label.trim().slice(0, MAX_LABEL);
    const oeffentlich = await leseOeffentlich(zeile.armoredPublic);
    await this.#speichere({
      ...zeile,
      label: sauber.length > 0 ? sauber : (oeffentlich.getUserIDs()[0] ?? normal),
    });
    this.#beiAenderung();
    return await this.liste();
  }

  /** Vollsicherung erzeugen — siehe worker/sicherung.ts. */
  async sicherungErzeuge(fingerprint: string): Promise<{
    armored: string; filename: string; kontakte: number; nachrichten: number;
  }> {
    const normal = normalisiereFingerprint(fingerprint);
    const privat = this.#privaterSchluessel(normal);
    const armored = await sicherung.erzeuge(this.#datenbank, privat.toPublic(), privat);
    return {
      armored,
      filename: `klartext-sicherung-${normal.slice(-16)}.asc`,
      kontakte: (await idb.alle(this.#datenbank, idb.STORE_CONTACTS)).length,
      nachrichten: (await idb.alle(this.#datenbank, idb.STORE_MESSAGES)).length,
    };
  }

  /** Vollsicherung einspielen — ergänzend, nie ersetzend. */
  async sicherungSpieleEin(armored: string): Promise<sicherung.Einspielbericht> {
    this.#fordereEntsperrt();
    // Alle entsperrten Schlüssel, nicht nur der Standard: eine Sicherung kann
    // an einen älteren Schlüssel gerichtet sein, den es noch gibt.
    const bericht = await sicherung.spieleEin(this.#datenbank, armored, [...this.#entsperrt.values()]);
    this.#beiAenderung();
    return bericht;
  }

  async #speichere(zeile: GespeicherterSchluessel): Promise<void> {
    await idb.schreibe(this.#datenbank, idb.STORE_KEYS, zeile);
  }

  // ------------------------------------------------------- fürs Werkzeug

  /** Alle eigenen öffentlichen Schlüssel — auch bei gesperrtem Bund lesbar. */
  async oeffentliche(): Promise<PublicKey[]> {
    const zeilen = await this.#alleGespeicherten();
    const keys: PublicKey[] = [];
    for (const zeile of zeilen) keys.push(await leseOeffentlich(zeile.armoredPublic));
    return keys;
  }

  /** Öffentliche Schlüssel zu bestimmten Fingerprints aus dem eigenen Bund. */
  async oeffentlicheZu(fingerprints: readonly string[]): Promise<PublicKey[]> {
    const gesucht = new Set(fingerprints.map(normalisiereFingerprint));
    const zeilen = await this.#alleGespeicherten();
    const keys: PublicKey[] = [];
    for (const zeile of zeilen) {
      if (gesucht.has(zeile.fingerprint)) keys.push(await leseOeffentlich(zeile.armoredPublic));
    }
    if (keys.length !== gesucht.size) throw new KlartextError('KEY_NOT_FOUND');
    return keys;
  }

  /** Alle entsperrten privaten Schlüssel — zum Entschlüsseln. */
  entsperrteSchluessel(): PrivateKey[] {
    this.#fordereEntsperrt();
    return [...this.#entsperrt.values()];
  }

  /** Einer davon, zum Signieren. */
  zumSignieren(fingerprint: string): PrivateKey {
    return this.#privaterSchluessel(fingerprint);
  }

  /**
   * Prüfschlüssel: die eigenen, ALLE Kontakte und zusätzlich eingefügte.
   *
   * Die Kontakte gehören dazu — sonst stünde bei jeder Nachricht eines
   * Freundes „Unterzeichner unbekannt", obwohl sein Schlüssel danebenliegt.
   */
  async pruefSchluessel(zusaetzlich: readonly string[]): Promise<Key[]> {
    const alle: Key[] = await this.oeffentliche();
    alle.push(...(await this.kontakte.alleSchluessel()));
    for (const armored of zusaetzlich) alle.push(await leseOeffentlich(armored));
    return alle;
  }
}
