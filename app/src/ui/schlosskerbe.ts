/**
 * Der Sperr-Anzeiger in der Kopfzeile.
 *
 * Er ist absichtlich immer sichtbar und nennt die Restzeit: wer nicht sofort
 * sagen kann, ob sein Schluessel gerade offen liegt, hat keine Kontrolle
 * darueber. Die Restzeit laeuft lokal ab und fragt den Worker nicht jede
 * Sekunde — der Worker haelt die Wahrheit, die Anzeige nur die Darstellung.
 */

import type { VaultStatus } from '../crypto/protocol.ts';
import { el } from './dom.ts';

const BESCHRIFTUNG: Readonly<Record<VaultStatus['state'], string>> = {
  empty: 'kein Schlüssel',
  locked: 'gesperrt',
  unlocked: 'offen',
};

export function formatiereRestzeit(millisekunden: number): string {
  const gesamt = Math.max(0, Math.round(millisekunden / 1000));
  const minuten = Math.floor(gesamt / 60);
  const sekunden = gesamt % 60;
  return `${String(minuten)}:${sekunden.toString().padStart(2, '0')}`;
}

export class Schlosskerbe {
  readonly wurzel: HTMLElement;
  readonly #punkt: HTMLElement;
  readonly #text: HTMLElement;
  readonly #rest: HTMLElement;
  #status: VaultStatus | null = null;
  #ticker: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.#punkt = el('span', { class: 'kerbe-punkt', 'aria-hidden': 'true' });
    this.#text = el('span', { class: 'kerbe-text' });
    this.#rest = el('span', { class: 'kerbe-rest' });
    this.wurzel = el(
      'div',
      { class: 'kerbe', role: 'status', 'aria-live': 'polite' },
      this.#punkt,
      this.#text,
      this.#rest,
    );
  }

  zeige(status: VaultStatus): void {
    this.#status = status;
    this.wurzel.dataset['zustand'] = status.state;
    this.#text.textContent = BESCHRIFTUNG[status.state];
    this.#zeichneRestzeit();

    if (status.state === 'unlocked' && status.lockAt !== null) {
      this.#ticker ??= setInterval(() => { this.#zeichneRestzeit(); }, 1000);
    } else if (this.#ticker !== null) {
      clearInterval(this.#ticker);
      this.#ticker = null;
    }
  }

  #zeichneRestzeit(): void {
    const status = this.#status;
    if (status === null || status.state !== 'unlocked' || status.lockAt === null) {
      this.#rest.textContent = '';
      this.wurzel.removeAttribute('title');
      return;
    }
    const rest = status.lockAt - Date.now();
    this.#rest.textContent = `· sperrt in ${formatiereRestzeit(rest)}`;
    this.wurzel.title = 'Der Schlüsselbund sperrt sich nach Leerlauf von selbst.';
  }
}
