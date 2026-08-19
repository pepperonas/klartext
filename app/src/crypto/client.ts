/**
 * Main-Thread-Seite des Krypto-Workers.
 *
 * ⚠️ Diese Datei darf `openpgp` niemals importieren — weder Wert noch Typ.
 *    `tests/no-crypto-in-main.test.ts` prueft das gegen den gebauten Bundle,
 *    nicht nur gegen die Quelle.
 */

import WORKER_URL from '../worker/index.ts?worker&url';
import { fromWire, KlartextError } from './errors.ts';
import type {
  AnyResponse,
  LockReason,
  Op,
  ReqBody,
  ResBody,
  VaultSettings,
  VaultStatus,
  WorkerEvent,
} from './protocol.ts';
import { STANDARD_EINSTELLUNGEN } from './protocol.ts';

type Aufloeser = { resolve: (wert: unknown) => void; reject: (fehler: unknown) => void };
type Beobachter = (status: VaultStatus) => void;

const LEERER_STATUS: VaultStatus = {
  state: 'empty',
  keyCount: 0,
  lockAt: null,
  lastLockReason: null,
};

/**
 * Trusted Types: der `Worker`-Konstruktor ist eine `TrustedScriptURL`-Senke.
 *
 * Die CSP verlangt `require-trusted-types-for 'script'`. Ohne Richtlinie
 * scheitert der Start mit "Failed to construct 'Worker'" — die App kommt gar
 * nicht hoch. Der E2E-Testserver sendet dieselbe CSP wie nginx, damit dieser
 * Fall nicht erst in Produktion auffaellt.
 *
 * ⚠️ Die Adresse kommt ueber `?worker&url` herein und NICHT ueber
 *    `new Worker(new URL('…', import.meta.url))`. Vites Worker-Erkennung haengt
 *    am woertlichen Muster: sobald das `new URL(…)` in eine Variable oder einen
 *    Funktionsaufruf wandert, haelt Vite es fuer ein gewoehnliches Asset und
 *    bettet die TypeScript-Quelle als base64-`data:`-URL in den Haupt-Bundle
 *    ein. Der Worker ist dann kein eigener Chunk mehr, und der Browser lehnt
 *    ihn unter `worker-src 'self'` ohnehin ab. Genau das ist hier passiert.
 *    `tests/no-crypto-in-main.test.ts` pinnt beides.
 *
 * Die Richtlinie laesst ausschliesslich diese eine Adresse durch — wer es je
 * schafft, eine andere hineinzureichen, bekommt eine Ausnahme statt eines
 * fremden Workers.
 */

interface TrustedTypesFabrik {
  createPolicy: (
    name: string,
    regeln: { createScriptURL: (eingabe: string) => string },
  ) => { createScriptURL: (eingabe: string) => string };
}

let politik: { createScriptURL: (eingabe: string) => string } | null = null;

function workerQuelle(): string {
  const fabrik = (globalThis as { trustedTypes?: TrustedTypesFabrik }).trustedTypes;
  if (fabrik === undefined) return WORKER_URL;

  // createPolicy wirft beim zweiten Aufruf mit demselben Namen.
  politik ??= fabrik.createPolicy('klartext-worker', {
    createScriptURL: (eingabe) => {
      if (eingabe !== WORKER_URL) {
        throw new Error('Nur der eigene Krypto-Worker darf geladen werden.');
      }
      return eingabe;
    },
  });
  return politik.createScriptURL(WORKER_URL);
}

export class CryptoClient {
  readonly #worker: Worker;
  readonly #offen = new Map<number, Aufloeser>();
  readonly #beobachter = new Set<Beobachter>();
  #naechsteId = 1;
  #status: VaultStatus = LEERER_STATUS;
  #einstellungen: VaultSettings = STANDARD_EINSTELLUNGEN;
  #versteckSeit: ReturnType<typeof setTimeout> | null = null;

  constructor(worker: Worker) {
    this.#worker = worker;
    this.#worker.addEventListener('message', (event: MessageEvent<AnyResponse>) => {
      this.#empfange(event.data);
    });
  }

  /**
   * Der Worker wird ueber `new URL(...)` erzeugt, damit Vite ihn als eigenen
   * Chunk ausgibt — das ist die Voraussetzung dafuer, dass openpgp gar nicht
   * erst im Haupt-Bundle landet.
   */
  static erzeuge(): CryptoClient {
    const worker = new Worker(workerQuelle(), { type: 'module', name: 'klartext-krypto' });
    return new CryptoClient(worker);
  }

  #empfange(nachricht: AnyResponse): void {
    if (nachricht.type === 'ready') return;

    if (nachricht.type === 'event') {
      this.#verarbeiteEreignis(nachricht.event);
      return;
    }

    const offen = this.#offen.get(nachricht.id);
    if (offen === undefined) return;
    this.#offen.delete(nachricht.id);

    if (nachricht.ok) offen.resolve(nachricht.result);
    else offen.reject(fromWire(nachricht.error));
  }

  #verarbeiteEreignis(event: WorkerEvent): void {
    this.#status = event.status;
    for (const b of this.#beobachter) b(event.status);
  }

  async ruf<K extends Op>(op: K, body: ReqBody<K>): Promise<ResBody<K>> {
    const id = this.#naechsteId++;
    const antwort = new Promise<unknown>((resolve, reject) => {
      this.#offen.set(id, { resolve, reject });
    });
    this.#worker.postMessage({ id, op, ...body });
    return (await antwort) as ResBody<K>;
  }

  // ------------------------------------------------------------- Beobachtung

  beobachte(fn: Beobachter): () => void {
    this.#beobachter.add(fn);
    fn(this.#status);
    return () => this.#beobachter.delete(fn);
  }

  get status(): VaultStatus {
    return this.#status;
  }

  async aktualisiereStatus(): Promise<VaultStatus> {
    const status = await this.ruf('vault.status', {});
    this.#verarbeiteEreignis({ kind: 'vault.changed', status });
    return status;
  }

  // ------------------------------------------------------------ Sperr-Logik

  /**
   * Verdrahtet die Ausloeser, die ein Worker nicht sehen kann.
   *
   * Zur Karenzzeit bei `hidden`: der Kern-Ablauf von Modus A ist
   * verschluesseln -> Tab wechseln -> woanders einfuegen. Bei 0 Sekunden sperrt
   * genau diese Handbewegung den Schluesselbund. Auf dem Schirm steht dann
   * Ciphertext, also nichts Schuetzenswertes. Wer es strenger will, stellt
   * `lockOnHiddenSeconds` auf 0 — die Einstellung ist da.
   */
  verdrahteSperrausloeser(ziel: Window = window): () => void {
    const beiAktivitaet = (): void => { void this.beruehre(); };
    const aktivitaeten = ['pointerdown', 'keydown', 'focus'] as const;
    for (const typ of aktivitaeten) ziel.addEventListener(typ, beiAktivitaet, { passive: true });

    const beiSichtwechsel = (): void => {
      if (ziel.document.visibilityState === 'hidden') {
        const sekunden = this.#einstellungen.lockOnHiddenSeconds;
        if (sekunden < 0) return;
        if (sekunden === 0) { void this.sperre('hidden'); return; }
        this.#versteckSeit = setTimeout(() => { void this.sperre('hidden'); }, sekunden * 1000);
      } else if (this.#versteckSeit !== null) {
        clearTimeout(this.#versteckSeit);
        this.#versteckSeit = null;
        void this.beruehre();
      }
    };
    ziel.document.addEventListener('visibilitychange', beiSichtwechsel);

    // `pagehide` statt `beforeunload`: letzteres feuert auf iOS unzuverlaessig
    // und verhindert dort obendrein den bfcache.
    const beiVerlassen = (): void => { void this.sperre('unload'); };
    ziel.addEventListener('pagehide', beiVerlassen);

    return () => {
      for (const typ of aktivitaeten) ziel.removeEventListener(typ, beiAktivitaet);
      ziel.document.removeEventListener('visibilitychange', beiSichtwechsel);
      ziel.removeEventListener('pagehide', beiVerlassen);
      if (this.#versteckSeit !== null) clearTimeout(this.#versteckSeit);
    };
  }

  // ---------------------------------------------------------------- Bequemes

  async entsperre(passphrase: string): Promise<VaultStatus> {
    return await this.ruf('vault.unlock', { passphrase });
  }

  async sperre(reason: LockReason): Promise<VaultStatus> {
    return await this.ruf('vault.lock', { reason });
  }

  async beruehre(): Promise<void> {
    if (this.#status.state !== 'unlocked') return;
    await this.ruf('vault.touch', {});
  }

  async ladeEinstellungen(): Promise<VaultSettings> {
    this.#einstellungen = await this.ruf('settings.get', {});
    return this.#einstellungen;
  }

  async setzeEinstellungen(settings: Partial<VaultSettings>): Promise<VaultSettings> {
    this.#einstellungen = await this.ruf('settings.set', { settings });
    return this.#einstellungen;
  }

  get einstellungen(): VaultSettings {
    return this.#einstellungen;
  }
}

export { KlartextError };
