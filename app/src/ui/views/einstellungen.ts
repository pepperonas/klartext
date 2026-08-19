/**
 * Einstellungen — darunter der Schalter für Modus B.
 *
 * ⚠️ Der Schalter ist bewusst keine beiläufige Häkchenzeile. Wer den
 *    Zustellserver einschaltet, gibt Metadaten preis, die er vorher nicht
 *    preisgegeben hat. Das steht hier ausgeschrieben, BEVOR man klickt — nicht
 *    im Kleingedruckten danach.
 */

import type { CryptoClient } from '../../crypto/client.ts';
import type { VaultSettings } from '../../crypto/protocol.ts';
import { pruefeHerkunft, STANDARD_RELAY_PFAD } from '../../relay/client.ts';
import { el, ersetze } from '../dom.ts';
import { fehlertext } from './schluessel.ts';

function knopfMit(text: string, beiKlick: () => void, klasse = ''): HTMLButtonElement {
  const knopf = el('button', { class: `knopf ${klasse}`.trim(), type: 'button', text });
  knopf.addEventListener('click', beiKlick);
  return knopf;
}

export interface EinstellungenOptionen {
  readonly client: CryptoClient;
  readonly beiInfo: () => void;
}

export class EinstellungenAnsicht {
  readonly wurzel = el('div', { class: 'ansicht' });
  readonly #client: CryptoClient;
  readonly #beiInfo: () => void;
  #meldung = el('p', { class: 'meldung', role: 'status', 'aria-live': 'polite' });

  constructor(optionen: EinstellungenOptionen) {
    this.#client = optionen.client;
    this.#beiInfo = optionen.beiInfo;
  }

  async zeichne(): Promise<void> {
    const e = await this.#client.ladeEinstellungen();
    ersetze(
      this.wurzel,
      el('h2', { class: 'ansicht-titel', text: 'Einstellungen' }),
      this.#sperreKarte(e),
      this.#relayKarte(e),
      this.#meldung,
    );
  }

  // -------------------------------------------------------------- Sperre

  #sperreKarte(e: VaultSettings): HTMLElement {
    const auswahl = el('select', { id: 'auto-lock' },
      ...[1, 5, 15, 30, 60, 0].map((n) => {
        const o = el('option', { value: String(n), text: n === 0 ? 'nie' : `${String(n)} Minuten` });
        if (n === e.autoLockMinutes) o.setAttribute('selected', '');
        return o;
      }));
    auswahl.addEventListener('change', () => {
      void this.#setze({ autoLockMinutes: Number(auswahl.value) });
    });

    const karenz = el('select', { id: 'karenz' },
      ...[[0, 'sofort'], [30, 'nach 30 Sekunden'], [300, 'nach 5 Minuten'], [-1, 'gar nicht']]
        .map(([wert, text]) => {
          const o = el('option', { value: String(wert), text: String(text) });
          if (wert === e.lockOnHiddenSeconds) o.setAttribute('selected', '');
          return o;
        }));
    karenz.addEventListener('change', () => {
      void this.#setze({ lockOnHiddenSeconds: Number(karenz.value) });
    });

    return el('section', { class: 'karte' },
      el('h3', { text: 'Sperre' }),
      el('div', { class: 'feld' },
        el('label', { for: 'auto-lock', text: 'Bei Leerlauf sperren' }), auswahl),
      el('div', { class: 'feld' },
        el('label', { for: 'karenz', text: 'Beim Wechsel in einen anderen Tab sperren' }), karenz,
        el('p', {
          class: 'hinweis',
          text:
            'Voreingestellt sind 30 Sekunden. „Sofort" ist strenger, sperrt aber genau die ' +
            'Handbewegung weg, mit der man einen Block woanders einfügt.',
        })),
      el('p', {
        class: 'hinweis leise',
        text:
          'Die Sperre verkleinert das Zeitfenster, in dem der Schlüssel im Speicher liegt. ' +
          'Löschen kann JavaScript ihn nicht — das steht bei den Grenzen.',
      }));
  }

  // --------------------------------------------------------------- Relay

  #relayKarte(e: VaultSettings): HTMLElement {
    const url = el('input', {
      id: 'relay-url', type: 'url', autocomplete: 'off', spellcheck: 'false',
      placeholder: STANDARD_RELAY_PFAD,
    });
    url.value = e.relayUrl;

    const schalter = el('input', { type: 'checkbox', id: 'relay-an' });
    schalter.checked = e.relayAktiv;
    schalter.addEventListener('change', () => {
      void this.#setze({ relayAktiv: schalter.checked, relayUrl: url.value.trim() });
    });

    return el('section', { class: 'karte' },
      el('h3', { text: 'Modus B — Zustellserver' }),

      el('div', { class: 'warnkasten' },
        el('strong', { text: 'Bequemlichkeit, kein Sicherheitsgewinn.' }),
        el('p', {
          class: 'hinweis',
          text:
            'Ohne ihn funktioniert alles weiter: du bekommst beim Absenden einen Block zum ' +
            'Kopieren und schickst ihn über den Kanal deiner Wahl. Mit ihm entfällt das ' +
            'Kopieren — mehr nicht.',
        }),
        el('p', {
          class: 'hinweis',
          text:
            'Der Server sieht nur Ciphertext, aber er sieht, DASS ein Postfach zu einem Zeitpunkt ' +
            'etwas bekommt und wie gross es ist. Dein öffentlicher Schlüssel erreicht ihn einmal ' +
            'beim Einrichten; gespeichert wird er nicht. Wer beides nicht will, lässt das hier aus.',
        })),

      el('label', { class: 'empfaenger' }, schalter,
        el('span', { text: 'Zustellserver benutzen' })),

      el('div', { class: 'feld' },
        el('label', { for: 'relay-url', text: 'Adresse des Servers' }), url,
        el('p', {
          class: 'hinweis',
          text:
            `Ein eigener Server, erreichbar unter DIESER Adresse — etwa ${STANDARD_RELAY_PFAD}. ` +
            'klartext bringt keinen mit und schlägt auch keinen vor.',
        }),
        el('p', {
          class: 'hinweis warnend',
          text:
            'Ein Server auf einem anderen Host geht nicht: die Sicherheitsrichtlinie dieser Seite ' +
            'lässt ausschliesslich die eigene Herkunft zu. Das ist Absicht — klartext kann so mit ' +
            'niemandem sonst sprechen.',
        })),

      el('div', { class: 'knopfreihe' },
        knopfMit('Adresse übernehmen', () => { void this.#setze({ relayUrl: url.value.trim() }); }),
        knopfMit('Was klartext nicht kann', () => { this.#beiInfo(); })),

      Object.keys(e.relayTokens).length === 0 ? null : el('p', {
        class: 'hinweis leise',
        text:
          `${String(Object.keys(e.relayTokens).length)} Postfach/Postfächer eingerichtet. Das ` +
          'Lesetoken liegt unverschlüsselt im Browser — es berechtigt zum Abholen von ' +
          'Ciphertext, nicht zum Entschlüsseln.',
      }));
  }

  async #setze(teil: Partial<VaultSettings>): Promise<void> {
    // Eine fremde Herkunft wird abgewiesen, bevor sie gespeichert wird — sonst
    // stünde in den Einstellungen etwas, das nie funktionieren kann.
    if (typeof teil.relayUrl === 'string' && teil.relayUrl.length > 0) {
      const geprueft = pruefeHerkunft(teil.relayUrl, location.origin);
      if (!geprueft.ok) {
        this.#meldung.textContent = geprueft.meldung;
        this.#meldung.dataset['art'] = 'gefahr';
        return;
      }
    }
    try {
      await this.#client.setzeEinstellungen(teil);
      this.#meldung.textContent = 'Gespeichert.';
      this.#meldung.dataset['art'] = 'gut';
      await this.zeichne();
    } catch (fehler) {
      this.#meldung.textContent = fehlertext(fehler);
      this.#meldung.dataset['art'] = 'gefahr';
    }
  }
}
