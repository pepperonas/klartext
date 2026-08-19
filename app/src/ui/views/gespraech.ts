/**
 * Die Gesprächsansicht.
 *
 * Sie funktioniert in BEIDEN Betriebsarten, und der Unterschied ist an einer
 * Stelle sichtbar:
 *
 *  · **Modus A** (Voreinstellung): Absenden erzeugt einen Ciphertext-Block zum
 *    Kopieren. Den schickst du über den Kanal deiner Wahl. Eingehendes fügst du
 *    hier ein.
 *  · **Modus B**: derselbe Ciphertext geht zusätzlich an den Zustellserver.
 *
 * ⚠️ Der Verlauf liegt als CIPHERTEXT im Browser und wird erst beim Anzeigen
 *    entschlüsselt — ein gesperrter Schlüsselbund zeigt hier nichts.
 */

import type { CryptoClient } from '../../crypto/client.ts';
import type { EntfaltetesGespraech, KeyInfo, Kontakt, SignaturBefund } from '../../crypto/protocol.ts';
import type { Postfach } from '../../relay/postfach.ts';
import { kopierKnopf } from '../components/kopieren.ts';
import { el, ersetze } from '../dom.ts';
import { fehlertext } from './schluessel.ts';

function knopfMit(text: string, beiKlick: () => void, klasse = ''): HTMLButtonElement {
  const knopf = el('button', { class: `knopf ${klasse}`.trim(), type: 'button', text });
  knopf.addEventListener('click', beiKlick);
  return knopf;
}

function zeitpunkt(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString('de-DE')} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
}

export interface GespraechOptionen {
  readonly client: CryptoClient;
  readonly postfach: Postfach;
  readonly beiZurueck: () => void;
}

export class GespraechAnsicht {
  readonly wurzel = el('div', { class: 'ansicht' });
  readonly #client: CryptoClient;
  readonly #postfach: Postfach;
  readonly #beiZurueck: () => void;
  #meldung = el('p', { class: 'meldung', role: 'status', 'aria-live': 'polite' });
  #kontakt: Kontakt | null = null;
  #eigener: KeyInfo | null = null;
  #abfrageLaeuft = false;
  #verlassen = false;

  constructor(optionen: GespraechOptionen) {
    this.#client = optionen.client;
    this.#postfach = optionen.postfach;
    this.#beiZurueck = optionen.beiZurueck;
  }

  /** Beendet die Langabfrage. Vom Router beim Wegnavigieren aufgerufen. */
  verlasse(): void {
    this.#verlassen = true;
  }

  async zeichne(kurzFingerprint: string): Promise<void> {
    this.#verlassen = false;
    const kontakte = await this.#client.ruf('kontakte.liste', {});
    const kontakt = kontakte.find((k) => k.fingerprint.endsWith(kurzFingerprint.toUpperCase()));
    if (kontakt === undefined) {
      ersetze(this.wurzel, el('section', { class: 'karte' },
        el('h2', { text: 'Diesen Kontakt gibt es hier nicht' }),
        el('div', { class: 'knopfreihe' }, knopfMit('Zu den Kontakten', () => { this.#beiZurueck(); }, 'haupt'))));
      return;
    }
    this.#kontakt = kontakt;
    const schluessel = await this.#client.ruf('keys.list', {});
    this.#eigener = schluessel.find((k) => k.isDefault) ?? schluessel[0] ?? null;

    await this.#zeichneGespraech();
    void this.#horche();
  }

  async #zeichneGespraech(): Promise<void> {
    const kontakt = this.#kontakt;
    if (kontakt === null) return;

    const verlauf = await this.#client.ruf('verlauf.liste', { kontaktFp: kontakt.fingerprint });
    const lage = this.#eigener === null
      ? null
      : await this.#postfach.lage(this.#eigener.fingerprint);

    const eingabe = el('textarea', {
      id: 'gespraech-text', class: 'block', rows: '4',
      placeholder: 'Nachricht schreiben…',
      'aria-label': `Nachricht an ${kontakt.name}`,
    });

    const senden = el('button', { class: 'knopf haupt', type: 'submit', text: 'Verschlüsseln und senden' });
    const form = el('form', { class: 'form', novalidate: true }, eingabe,
      el('div', { class: 'knopfreihe' },
        knopfMit('Zurück', () => { this.#beiZurueck(); }), senden));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.#sende(eingabe.value);
    });

    const einfuegen = el('textarea', {
      id: 'gespraech-empfangen', class: 'block', rows: '3',
      placeholder: '-----BEGIN PGP MESSAGE-----',
      'aria-label': 'Empfangene Nachricht einfügen',
    });
    const einfuegeForm = el('form', { class: 'form', novalidate: true },
      el('h3', { text: 'Nachricht einfügen' }),
      el('p', { class: 'hinweis', text: 'Etwas, das du über Signal, Mail oder sonstwie bekommen hast.' }),
      einfuegen,
      el('button', { class: 'knopf', type: 'submit', text: 'In den Verlauf übernehmen' }));
    einfuegeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.#nimmAuf(einfuegen.value);
    });

    ersetze(
      this.wurzel,
      el('div', { class: 'kopfzeile ansicht-kopf' },
        el('h2', { class: 'ansicht-titel', text: kontakt.name }),
        kontakt.vertrauen === 'verifiziert'
          ? el('span', { class: 'pille gut', text: 'verifiziert' })
          : el('span', { class: 'pille warnung', text: 'nicht verifiziert' })),

      kontakt.vertrauen === 'unverifiziert'
        ? el('div', { class: 'warnkasten' },
            el('strong', { text: 'Dieser Kontakt ist nicht verifiziert.' }),
            el('p', {
              class: 'hinweis',
              text:
                'Du weisst nicht sicher, wessen Schlüssel das ist — zwischen euch könnte jemand ' +
                'sitzen und mitlesen, ohne dass einer von euch etwas merkt. Gleicht den ' +
                'Fingerprint über einen zweiten Kanal ab.',
            }))
        : null,

      this.#modusZeile(lage),

      el('section', { class: 'karte' },
        verlauf.length === 0
          ? el('p', { class: 'hinweis', text: 'Noch keine Nachrichten.' })
          : el('div', { class: 'verlauf' }, ...verlauf.map((g) => this.#blase(g, kontakt.name))),
        form),

      el('section', { class: 'karte' }, einfuegeForm),
      this.#meldung,
    );
  }

  #modusZeile(lage: Awaited<ReturnType<Postfach['lage']>> | null): HTMLElement {
    if (lage === null || !lage.aktiv) {
      return el('div', { class: 'modus-zeile' },
        el('span', { class: 'pille', text: 'Modus A' }),
        el('span', {
          class: 'hinweis',
          text:
            'Kein Server im Spiel: Absenden erzeugt einen Block zum Kopieren, den du selbst ' +
            'verschickst. Modus B lässt sich in den Einstellungen einschalten — er ist bequemer, ' +
            'aber nicht sicherer.',
        }));
    }
    if (!lage.eingerichtet) {
      return el('div', { class: 'warnkasten' },
        el('strong', { text: 'Dein Postfach ist noch nicht eingerichtet.' }),
        el('p', {
          class: 'hinweis',
          text:
            'Dafür beweist du dem Server einmal, dass dir der Schlüssel gehört — er stellt eine ' +
            'Aufgabe, du unterschreibst sie. Danach vergisst er deinen öffentlichen Schlüssel ' +
            'wieder und behält nur ein Lesetoken.',
        }),
        el('div', { class: 'knopfreihe' },
          knopfMit('Postfach einrichten', () => { void this.#richteEin(); }, 'haupt')));
    }
    return el('div', { class: 'modus-zeile' },
      el('span', { class: 'pille gut', text: 'Modus B' }),
      el('span', { class: 'hinweis', text: 'Nachrichten gehen über den Zustellserver — er sieht nur Ciphertext.' }),
      knopfMit('Jetzt abholen', () => { void this.#holeAb(0); }));
  }

  #blase(gespraech: EntfaltetesGespraech, name: string): HTMLElement {
    const eigen = gespraech.eintrag.richtung === 'aus';
    return el('div', { class: `blase ${eigen ? 'eigen' : 'fremd'}` },
      el('div', { class: 'blase-kopf' },
        el('span', { class: 'blase-wer', text: eigen ? 'Du' : name }),
        el('span', { class: 'blase-zeit', text: zeitpunkt(gespraech.eintrag.zeit) }),
        ...gespraech.signaturen.map((s) => signaturPille(s))),
      gespraech.klartext !== null
        ? el('p', { class: 'blase-text', text: gespraech.klartext })
        : el('p', { class: 'blase-text fehler', text: gespraech.fehler ?? 'Nicht lesbar.' }));
  }

  // ------------------------------------------------------------- Handlungen

  async #sende(text: string): Promise<void> {
    const kontakt = this.#kontakt;
    if (kontakt === null || text.trim().length === 0) return;

    try {
      // ⚠️ Sich selbst als Empfänger mitnehmen — sonst käme man an die eigene
      //    Nachricht im Verlauf nicht mehr heran.
      const eigene = this.#eigener === null ? [] : [this.#eigener.fingerprint];
      const kontaktSchluessel = await this.#client.ruf('kontakte.schluessel', {
        fingerprint: kontakt.fingerprint,
      });
      const { armored } = await this.#client.ruf('tool.verschluessele', {
        klartext: text,
        anFingerprints: eigene,
        anArmored: [kontaktSchluessel.armored],
        signiereMit: this.#eigener?.fingerprint ?? null,
      });

      const eintrag = {
        id: `l:${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
        kontaktFp: kontakt.fingerprint,
        richtung: 'aus' as const,
        ciphertext: armored,
        zeit: Date.now(),
        zugestellt: false,
      };
      await this.#client.ruf('verlauf.lege', { eintrag });

      const lage = this.#eigener === null ? null : await this.#postfach.lage(this.#eigener.fingerprint);
      if (lage?.aktiv === true) {
        const ergebnis = await this.#postfach.sende(kontakt.fingerprint, armored);
        this.#melde(
          ergebnis.ok ? 'Zugestellt.' : ergebnis.fehler.meldung,
          ergebnis.ok ? 'gut' : 'gefahr');
      } else {
        this.#zeigeZumKopieren(armored);
      }
      await this.#zeichneGespraech();
    } catch (fehler) {
      this.#melde(fehlertext(fehler), 'gefahr');
    }
  }

  #zeigeZumKopieren(armored: string): void {
    const kopierMeldung = el('p', { class: 'meldung' });
    const karte = el('section', { class: 'karte' },
      el('h3', { text: 'Verschlüsselt — jetzt verschicken' }),
      el('p', {
        class: 'hinweis',
        text: 'Kopier den Block und schick ihn über den Kanal deiner Wahl. Lesen kann ihn nur dein Gegenüber.',
      }),
      el('pre', { class: 'ergebnis' }, armored),
      el('div', { class: 'knopfreihe' },
        kopierKnopf({ text: () => armored, beschriftung: 'Block kopieren', meldung: kopierMeldung })),
      kopierMeldung);
    this.wurzel.insertBefore(karte, this.wurzel.firstChild);
  }

  async #nimmAuf(armored: string): Promise<void> {
    const kontakt = this.#kontakt;
    if (kontakt === null || armored.trim().length === 0) return;
    try {
      const eintrag = {
        id: `l:${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
        kontaktFp: kontakt.fingerprint,
        richtung: 'ein' as const,
        ciphertext: armored,
        zeit: Date.now(),
        zugestellt: true,
      };
      await this.#client.ruf('verlauf.lege', { eintrag });
      await this.#zeichneGespraech();
      this.#melde('In den Verlauf übernommen.', 'gut');
    } catch (fehler) {
      this.#melde(fehlertext(fehler), 'gefahr');
    }
  }

  async #richteEin(): Promise<void> {
    if (this.#eigener === null) return;
    const ergebnis = await this.#postfach.richteEin(this.#eigener.fingerprint);
    if (ergebnis.ok) {
      this.#melde('Postfach eingerichtet. Der Server kennt jetzt nur noch ein Lesetoken.', 'gut');
      await this.#zeichneGespraech();
      void this.#horche();
    } else {
      this.#melde(ergebnis.fehler.meldung, 'gefahr');
    }
  }

  async #holeAb(wartenS: number): Promise<void> {
    const kontakt = this.#kontakt;
    if (kontakt === null || this.#eigener === null) return;
    const ergebnis = await this.#postfach.holeNeues(this.#eigener.fingerprint, kontakt.fingerprint, wartenS);
    if (!ergebnis.ok) {
      if (wartenS === 0) this.#melde(ergebnis.fehler.meldung, 'gefahr');
      return;
    }
    if (ergebnis.wert.neue > 0) await this.#zeichneGespraech();
  }

  /**
   * Lange Abfrage in Schleife — wacht auf, sobald etwas ankommt.
   *
   * ⚠️ Endet, sobald die Ansicht verlassen wird. Eine weiterlaufende Abfrage
   *    hinter einer geschlossenen Ansicht hielte die Verbindung offen und
   *    verriete dem Server Anwesenheit, die er nichts angeht.
   */
  async #horche(): Promise<void> {
    if (this.#abfrageLaeuft || this.#eigener === null) return;
    const lage = await this.#postfach.lage(this.#eigener.fingerprint);
    if (!lage.aktiv || !lage.eingerichtet) return;

    this.#abfrageLaeuft = true;
    try {
      while (!this.#verlassen && this.#client.status.state === 'unlocked') {
        await this.#holeAb(25);
      }
    } finally {
      this.#abfrageLaeuft = false;
    }
  }

  #melde(text: string, art: string): void {
    this.#meldung.textContent = text;
    this.#meldung.dataset['art'] = art;
  }
}

function signaturPille(s: SignaturBefund): HTMLElement {
  const klassen: Readonly<Record<SignaturBefund['zustand'], string>> = {
    gueltig: 'gut', ungueltig: 'gefahr', 'unbekannter-schluessel': 'warnung',
  };
  const texte: Readonly<Record<SignaturBefund['zustand'], string>> = {
    gueltig: 'signiert', ungueltig: 'Signatur UNGÜLTIG', 'unbekannter-schluessel': 'Unterzeichner unbekannt',
  };
  return el('span', { class: `pille klein ${klassen[s.zustand]}`, text: texte[s.zustand] });
}
