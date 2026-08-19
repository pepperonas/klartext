/**
 * Sicherung des privaten Schlüssels — eigene Ansicht mit eigener Adresse,
 * damit die Zurück-Geste des Browsers hier ebenfalls tut, was sie soll.
 */

import type { CryptoClient } from '../../crypto/client.ts';
import type { KeyInfo } from '../../crypto/protocol.ts';
import { kopierKnopf } from '../components/kopieren.ts';
import { PasswortFeld } from '../components/passwortfeld.ts';
import { Vorschlag } from '../components/vorschlag.ts';
import { el, ersetze } from '../dom.ts';
import { fehlertext, lade } from './schluessel.ts';

export interface ExportOptionen {
  readonly client: CryptoClient;
  readonly beiZurueck: () => void;
}

export class ExportAnsicht {
  readonly wurzel = el('div', { class: 'ansicht' });
  readonly #client: CryptoClient;
  readonly #beiZurueck: () => void;

  constructor(optionen: ExportOptionen) {
    this.#client = optionen.client;
    this.#beiZurueck = optionen.beiZurueck;
  }

  /** `kurz` sind die letzten 16 Stellen des Fingerprints. */
  async zeichne(kurz: string): Promise<void> {
    const alle = await this.#client.ruf('keys.list', {});
    const schluessel = alle.find((k) => k.fingerprint.endsWith(kurz.toUpperCase()));
    if (schluessel === undefined) {
      ersetze(this.wurzel, el('section', { class: 'karte' },
        el('h2', { text: 'Diesen Schlüssel gibt es hier nicht' }),
        this.#zurueckKnopf('Zu deinen Schlüsseln')));
      return;
    }
    this.#zeichneFormular(schluessel);
  }

  #zurueckKnopf(text: string): HTMLElement {
    const knopf = el('button', { class: 'knopf', type: 'button', text });
    knopf.addEventListener('click', () => { this.#beiZurueck(); });
    return el('div', { class: 'knopfreihe' }, knopf);
  }

  #zeichneFormular(schluessel: KeyInfo): void {
    const meldung = el('p', { class: 'meldung', role: 'status', 'aria-live': 'polite' });
    const kopierMeldung = el('p', { class: 'meldung', role: 'status', 'aria-live': 'polite' });
    const pw = new PasswortFeld({ id: 'export-pw', beschriftung: 'Passwort für die Sicherungsdatei' });

    const vorschlag = new Vorschlag({
      art: 'passwort',
      beiUebernahme: (text) => { pw.wert = text; pw.zeige(true); },
    });

    const erzeugen = el('button', { class: 'knopf haupt', type: 'submit', text: 'Sicherung erzeugen' });
    const zurueck = el('button', { class: 'knopf', type: 'button', text: 'Zurück' });
    zurueck.addEventListener('click', () => { this.#beiZurueck(); });

    const form = el('form', { class: 'form', novalidate: true },
      el('p', { class: 'fingerprint', text: (schluessel.fingerprint.match(/.{1,4}/g) ?? []).join(' ') }),
      el('p', {
        text:
          'Diese Datei ist dein eigentliches Backup: mit ihr kommst du auf einem neuen Rechner ' +
          'oder nach gelöschten Browserdaten wieder an deine Nachrichten. Die Passphrase allein ' +
          'reicht dafür nicht — sie entsperrt nur, was hier gespeichert ist.',
      }),
      el('div', { class: 'warnkasten' },
        el('p', {
          class: 'hinweis',
          text:
            'Nimm ein anderes Passwort als deine Passphrase und leg die Datei getrennt davon ab. ' +
            'Wer beides an einem Ort findet, hat deinen Schlüssel.',
        }),
        el('p', {
          class: 'hinweis',
          text:
            'Die Datei ist schwächer geschützt als der Schlüsselbund hier: sie nutzt ' +
            'iterated+salted statt Argon2id. Anders kann GnuPG sie nicht lesen.',
        })),
      pw.wurzel,
      el('div', { class: 'knopfreihe eng' },
        vorschlag.knopf(),
        kopierKnopf({ text: () => pw.wert, beschriftung: 'Passwort kopieren', meldung: kopierMeldung })),
      vorschlag.wurzel,
      kopierMeldung,
      meldung,
      el('div', { class: 'knopfreihe' }, zurueck, erzeugen));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        if (pw.wert.length < 8) {
          meldung.dataset['art'] = 'gefahr';
          meldung.textContent = 'Das Passwort ist zu kurz — mindestens 8 Zeichen.';
          return;
        }
        try {
          const ergebnis = await this.#client.ruf('keys.export', {
            fingerprint: schluessel.fingerprint, secret: true, exportPassphrase: pw.wert,
          });
          lade(ergebnis.filename, ergebnis.armored);
          meldung.dataset['art'] = 'gut';
          meldung.textContent = 'Sicherung erzeugt. Behandle die Datei wie den Schlüssel selbst.';
          setTimeout(() => { this.#beiZurueck(); }, 1400);
        } catch (fehler) {
          meldung.dataset['art'] = 'gefahr';
          meldung.textContent = fehlertext(fehler);
        }
      })();
    });

    ersetze(this.wurzel,
      el('h2', { class: 'ansicht-titel', text: 'Sicherung erzeugen' }),
      el('section', { class: 'karte' }, form));
    pw.eingabe.focus();
  }
}
