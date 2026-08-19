/**
 * Passwortfeld mit Sichtbarkeits-Schalter.
 *
 * ⚠️ Der Grund ist nicht Bequemlichkeit, sondern ein Widerspruch im eigenen
 *    Ablauf: die App sagt „schreib die Passphrase auf, bevor du weitermachst" —
 *    und versteckte sie im selben Moment hinter Punkten. Abschreiben ging damit
 *    nicht. Ein vorgeschlagenes Geheimnis, das man nicht lesen kann, ist ein
 *    verlorener Schlüssel auf Raten.
 *
 * Voreinstellung bleibt verdeckt (jemand könnte mitlesen), aber sichtbar machen
 * ist immer einen Klick entfernt — und nach einem übernommenen Vorschlag wird
 * es von selbst aufgedeckt, weil genau dann abgeschrieben wird.
 */

import { el } from '../dom.ts';

export interface PasswortFeldOptionen {
  readonly id: string;
  readonly beschriftung: string;
  readonly hinweis?: string;
  readonly autocomplete?: string;
}

export class PasswortFeld {
  readonly wurzel: HTMLElement;
  readonly eingabe: HTMLInputElement;
  readonly #schalter: HTMLButtonElement;
  readonly #beschriftung: string;

  constructor(optionen: PasswortFeldOptionen) {
    this.#beschriftung = optionen.beschriftung;

    this.eingabe = el('input', {
      id: optionen.id,
      type: 'password',
      autocomplete: optionen.autocomplete ?? 'off',
      spellcheck: 'false',
      autocapitalize: 'off',
      autocorrect: 'off',
    });

    this.#schalter = el('button', {
      class: 'sichtschalter',
      type: 'button',
      'aria-pressed': 'false',
    });
    this.#schalter.appendChild(auge(false));
    this.#beschrifteSchalter();
    this.#schalter.addEventListener('click', () => { this.umschalten(); });

    this.wurzel = el(
      'div',
      { class: 'feld' },
      el('label', { for: optionen.id, text: optionen.beschriftung }),
      el('div', { class: 'feld-mit-schalter' }, this.eingabe, this.#schalter),
      optionen.hinweis === undefined ? null : el('p', { class: 'hinweis', text: optionen.hinweis }),
    );
  }

  get sichtbar(): boolean {
    return this.eingabe.type === 'text';
  }

  zeige(sichtbar: boolean): void {
    this.eingabe.type = sichtbar ? 'text' : 'password';
    // Monospace, sobald man das Material sieht — dieselbe Regel wie bei
    // Ciphertext und Fingerprints.
    this.eingabe.classList.toggle('sichtbar', sichtbar);
    this.#schalter.setAttribute('aria-pressed', sichtbar ? 'true' : 'false');
    while (this.#schalter.firstChild !== null) this.#schalter.removeChild(this.#schalter.firstChild);
    this.#schalter.appendChild(auge(sichtbar));
    this.#beschrifteSchalter();
  }

  umschalten(): void {
    this.zeige(!this.sichtbar);
  }

  get wert(): string {
    return this.eingabe.value;
  }

  set wert(text: string) {
    this.eingabe.value = text;
  }

  #beschrifteSchalter(): void {
    const text = this.sichtbar
      ? `${this.#beschriftung} verbergen`
      : `${this.#beschriftung} anzeigen`;
    this.#schalter.setAttribute('aria-label', text);
    this.#schalter.title = text;
  }
}

/** Auge bzw. durchgestrichenes Auge, als Inline-SVG (keine fremden Schriften). */
function auge(offen: boolean): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');

  const bogen = document.createElementNS(NS, 'path');
  bogen.setAttribute('d', 'M2.2 12S6 5.5 12 5.5 21.8 12 21.8 12 18 18.5 12 18.5 2.2 12 2.2 12Z');
  svg.appendChild(bogen);

  const pupille = document.createElementNS(NS, 'circle');
  pupille.setAttribute('cx', '12');
  pupille.setAttribute('cy', '12');
  pupille.setAttribute('r', '3.2');
  svg.appendChild(pupille);

  if (offen) {
    // Sichtbar = durchgestrichenes Auge: der Schalter zeigt, was ein Klick
    // BEWIRKT (verbergen), nicht den aktuellen Zustand — das ist die
    // Konvention, an die Nutzer gewöhnt sind.
    const strich = document.createElementNS(NS, 'path');
    strich.setAttribute('d', 'M4 20 20 4');
    svg.appendChild(strich);
  }
  return svg;
}
