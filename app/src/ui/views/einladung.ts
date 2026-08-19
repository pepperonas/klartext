/**
 * Einladungen — erzeugen und empfangen.
 *
 * Der Link trägt den eigenen öffentlichen Schlüssel im Fragment. Was er NICHT
 * leistet, sagt die Ansicht selbst: er beweist nicht, von wem er kommt. Wer ihn
 * unterwegs abfängt, kann einen eigenen Schlüssel unterschieben, und beide
 * Seiten sähen nichts davon. Erst der Fingerprint-Abgleich schliesst das aus —
 * deshalb führt jeder Weg hier am Ende dorthin.
 */

import type { CryptoClient } from '../../crypto/client.ts';
import type { Kontakt, KeyInfo } from '../../crypto/protocol.ts';
import {
  baueEinladung,
  leseEinladung,
  passtInQr,
  restlaufzeit,
  STANDARD_GUELTIG_TAGE,
  type Einladung,
} from '../../contacts/einladung.ts';
import { kopierKnopf } from '../components/kopieren.ts';
import { qrAnzeige } from '../components/qr-anzeige.ts';
import { el, ersetze } from '../dom.ts';
import { fehlertext } from './schluessel.ts';

function gruppiert(fp: string): string {
  return (fp.match(/.{1,4}/g) ?? []).join(' ');
}

function knopfMit(text: string, beiKlick: () => void, klasse = ''): HTMLButtonElement {
  const knopf = el('button', { class: `knopf ${klasse}`.trim(), type: 'button', text });
  knopf.addEventListener('click', beiKlick);
  return knopf;
}

export interface EinladungOptionen {
  readonly client: CryptoClient;
  readonly beiKontakte: () => void;
  readonly beiSchluessel: () => void;
}

export class EinladungAnsicht {
  readonly wurzel = el('div', { class: 'ansicht' });
  readonly #client: CryptoClient;
  readonly #optionen: EinladungOptionen;
  #meldung = el('p', { class: 'meldung', role: 'status', 'aria-live': 'polite' });

  constructor(optionen: EinladungOptionen) {
    this.#client = optionen.client;
    this.#optionen = optionen;
  }

  // ------------------------------------------------------------- Erzeugen

  async zeichneErzeugen(): Promise<void> {
    let schluessel: readonly KeyInfo[];
    try {
      schluessel = await this.#client.ruf('keys.list', {});
    } catch (fehler) {
      ersetze(this.wurzel, el('section', { class: 'karte' }, el('p', { text: fehlertext(fehler) })));
      return;
    }

    const eigener = schluessel.find((k) => k.isDefault) ?? schluessel[0];
    if (eigener === undefined) {
      ersetze(this.wurzel, el('section', { class: 'karte' },
        el('h2', { text: 'Erst brauchst du einen eigenen Schlüssel' }),
        el('p', { text: 'Eine Einladung trägt deinen öffentlichen Schlüssel — ohne den gibt es nichts einzuladen.' }),
        el('div', { class: 'knopfreihe' }, knopfMit('Zu deinen Schlüsseln', () => { this.#optionen.beiSchluessel(); }, 'haupt'))));
      return;
    }

    let daten: Uint8Array;
    try {
      ({ daten } = await this.#client.ruf('keys.exportBinaer', { fingerprint: eigener.fingerprint }));
    } catch (fehler) {
      ersetze(this.wurzel, el('section', { class: 'karte' }, el('p', { text: fehlertext(fehler) })));
      return;
    }

    const name = eigener.userIds[0] ?? eigener.label;
    const { url, einladung } = baueEinladung({
      name,
      schluessel: daten,
      herkunft: location.origin,
      gueltigTage: STANDARD_GUELTIG_TAGE,
    });

    const kopierMeldung = el('p', { class: 'meldung' });
    const passt = passtInQr(url);

    ersetze(this.wurzel,
      el('h2', { class: 'ansicht-titel', text: 'Jemanden einladen' }),
      el('section', { class: 'karte' },
        el('p', {
          text:
            'Schick diesen Link an die Person, mit der du schreiben willst. Er trägt deinen ' +
            'öffentlichen Schlüssel — der ist nicht geheim, du darfst ihn über jeden Kanal geben.',
        }),
        el('p', { class: 'hinweis', text: `Gültig ${restlaufzeit(einladung)}. Danach braucht es eine neue Einladung.` }),

        passt
          ? el('div', { class: 'einladung-qr' },
              qrAnzeige(url, { beschriftung: 'QR-Code mit deiner Einladung', stufe: 'L', kantenlaenge: 300 }),
              el('p', { class: 'hinweis', text: 'Zum Abscannen, wenn ihr euch seht.' }))
          : el('div', { class: 'warnkasten' },
              el('strong', { text: 'Für einen QR-Code ist dieser Link zu lang.' }),
              el('p', {
                class: 'hinweis',
                text:
                  `Dein ${eigener.bits !== null ? `RSA-${String(eigener.bits)}` : 'Schlüssel'} wiegt zu viel: ` +
                  `${String(url.length)} Zeichen passen in keinen QR-Code, der grösste fasst 2953. ` +
                  'Nimm den Link. Wer QR-Codes nutzen will, legt sich einen Curve25519-Schlüssel an — ' +
                  'der ist ein Fünftel so gross und mindestens genauso sicher.',
              })),

        el('div', { class: 'feld' },
          el('label', { for: 'einladung-url', text: 'Einladungslink' }),
          el('textarea', { id: 'einladung-url', class: 'block', rows: '4', readonly: true }, url)),

        el('div', { class: 'knopfreihe' },
          kopierKnopf({ text: () => url, beschriftung: 'Link kopieren', meldung: kopierMeldung }),
          knopfMit('Zu den Kontakten', () => { this.#optionen.beiKontakte(); })),
        kopierMeldung,

        el('div', { class: 'warnkasten' },
          el('strong', { text: 'Der Link beweist nicht, von wem er kommt.' }),
          el('p', {
            class: 'hinweis',
            text:
              'Wer ihn unterwegs abfängt, kann einen eigenen Schlüssel unterschieben — beide ' +
              'Seiten sähen davon nichts. Deshalb gleicht ihr danach den Fingerprint über einen ' +
              'ZWEITEN Kanal ab. Deiner lautet:',
          }),
          el('p', { class: 'fingerprint', text: gruppiert(eigener.fingerprint) }))),
      this.#meldung);
  }

  // ------------------------------------------------------------- Empfangen

  async zeichneEmpfangen(fragment: string): Promise<void> {
    const ergebnis = leseEinladung(fragment);

    if (!ergebnis.ok) {
      ersetze(this.wurzel,
        el('h2', { class: 'ansicht-titel', text: 'Einladung' }),
        el('section', { class: 'karte' },
          el('div', { class: 'warnkasten mahnung' },
            el('strong', { text: ergebnis.meldung })),
          el('div', { class: 'knopfreihe' },
            knopfMit('Zu den Kontakten', () => { this.#optionen.beiKontakte(); }, 'haupt'))));
      return;
    }

    const einladung = ergebnis.einladung;
    let aufnahme;
    try {
      aufnahme = await this.#client.ruf('kontakte.pruefe', {
        armored: null, binaer: einladung.schluessel, name: einladung.name,
      });
    } catch (fehler) {
      ersetze(this.wurzel, el('section', { class: 'karte' },
        el('h2', { text: 'Diese Einladung lässt sich nicht lesen' }),
        el('p', { text: fehlertext(fehler) }),
        el('div', { class: 'knopfreihe' }, knopfMit('Zu den Kontakten', () => { this.#optionen.beiKontakte(); }))));
      return;
    }

    const kandidat = aufnahme.kontakt;
    const wechsel = aufnahme.art === 'schluesselwechsel';

    ersetze(this.wurzel,
      el('h2', { class: 'ansicht-titel', text: 'Einladung erhalten' }),
      el('section', { class: 'karte' },
        el('p', { text: `${einladung.name} möchte dir verschlüsselt schreiben.` }),
        el('p', { class: 'hinweis', text: `Diese Einladung ist ${restlaufzeit(einladung)} gültig.` }),

        wechsel && aufnahme.art === 'schluesselwechsel'
          ? el('div', { class: 'warnkasten mahnung' },
              el('strong', { text: `Für „${aufnahme.bisher.name}" kennst du bereits einen anderen Schlüssel.` }),
              el('p', {
                class: 'hinweis',
                text:
                  'Entweder hat die Person einen neuen — oder jemand setzt sich gerade zwischen ' +
                  'euch. Frag über einen Kanal nach, den du schon kennst, bevor du das übernimmst.',
              }),
              el('p', { class: 'fingerprint klein', text: `bisher: ${gruppiert(aufnahme.bisher.fingerprint)}` }))
          : null,

        el('p', { class: 'fingerprint', text: gruppiert(kandidat.fingerprint) }),
        el('h3', { text: 'Diese dreizehn Wörter musst du abgleichen' }),
        el('ol', { class: 'woerter' }, ...kandidat.woerter.map((w) => el('li', { class: 'wort', text: w }))),
        el('p', {
          class: 'hinweis',
          text:
            'Lies sie der Person am Telefon vor — nicht über denselben Weg, über den die ' +
            'Einladung kam. Wer dort mitliest, könnte auch die Wörter fälschen.',
        }),

        aufnahme.art === 'bekannt'
          ? el('p', { class: 'hinweis', text: 'Diesen Schlüssel hast du bereits.' })
          : null,

        el('div', { class: 'knopfreihe' },
          knopfMit('Abbrechen', () => { this.#optionen.beiKontakte(); }),
          knopfMit(
            wechsel ? 'Ich habe nachgefragt: übernehmen' : 'Kontakt aufnehmen',
            () => { void this.#uebernimm(einladung); },
            wechsel ? 'gefahr' : 'haupt')),

        el('p', {
          class: 'hinweis leise',
          text: 'Der Kontakt gilt danach als NICHT verifiziert, bis du den Fingerprint abgeglichen hast.',
        })),
      this.#meldung);
  }

  async #uebernimm(einladung: Einladung): Promise<void> {
    try {
      const kontakt: Kontakt = await this.#client.ruf('kontakte.uebernimm', {
        armored: null, binaer: einladung.schluessel, name: einladung.name,
      });
      void kontakt;
      this.#optionen.beiKontakte();
    } catch (fehler) {
      this.#meldung.textContent = fehlertext(fehler);
      this.#meldung.dataset['art'] = 'gefahr';
    }
  }
}
