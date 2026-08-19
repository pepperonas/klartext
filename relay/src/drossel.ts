/**
 * Drosselung — pro IP und pro Postfach.
 *
 * ⚠️ Die IP steht ausschliesslich hier, im Arbeitsspeicher, als Schlüssel eines
 *    Zählers. Sie wird nirgends protokolliert, nirgends gespeichert und nach
 *    Ablauf des Fensters vergessen. Ein Relay, das IPs auf Platte schreibt,
 *    wäre kein Zero-Knowledge-Briefkasten, sondern ein Bewegungsprofil.
 */

interface Eimer {
  tropfen: number;
  zuletzt: number;
}

export class Drossel {
  readonly #eimer = new Map<string, Eimer>();
  readonly #kapazitaet: number;
  readonly #nachfuellProSekunde: number;

  constructor(kapazitaet: number, fensterSekunden: number) {
    this.#kapazitaet = kapazitaet;
    this.#nachfuellProSekunde = kapazitaet / fensterSekunden;
  }

  /** true = erlaubt. Verbraucht dabei einen Tropfen. */
  erlaubt(schluessel: string, jetzt: number): boolean {
    const eimer = this.#eimer.get(schluessel) ?? { tropfen: this.#kapazitaet, zuletzt: jetzt };
    const vergangen = Math.max(0, (jetzt - eimer.zuletzt) / 1000);
    eimer.tropfen = Math.min(this.#kapazitaet, eimer.tropfen + vergangen * this.#nachfuellProSekunde);
    eimer.zuletzt = jetzt;

    if (eimer.tropfen < 1) {
      this.#eimer.set(schluessel, eimer);
      return false;
    }
    eimer.tropfen -= 1;
    this.#eimer.set(schluessel, eimer);
    return true;
  }

  /** Volle Eimer vergessen — sonst wächst die Karte unbegrenzt. */
  raeumeAuf(jetzt: number): void {
    for (const [schluessel, eimer] of this.#eimer) {
      const vergangen = (jetzt - eimer.zuletzt) / 1000;
      if (eimer.tropfen + vergangen * this.#nachfuellProSekunde >= this.#kapazitaet) {
        this.#eimer.delete(schluessel);
      }
    }
  }

  get groesse(): number { return this.#eimer.size; }
}
