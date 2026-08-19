/**
 * Navigationsleiste.
 *
 * Zeigt auch, was es noch NICHT gibt: im Zustand „Schlüssel vorhanden" ist
 * derzeit schlicht nichts weiter zu tun, und ohne diesen Hinweis wirkt die App
 * kaputt statt unfertig. Ein ausgegrauter Eintrag mit Phasenangabe ist
 * ehrlicher als ein leerer Bildschirm.
 */

import type { Weg } from './router.ts';
import { el } from './dom.ts';

interface Eintrag {
  readonly text: string;
  readonly ziel: Weg | null;
  readonly notiz?: string;
}

const EINTRAEGE: readonly Eintrag[] = [
  { text: 'Schlüssel', ziel: { ziel: 'schluessel' } },
  { text: 'Werkzeug', ziel: { ziel: 'werkzeug' } },
  { text: 'Kontakte', ziel: null, notiz: 'kommt in Phase 3 — Schlüssel von Freunden, Fingerprint-Abgleich' },
  { text: 'Info', ziel: { ziel: 'info' } },
];

export class Navigation {
  readonly wurzel: HTMLElement;
  readonly #knoepfe = new Map<string, HTMLElement>();

  constructor(beiWechsel: (weg: Weg) => void) {
    const kinder = EINTRAEGE.map((e) => {
      if (e.ziel === null) {
        const aus = el('span', {
          class: 'nav-eintrag aus',
          text: e.text,
          title: e.notiz ?? '',
          'aria-disabled': 'true',
        });
        return aus;
      }
      const knopf = el('button', { class: 'nav-eintrag', type: 'button', text: e.text });
      const ziel = e.ziel;
      knopf.addEventListener('click', () => { beiWechsel(ziel); });
      this.#knoepfe.set(ziel.ziel, knopf);
      return knopf;
    });

    this.wurzel = el('nav', { class: 'nav', 'aria-label': 'Bereiche' }, ...kinder);
  }

  markiere(weg: Weg): void {
    // Die Unterzustände von „Schlüssel" (anlegen, exportieren) gehören dorthin.
    const aktiv = weg.ziel === 'info' ? 'info' : weg.ziel === 'werkzeug' ? 'werkzeug' : 'schluessel';
    for (const [name, knopf] of this.#knoepfe) {
      const an = name === aktiv;
      knopf.classList.toggle('an', an);
      if (an) knopf.setAttribute('aria-current', 'page');
      else knopf.removeAttribute('aria-current');
    }
  }
}
