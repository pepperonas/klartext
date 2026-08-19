/**
 * Vorschlagsfeld für Passphrasen und Export-Passwörter.
 *
 * Drei Dinge sind hier Absicht und keine Zierde:
 *
 *  1. **Der Vorschlag wird nicht stillschweigend eingesetzt.** Wer ihn
 *     wegklickt, ohne ihn zu notieren, verliert seine Schlüssel für immer —
 *     derselbe Fehler, der schon beim Widerrufszertifikat zugeschlagen hat.
 *     Deshalb: anzeigen, aktiv übernehmen, danach ausdrücklich bestätigen.
 *  2. **Die Würfelzahlen stehen dabei.** Wer will, schlägt jedes Wort in
 *     `de-7776-v1.txt` nach und sieht, dass die Zuordnung stimmt.
 *  3. **Der Würfelmodus** ist der einzige Weg, bei dem du dem Zufall selbst
 *     zusiehst, statt der App zu glauben.
 */

import {
  BITS_PRO_WORT,
  MAX_WORTZAHL,
  MIN_WORTZAHL,
  STANDARD_WORTZAHL,
  ausWuerfeln,
  einordnung,
  ziehePassphrase,
  ziehePasswort,
  type Passphrase,
} from '../../passphrase/generator.ts';
import { el, ersetze } from '../dom.ts';

export type VorschlagsArt = 'passphrase' | 'passwort';

export interface VorschlagOptionen {
  readonly art: VorschlagsArt;
  /** Wird mit dem übernommenen Text aufgerufen. */
  readonly beiUebernahme: (text: string, mussBestaetigtWerden: boolean) => void;
}

const WORTZAHLEN = [5, 6, 7, 8] as const;

export class Vorschlag {
  readonly wurzel = el('div', { class: 'vorschlag', hidden: true });
  readonly #art: VorschlagsArt;
  readonly #beiUebernahme: VorschlagOptionen['beiUebernahme'];
  #wortzahl: number = STANDARD_WORTZAHL;
  #aktuell: Passphrase | null = null;
  #wuerfelModus = false;

  constructor(optionen: VorschlagOptionen) {
    this.#art = optionen.art;
    this.#beiUebernahme = optionen.beiUebernahme;
  }

  /** Knopf, der das Feld auf- und zuklappt. */
  knopf(): HTMLElement {
    const knopf = el('button', {
      class: 'knopf klein',
      type: 'button',
      text: this.#art === 'passphrase' ? 'Passphrase vorschlagen' : 'Passwort vorschlagen',
      'aria-expanded': 'false',
      'aria-controls': 'vorschlag-feld',
    });
    this.wurzel.id = 'vorschlag-feld';
    knopf.addEventListener('click', () => {
      const offen = !this.wurzel.hidden;
      if (offen) { this.schliesse(); knopf.setAttribute('aria-expanded', 'false'); }
      else { this.oeffne(); knopf.setAttribute('aria-expanded', 'true'); }
    });
    return knopf;
  }

  oeffne(): void {
    this.wurzel.hidden = false;
    this.#wuerfeln();
  }

  schliesse(): void {
    this.wurzel.hidden = true;
    this.#aktuell = null;
    ersetze(this.wurzel);
  }

  #wuerfeln(): void {
    this.#aktuell = this.#art === 'passphrase' ? ziehePassphrase(this.#wortzahl) : null;
    this.#zeichne();
  }

  // --------------------------------------------------------------- Zeichnen

  #zeichne(): void {
    ersetze(
      this.wurzel,
      this.#art === 'passphrase' ? this.#passphraseTeil() : this.#passwortTeil(),
    );
  }

  #passphraseTeil(): HTMLElement {
    const p = this.#aktuell;
    if (p === null) return el('p', { class: 'hinweis', text: 'Kein Vorschlag.' });

    const woerter = el(
      'div',
      { class: 'vorschlag-woerter' },
      ...p.woerter.map((w) =>
        el(
          'div',
          { class: 'vorschlag-wort' },
          el('span', { class: 'vw-text', text: w.wort }),
          el('span', { class: 'vw-wuerfel', text: w.wuerfel, title: `Würfelaugen für „${w.wort}"` }),
        ),
      ),
    );

    const bits = Math.round(p.bits);
    const masszahl = el('p', {
      class: 'hinweis',
      text:
        `${String(p.woerter.length)} Wörter · ${String(bits)} Bit Entropie — ${einordnung(p.bits)}. ` +
        (p.herkunft === 'wuerfel'
          ? 'Aus deinen eigenen Würfen.'
          : 'Gezogen aus dem Zufallsgenerator des Browsers, gleichverteilt über alle 7776 Wörter.'),
    });

    const chips = el(
      'div',
      { class: 'chips', role: 'group', 'aria-label': 'Anzahl der Wörter' },
      ...WORTZAHLEN.map((n) => {
        const chip = el('button', {
          class: `chip${n === this.#wortzahl ? ' an' : ''}`,
          type: 'button',
          text: `${String(n)} Wörter`,
          'aria-pressed': n === this.#wortzahl ? 'true' : 'false',
        });
        chip.addEventListener('click', () => {
          this.#wortzahl = n;
          this.#wuerfeln();
        });
        return chip;
      }),
    );

    return el(
      'div',
      { class: 'vorschlag-inhalt' },
      woerter,
      masszahl,
      chips,
      el(
        'div',
        { class: 'knopfreihe' },
        this.#knopfMit('Nochmal', () => { this.#wuerfeln(); }),
        this.#knopfMit('Übernehmen', () => { this.#uebernimm(p.text); }, 'haupt'),
        this.#knopfMit(this.#wuerfelModus ? 'Würfeln schließen' : 'Selbst würfeln', () => {
          this.#wuerfelModus = !this.#wuerfelModus;
          this.#zeichne();
        }),
      ),
      el('p', {
        class: 'hinweis leise',
        text:
          'Schreib sie auf, bevor du weitermachst. Ohne die Passphrase ist der Schlüssel ' +
          'endgültig weg — es gibt hier niemanden, der sie zurücksetzen könnte.',
      }),
      this.#wuerfelModus ? this.#wuerfelTeil() : null,
    );
  }

  /**
   * Würfelmodus: fünf Augen je Wort, von Hand eingetragen.
   *
   * Das ist die einzige Betriebsart, in der die Behauptung „wirklich zufällig"
   * nicht von der App kommt, sondern von deinem Küchentisch.
   */
  #wuerfelTeil(): HTMLElement {
    const felder: HTMLInputElement[] = [];
    const meldung = el('p', { class: 'hinweis', role: 'status', 'aria-live': 'polite' });

    const zeilen = Array.from({ length: this.#wortzahl }, (_, i) => {
      const feld = el('input', {
        class: 'wuerfelfeld',
        type: 'text',
        inputmode: 'numeric',
        maxlength: '5',
        pattern: '[1-6]{5}',
        placeholder: '·····',
        'aria-label': `Würfelaugen für Wort ${String(i + 1)}`,
        autocomplete: 'off',
      });
      // Nach fünf gültigen Ziffern automatisch weiterspringen — sonst tippt
      // man mit einer Hand voller Würfel ständig ins falsche Feld.
      feld.addEventListener('input', () => {
        feld.value = feld.value.replace(/[^1-6]/g, '').slice(0, 5);
        if (feld.value.length === 5) felder[i + 1]?.focus();
      });
      felder.push(feld);
      return el('label', { class: 'wuerfelzeile' }, el('span', { text: `${String(i + 1)}.` }), feld);
    });

    const uebernehmen = this.#knopfMit('Aus meinen Würfen bilden', () => {
      const wuerfe = felder.map((f) => f.value);
      if (wuerfe.some((w) => !/^[1-6]{5}$/.test(w))) {
        meldung.textContent = 'Jede Zeile braucht genau fünf Augen von 1 bis 6.';
        meldung.dataset['art'] = 'gefahr';
        return;
      }
      try {
        this.#aktuell = ausWuerfeln(wuerfe);
        this.#wuerfelModus = false;
        this.#zeichne();
      } catch {
        meldung.textContent = 'Diese Würfelfolge ergibt kein Wort.';
        meldung.dataset['art'] = 'gefahr';
      }
    });

    return el(
      'div',
      { class: 'wuerfelbereich' },
      el('h4', { text: 'Selbst würfeln' }),
      el('p', {
        class: 'hinweis',
        text:
          `Wirf einen Würfel fünfmal je Wort und trag die Augen ein — ${String(this.#wortzahl)} Zeilen. ` +
          'Damit hängt der Zufall an deinem Tisch und nicht an einer Zusage dieser App. ' +
          'Die Zuordnung kannst du in de-7776-v1.txt nachschlagen.',
      }),
      el('div', { class: 'wuerfelgitter' }, ...zeilen),
      meldung,
      el('div', { class: 'knopfreihe' }, uebernehmen),
    );
  }

  #passwortTeil(): HTMLElement {
    const p = ziehePasswort();
    return el(
      'div',
      { class: 'vorschlag-inhalt' },
      el('p', { class: 'block passwort-vorschlag', text: p.text }),
      el('p', {
        class: 'hinweis',
        text:
          `${String(p.text.length)} Zeichen · ${String(Math.round(p.bits))} Bit — ${einordnung(p.bits)}. ` +
          'Ohne l, I, 1, O und 0, damit beim Abschreiben nichts zu verwechseln ist.',
      }),
      el(
        'div',
        { class: 'knopfreihe' },
        this.#knopfMit('Nochmal', () => { this.#zeichne(); }),
        this.#knopfMit('Übernehmen', () => { this.#uebernimm(p.text); }, 'haupt'),
      ),
      el('p', {
        class: 'hinweis leise',
        text: 'Gehört in deinen Passwortmanager — diese Datei ist ohne das Passwort wertlos.',
      }),
    );
  }

  #uebernimm(text: string): void {
    this.#beiUebernahme(text, true);
    this.schliesse();
  }

  #knopfMit(beschriftung: string, beiKlick: () => void, klasse = ''): HTMLElement {
    const knopf = el('button', { class: `knopf klein ${klasse}`.trim(), type: 'button', text: beschriftung });
    knopf.addEventListener('click', beiKlick);
    return knopf;
  }
}

export { BITS_PRO_WORT, MAX_WORTZAHL, MIN_WORTZAHL };
