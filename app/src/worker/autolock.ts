/**
 * Leerlauf-Sperre. Laeuft im Worker, weil dort der Vault liegt — der Timer soll
 * nicht davon abhaengen, ob der Main-Thread gerade beschaeftigt ist.
 *
 * Die Ausloeser "Tab versteckt" und "Seite wird verlassen" kann ein Worker nicht
 * sehen; die schickt der Main-Thread als ausdrueckliches `vault.lock`.
 */

export type LockCallback = () => void;

export class AutoLock {
  #timer: ReturnType<typeof setTimeout> | null = null;
  #minuten = 0;
  #lockAt: number | null = null;
  readonly #onLock: LockCallback;
  readonly #now: () => number;

  constructor(onLock: LockCallback, now: () => number = Date.now) {
    this.#onLock = onLock;
    this.#now = now;
  }

  /** 0 Minuten = nie automatisch sperren. */
  konfiguriere(minuten: number): void {
    this.#minuten = Math.max(0, minuten);
    if (this.#timer !== null) this.beruehre();
  }

  /** Nutzeraktivitaet: Frist von vorn. */
  beruehre(): void {
    this.stoppe();
    if (this.#minuten <= 0) return;
    const dauer = this.#minuten * 60_000;
    this.#lockAt = this.#now() + dauer;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#lockAt = null;
      this.#onLock();
    }, dauer);
  }

  stoppe(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#lockAt = null;
  }

  get lockAt(): number | null {
    return this.#lockAt;
  }
}
