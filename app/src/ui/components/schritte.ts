/**
 * Fortschrittsanzeige für den geführten Ablauf.
 *
 * Sie nennt die Schritte beim Namen, statt nur „3 von 6" zu zählen: wer weiß,
 * dass nach der Passphrase noch Widerruf und Backup kommen, klickt nicht in der
 * Annahme weiter, gleich fertig zu sein.
 */

import { el } from '../dom.ts';

export interface SchrittBeschreibung {
  readonly titel: string;
}

export class Schrittleiste {
  readonly wurzel = el('ol', { class: 'schrittleiste', 'aria-label': 'Fortschritt' });
  readonly #schritte: readonly SchrittBeschreibung[];

  constructor(schritte: readonly SchrittBeschreibung[]) {
    this.#schritte = schritte;
  }

  zeige(aktuell: number): HTMLElement {
    while (this.wurzel.firstChild !== null) this.wurzel.removeChild(this.wurzel.firstChild);
    this.#schritte.forEach((s, i) => {
      const nummer = i + 1;
      const zustand = nummer < aktuell ? 'erledigt' : nummer === aktuell ? 'aktuell' : 'offen';
      const punkt = el('li', { class: `schritt ${zustand}` },
        el('span', { class: 'schritt-nr', text: zustand === 'erledigt' ? '✓' : String(nummer), 'aria-hidden': 'true' }),
        el('span', { class: 'schritt-titel', text: s.titel }));
      if (zustand === 'aktuell') punkt.setAttribute('aria-current', 'step');
      this.wurzel.appendChild(punkt);
    });
    this.wurzel.setAttribute(
      'aria-label',
      `Schritt ${String(aktuell)} von ${String(this.#schritte.length)}: ${this.#schritte[aktuell - 1]?.titel ?? ''}`,
    );
    return this.wurzel;
  }
}
