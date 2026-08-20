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
import type { Postfach } from '../../relay/postfach.ts';
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
  /** Für die Vorstellung an den frisch aufgenommenen Kontakt. */
  readonly postfach: Postfach;
  readonly beiKontakte: () => void;
  readonly beiSchluessel: () => void;
  /** Zur eigenen Einladung — nötig, damit die Aufnahme gegenseitig wird. */
  readonly beiEinladen: () => void;
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
        // ⚠️ Damit niemand denkt, damit sei der Austausch erledigt.
        el('p', { class: 'hinweis' },
          el('strong', { text: 'Das ist die halbe Strecke. ' }),
          document.createTextNode(
            'Der Link trägt DEINEN Schlüssel. Die andere Person kann dir danach schreiben — '
            + 'du ihr erst, wenn sie dir ihre eigene Einladung zurückschickt.')),

        passt
          ? el('div', { class: 'einladung-qr' },
              qrAnzeige(url, { beschriftung: 'QR-Code mit deiner Einladung', stufe: 'L', kantenlaenge: 300 }),
              // ⚠️ „Zum Abscannen" allein lud dazu ein, in klartext nach einem
              //    Scanner zu suchen — den es für DIESEN Zweck nicht gibt (der
              //    eingebaute prüft Fingerprints bestehender Kontakte). Eine
              //    Einladung nimmt man an, indem die Kamera-App des Telefons
              //    den Link öffnet. Also steht jetzt dabei, wer womit scannt.
              el('p', { class: 'hinweis', text:
                'Die andere Person scannt ihn mit der Kamera ihres Telefons — der Link öffnet '
                + 'sich dann in ihrem Browser.' }))
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
        }),

        // ⚠️ Eine Einladung trägt NUR den Schlüssel dessen, der sie schickt.
        //    Wer sie annimmt, sieht den Absender — der Absender sieht ihn
        //    deswegen aber nicht. Das ist die Bauart, und sie stand nirgends:
        //    gemeldet als „der neue Kontakt sieht mich, aber ich sehe ihn
        //    nicht". Es ist kein Fehler, aber ohne diesen Satz sieht es wie
        //    einer aus.
        el('p', { class: 'hinweis' },
          el('strong', { text: 'Es geht nur in eine Richtung. ' }),
          document.createTextNode(
            `Diese Einladung trägt ${einladung.name}s Schlüssel — deinen nicht. Damit `
            + `${einladung.name} auch dir schreiben kann, brauchst du eine eigene Einladung.`))),
      this.#meldung);
  }

  /**
   * Nach dem Aufnehmen: die Gegenrichtung anbieten.
   *
   * Ohne diesen Schritt endet der Ablauf in einer Liste, in der alles richtig
   * aussieht — und die andere Seite wartet vergebens auf eine Antwort, die
   * technisch gar nicht ankommen kann.
   */
  /**
   * Schickt die eigene Vorstellung an den frisch aufgenommenen Kontakt.
   *
   * Gibt zurück, ob es geklappt hat. Es KANN nicht klappen, wenn Modus B bei
   * einem von beiden aus ist — das ist kein Fehler, sondern die Voreinstellung.
   */
  async #stelleDichVor(anFingerprint: string): Promise<'gesendet' | 'vorgemerkt' | 'geht-nicht'> {
    const einstellungen = this.#client.einstellungen;
    if (!einstellungen.relayAktiv) return 'geht-nicht';

    try {
      const eigene = await this.#client.ruf('keys.list', {});
      const eigener = eigene.find((k) => k.isDefault) ?? eigene[0];
      if (eigener !== undefined && this.#client.status.state === 'unlocked') {
        const ergebnis = await this.#optionen.postfach.stelleDichVor(eigener.fingerprint, anFingerprint);
        if (ergebnis.ok) return 'gesendet';
      }
    } catch { /* fällt unten auf das Vormerken zurück */ }

    // ⚠️ Der Normalfall, nicht die Ausnahme: der Einladungslink lädt die Seite
    //    neu, danach ist der Schlüsselbund gesperrt — und eine Vorstellung
    //    muss signiert werden. Also vormerken; der Postfachwächter schickt sie
    //    beim nächsten Entsperren.
    const offen = einstellungen.offeneVorstellungen;
    if (!offen.includes(anFingerprint)) {
      await this.#client.setzeEinstellungen({ offeneVorstellungen: [...offen, anFingerprint] });
    }
    return 'vorgemerkt';
  }

  #zeigeGegeneinladung(name: string, zurueck: 'gesendet' | 'vorgemerkt' | 'geht-nicht'): void {
    const erledigt = zurueck !== 'geht-nicht';
    const texte: Readonly<Record<typeof zurueck, string>> = {
      gesendet:
        `${name} sieht dich demnächst in den eigenen Kontakten und muss dich dort nur noch `
        + 'bestätigen. Ihr könnt euch dann gegenseitig schreiben.',
      vorgemerkt:
        `Dein Schlüssel geht an ${name}, sobald du den Schlüsselbund das nächste Mal `
        + 'entsperrst — unterschreiben lässt sich nur mit ihm. Du musst dafür nichts tun.',
      'geht-nicht':
        `Du kannst ${name} ab sofort schreiben. Umgekehrt geht es noch nicht: ${name} hat `
        + 'deinen öffentlichen Schlüssel nicht — eine Einladung trägt immer nur den des '
        + 'Absenders. Ohne Zustellserver musst du ihn selbst zurückschicken.',
    };

    ersetze(this.wurzel,
      el('h2', { class: 'ansicht-titel', text: `${name} ist jetzt in deinen Kontakten` }),
      el('section', { class: 'karte' },
        erledigt
          ? el('p', {},
              el('strong', { text: 'Und dein Schlüssel ist unterwegs. ' }),
              document.createTextNode(texte[zurueck]))
          : el('p', { text: texte[zurueck] }),
        erledigt ? null : el('p', { class: 'hinweis', text:
          'Schick deine eigene Einladung zurück, dann seht ihr euch gegenseitig.' }),
        el('div', { class: 'knopfreihe' },
          erledigt
            ? knopfMit('Zu den Kontakten', () => { this.#optionen.beiKontakte(); }, 'haupt')
            : knopfMit('Eigene Einladung erzeugen', () => { this.#optionen.beiEinladen(); }, 'haupt'),
          erledigt ? null : knopfMit('Später', () => { this.#optionen.beiKontakte(); }))),
      this.#meldung);
  }

  async #uebernimm(einladung: Einladung): Promise<void> {
    try {
      const kontakt: Kontakt = await this.#client.ruf('kontakte.uebernimm', {
        armored: null, binaer: einladung.schluessel, name: einladung.name,
      });
      // Den eigenen Schlüssel gleich zurückschicken, damit die Aufnahme
      // gegenseitig wird. Geht nur mit Modus B auf BEIDEN Seiten — schlägt es
      // fehl, ist das kein Fehler, sondern der Normalfall ohne Zustellserver.
      const zurueck = await this.#stelleDichVor(kontakt.fingerprint);
      this.#zeigeGegeneinladung(einladung.name, zurueck);
    } catch (fehler) {
      this.#meldung.textContent = fehlertext(fehler);
      this.#meldung.dataset['art'] = 'gefahr';
    }
  }
}
