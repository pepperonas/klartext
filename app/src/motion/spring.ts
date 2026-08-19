/**
 * Feder-Integrator. Material-3-Expressive setzt auf Physik statt auf
 * Beschleunigungskurven: eine Feder kann jederzeit ein neues Ziel bekommen und
 * behaelt dabei ihre Geschwindigkeit — eine `transition` muesste dafuer
 * neu starten und wirkt darum abgehackt.
 *
 * Bewusst ohne Bibliothek: es sind 40 Zeilen, und jede Abhaengigkeit in dieser
 * App muss begruendet werden.
 */

import { FEDERN, type Federname } from '../design/tokens.ts';

export interface FederOptionen {
  readonly art?: Federname;
  readonly start?: number;
  /** Naeher als das gilt als angekommen. */
  readonly toleranz?: number;
}

export type FederAbnehmer = (wert: number) => void;

export class Feder {
  #wert: number;
  #ziel: number;
  #geschwindigkeit = 0;
  #laeuft = false;
  #letzteZeit = 0;
  readonly #art: Federname;
  readonly #toleranz: number;
  readonly #abnehmer: FederAbnehmer;

  constructor(abnehmer: FederAbnehmer, optionen: FederOptionen = {}) {
    this.#abnehmer = abnehmer;
    this.#art = optionen.art ?? 'weich';
    this.#wert = optionen.start ?? 0;
    this.#ziel = this.#wert;
    this.#toleranz = optionen.toleranz ?? 0.001;
  }

  get wert(): number {
    return this.#wert;
  }

  /** Springt ohne Bewegung — fuer `prefers-reduced-motion` und Erststand. */
  setze(wert: number): void {
    this.#wert = wert;
    this.#ziel = wert;
    this.#geschwindigkeit = 0;
    this.#abnehmer(wert);
  }

  ziel(wert: number): void {
    this.#ziel = wert;
    if (ruhigeDarstellung()) { this.setze(wert); return; }
    if (!this.#laeuft) {
      this.#laeuft = true;
      this.#letzteZeit = performance.now();
      requestAnimationFrame(this.#schritt);
    }
  }

  stoppe(): void {
    this.#laeuft = false;
  }

  readonly #schritt = (jetzt: number): void => {
    if (!this.#laeuft) return;
    // Grosse Zeitspruenge (Tab war im Hintergrund) wuerden die Integration
    // sprengen — deshalb gedeckelt.
    const dt = Math.min((jetzt - this.#letzteZeit) / 1000, 1 / 30);
    this.#letzteZeit = jetzt;

    const { steifigkeit, daempfung, masse } = FEDERN[this.#art];
    const kraft = -steifigkeit * (this.#wert - this.#ziel) - daempfung * this.#geschwindigkeit;
    this.#geschwindigkeit += (kraft / masse) * dt;
    this.#wert += this.#geschwindigkeit * dt;

    const angekommen =
      Math.abs(this.#wert - this.#ziel) < this.#toleranz && Math.abs(this.#geschwindigkeit) < this.#toleranz;
    if (angekommen) {
      this.#wert = this.#ziel;
      this.#geschwindigkeit = 0;
      this.#laeuft = false;
    }
    this.#abnehmer(this.#wert);
    if (this.#laeuft) requestAnimationFrame(this.#schritt);
  };
}

export function ruhigeDarstellung(): boolean {
  // `matchMedia` gibt es im Main-Thread immer — dieses Modul wird aber auch von
  // Umgebungen ohne DOM geladen (Tests). Deshalb der Vorhandenseins-Test.
  if (!('matchMedia' in globalThis)) return false;
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
