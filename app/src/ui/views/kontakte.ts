/**
 * Kontakte — die Schlüssel anderer Leute.
 *
 * Zwei Dinge bestimmen die Gestaltung:
 *
 *  · **Unverifiziert ist der Normalfall und wird dauerhaft markiert**, nicht
 *    nur beim Anlegen. Wer einen Schlüssel über einen Kanal bekommen hat, weiss
 *    nicht, ob unterwegs jemand einen anderen untergeschoben hat.
 *  · **Ein Schlüsselwechsel wird nie stillschweigend übernommen.** Er bekommt
 *    eine eigene, unübersehbare Ansicht.
 */

import type { CryptoClient } from '../../crypto/client.ts';
import type { Kontakt, VaultStatus } from '../../crypto/protocol.ts';
import { qrAnzeige } from '../components/qr-anzeige.ts';
import { Scanner, scannenMoeglich } from '../components/scanner.ts';
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

export interface KontakteOptionen {
  readonly client: CryptoClient;
  readonly beiEinladen: () => void;
  readonly beiGespraech: (fingerprint: string) => void;
}

export class KontakteAnsicht {
  readonly wurzel = el('div', { class: 'ansicht' });
  readonly #client: CryptoClient;
  readonly #beiEinladen: () => void;
  readonly #beiGespraech: (fingerprint: string) => void;
  #meldung = el('p', { class: 'meldung', role: 'status', 'aria-live': 'polite' });
  #schritt: 'liste' | 'pruefen' | 'wechsel' = 'liste';

  constructor(optionen: KontakteOptionen) {
    this.#client = optionen.client;
    this.#beiEinladen = optionen.beiEinladen;
    this.#beiGespraech = optionen.beiGespraech;
  }

  async zeichne(status: VaultStatus): Promise<void> {
    if (status.state === 'empty') {
      ersetze(this.wurzel, el('section', { class: 'karte' },
        el('h2', { text: 'Erst brauchst du einen eigenen Schlüssel' }),
        el('p', { text: 'Kontakte sind die Schlüssel anderer Leute. Ohne eigenen Schlüssel gibt es nichts auszutauschen.' })));
      return;
    }
    this.#schritt = 'liste';
    await this.#zeichneListe();
  }

  async #zeichneListe(): Promise<void> {
    const kontakte = await this.#client.ruf('kontakte.liste', {});
    const unverifiziert = kontakte.filter((k) => k.vertrauen === 'unverifiziert');

    ersetze(
      this.wurzel,
      el('div', { class: 'kopfzeile ansicht-kopf' },
        el('h2', { class: 'ansicht-titel', text: 'Kontakte' }),
        knopfMit('Jemanden einladen', () => { this.#beiEinladen(); }, 'haupt')),

      kontakte.length === 0
        ? el('section', { class: 'karte' },
            el('h3', { text: 'Noch niemand hier' }),
            el('p', {
              text:
                'Um jemandem etwas zu verschlüsseln, brauchst du dessen öffentlichen Schlüssel. ' +
                'Schick eine Einladung — oder füge unten einen Schlüssel ein, den du bekommen hast.',
            }))
        : null,

      unverifiziert.length === 0 ? null : el('div', { class: 'warnkasten' },
        el('strong', {
          text: unverifiziert.length === 1
            ? 'Ein Kontakt ist nicht verifiziert.'
            : `${String(unverifiziert.length)} Kontakte sind nicht verifiziert.`,
        }),
        el('p', {
          class: 'hinweis',
          text:
            'Solange der Fingerprint nicht über einen zweiten Kanal abgeglichen ist, kann ' +
            'zwischen euch jemand sitzen und mitlesen — beide Seiten sähen davon nichts. ' +
            'Lies den Fingerprint am Telefon vor oder scanne ihn beim nächsten Treffen.',
        })),

      ...kontakte.map((k) => this.#karte(k)),
      this.#einfuegeKarte(),
      this.#meldung,
    );
  }

  #karte(kontakt: Kontakt): HTMLElement {
    const verifiziert = kontakt.vertrauen === 'verifiziert';
    const verfahren = kontakt.bits !== null ? `RSA-${String(kontakt.bits)}`
      : kontakt.curve?.startsWith('ed25519') === true || kontakt.curve?.startsWith('curve25519') === true
        ? 'Curve25519' : (kontakt.curve ?? kontakt.algorithm);

    return el('section', { class: `karte kontakt${verifiziert ? ' verifiziert' : ''}` },
      el('div', { class: 'kopfzeile' },
        el('h3', { text: kontakt.name }),
        verifiziert
          ? el('span', { class: 'pille gut', text: 'verifiziert' })
          : el('span', { class: 'pille warnung', text: 'nicht verifiziert' }),
        kontakt.isRevoked ? el('span', { class: 'pille gefahr', text: 'widerrufen' }) : null),

      el('p', { class: 'fingerprint', text: gruppiert(kontakt.fingerprint) }),
      el('p', {
        class: 'hinweis',
        text: `${verfahren} · aufgenommen ${kontakt.angelegtAm.slice(0, 10)}` +
          (kontakt.verifiziertAm !== null ? ` · verifiziert ${kontakt.verifiziertAm.slice(0, 10)}` : ''),
      }),

      kontakt.frühereFingerprints.length === 0 ? null : el('p', {
        class: 'hinweis warnend',
        text:
          `Diese Person hatte früher ${String(kontakt.frühereFingerprints.length)} anderen Schlüssel. ` +
          'Wenn du davon nichts weisst, frag nach.',
      }),

      el('div', { class: 'knopfreihe' },
        knopfMit('Schreiben', () => { this.#beiGespraech(kontakt.fingerprint); }, 'haupt'),
        knopfMit(verifiziert ? 'Erneut abgleichen' : 'Fingerprint abgleichen',
          () => { this.#zeigeVerifikation(kontakt); }),
        knopfMit('Schlüssel geben', () => { void this.#gibSchluessel(kontakt); }),
        // ⚠️ `kontakte.umbenennen` lag seit Phase 3 fertig und getestet im
        //    Worker — und keine Ansicht rief es auf. Eine gebaute Fähigkeit,
        //    die niemand erreichen kann, ist keine Fähigkeit.
        knopfMit('Umbenennen', () => { this.#zeigeUmbenennen(kontakt); }),
        knopfMit('Entfernen', () => { void this.#loesche(kontakt); })));
  }

  /**
   * Der Name eines Kontakts ist ohnehin ÖRTLICH — er steht in deinem
   * Adressbuch, nicht im Schlüssel. Deshalb braucht das hier keine Warnung
   * wie beim eigenen Schlüssel: es ändert sich nichts, was jemand anderes
   * sieht, und die Identität hängt am Fingerprint, nicht am Namen.
   */
  #zeigeUmbenennen(kontakt: Kontakt): void {
    const feld = el('input', {
      type: 'text', id: 'kontakt-neuer-name', value: kontakt.name, maxlength: '120',
      'aria-label': 'Wie heisst die Person für dich?',
    });
    const form = el('form', { class: 'form', novalidate: true },
      el('h3', { text: 'Kontakt umbenennen' }),
      el('p', { class: 'hinweis', text:
        'Der Name steht nur in deinem Adressbuch. Wiedererkannt wird die Person am Fingerprint — '
        + 'der ändert sich dabei nicht.' }),
      el('p', { class: 'fingerprint klein', text: gruppiert(kontakt.fingerprint) }),
      el('div', { class: 'feld' },
        el('label', { for: 'kontakt-neuer-name', text: 'Wie heisst die Person für dich?' }),
        feld),
      el('div', { class: 'knopfreihe eng' },
        el('button', { class: 'knopf haupt', type: 'submit', text: 'Namen übernehmen' }),
        knopfMit('Abbrechen', () => { void this.#zeichneListe(); })));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        try {
          await this.#client.ruf('kontakte.umbenennen', {
            fingerprint: kontakt.fingerprint, name: feld.value,
          });
          await this.#zeichneListe();
          this.#melde(`Heisst jetzt „${feld.value.trim()}" in deinem Adressbuch.`, 'gut');
        } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
      })();
    });

    ersetze(this.wurzel,
      el('h2', { class: 'ansicht-titel', text: kontakt.name }),
      el('section', { class: 'karte' }, form),
      this.#meldung);
  }

  // ------------------------------------------------------------ Verifikation

  #scanner: Scanner | null = null;

  /** Kamera abschalten, wenn die Ansicht verlassen wird. */
  verlasse(): void {
    this.#scanner?.stoppe();
    this.#scanner = null;
  }

  #zeigeVerifikation(kontakt: Kontakt): void {
    this.#schritt = 'pruefen';
    this.verlasse();

    const zurueck = knopfMit('Zurück', () => { this.verlasse(); void this.#zeichneListe(); });
    const scanBereich = el('div', { class: 'scanbereich' });

    // Nur anbieten, wo es wirklich geht — ein Knopf, der nichts tut, ist
    // schlimmer als keiner.
    void scannenMoeglich().then((geht) => {
      if (!geht) {
        ersetze(scanBereich, el('p', {
          class: 'hinweis leise',
          text: 'Dieser Browser kann keine QR-Codes lesen — gleicht die Wörter ab, das geht überall.',
        }));
        return;
      }
      const scanMeldung = el('p', { class: 'meldung', role: 'status', 'aria-live': 'polite' });
      const starten = knopfMit('Code des Gegenübers scannen', () => {
        const scanner = new Scanner({
          beiFund: (text) => {
            const gelesen = text.replace(/\s+/g, '').toUpperCase();
            if (gelesen === kontakt.fingerprint) {
              scanMeldung.textContent = 'Stimmt überein. Der Schlüssel gehört zu diesem Code.';
              scanMeldung.dataset['art'] = 'gut';
              void this.#setzeVertrauen(kontakt, true);
              return true;
            }
            if (/^[0-9A-F]{40}$/.test(gelesen)) {
              scanMeldung.textContent =
                'Dieser Code gehört zu einem ANDEREN Schlüssel. Nicht bestätigen — frag nach, ' +
                'wessen Code du gerade siehst.';
              scanMeldung.dataset['art'] = 'gefahr';
              return true;
            }
            return false; // irgendein anderer QR-Code — weitersuchen
          },
          beiFehler: (meldung) => {
            scanMeldung.textContent = meldung;
            scanMeldung.dataset['art'] = 'gefahr';
          },
        });
        this.#scanner = scanner;
        ersetze(scanBereich, scanner.wurzel, scanMeldung,
          knopfMit('Scannen beenden', () => { this.verlasse(); ersetze(scanBereich); }));
        void scanner.starte();
      });
      ersetze(scanBereich, starten, scanMeldung);
    });

    ersetze(this.wurzel,
      el('h2', { class: 'ansicht-titel', text: `Fingerprint abgleichen — ${kontakt.name}` }),
      el('section', { class: 'karte' },
        el('p', {
          text:
            'Vergleicht diesen Fingerprint über einen ZWEITEN Kanal: ruf an, trefft euch, ' +
            'nutzt einen anderen Messenger. Nicht über denselben Weg, über den ihr die ' +
            'Schlüssel getauscht habt — wer dort mitliest, könnte auch den Fingerprint fälschen.',
        }),
        el('div', { class: 'abgleich' },
          el('div', { class: 'abgleich-woerter' },
            el('h3', { text: 'Zum Vorlesen' }),
            el('ol', { class: 'woerter' },
              ...kontakt.woerter.map((w) => el('li', { class: 'wort', text: w }))),
            el('p', { class: 'hinweis', text: 'Dreizehn Wörter. Wenn eines nicht passt, stimmt der Schlüssel nicht.' })),
          el('div', { class: 'abgleich-qr' },
            el('h3', { text: 'Zum Abscannen' }),
            qrAnzeige(kontakt.fingerprint, {
              beschriftung: `QR-Code mit dem Fingerprint von ${kontakt.name}`,
              stufe: 'Q',
            }),
            el('p', { class: 'fingerprint klein', text: gruppiert(kontakt.fingerprint) }),
            scanBereich)),

        el('div', { class: 'warnkasten' },
          el('p', {
            class: 'hinweis',
            text:
              'Nur bestätigen, wenn ALLE dreizehn Wörter übereinstimmen. Ein Angreifer, der ' +
              'sich dazwischensetzt, unterscheidet sich naturgemäss nur in Details.',
          })),

        el('div', { class: 'knopfreihe' },
          zurueck,
          knopfMit('Stimmt nicht überein', () => { void this.#setzeVertrauen(kontakt, false); }, 'gefahr'),
          knopfMit('Alle Wörter stimmen — verifiziert', () => { void this.#setzeVertrauen(kontakt, true); }, 'haupt'))),
      this.#meldung);
  }

  async #setzeVertrauen(kontakt: Kontakt, bestaetigt: boolean): Promise<void> {
    this.verlasse();
    try {
      await this.#client.ruf('kontakte.verifiziere', { fingerprint: kontakt.fingerprint, bestaetigt });
      await this.#zeichneListe();
      this.#melde(
        bestaetigt
          ? `${kontakt.name} ist jetzt verifiziert. Von hier an weisst du, mit wem du sprichst.`
          : `${kontakt.name} bleibt unverifiziert. Wenn die Wörter nicht stimmten, frag nach, woher der Schlüssel kam.`,
        bestaetigt ? 'gut' : 'warnung');
    } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
  }

  // -------------------------------------------------------------- Einfügen

  #einfuegeKarte(): HTMLElement {
    const feld = el('textarea', {
      id: 'kontakt-key', class: 'block', rows: '5',
      placeholder: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
      'aria-label': 'Öffentlicher Schlüssel',
    });
    const name = el('input', { id: 'kontakt-name', type: 'text', autocomplete: 'off' });

    const form = el('form', { class: 'form', novalidate: true },
      el('h3', { text: 'Schlüssel einfügen' }),
      el('p', {
        class: 'hinweis',
        text: 'Einen öffentlichen Schlüssel, den du bekommen hast — aus einer Mail, einem Chat, von einem Stick.',
      }),
      feld,
      el('div', { class: 'feld' }, el('label', { for: 'kontakt-name', text: 'Wie heisst die Person für dich?' }), name),
      // „Prüfen" sagte nicht, was danach passiert — es entsteht ein Kontakt.
      // Und als einziger Knopf seiner Karte ist er der Hauptknopf.
      el('button', { class: 'knopf haupt', type: 'submit', text: 'Kontakt aufnehmen' }));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.#pruefeEinfuegung(feld.value, name.value);
    });
    return el('section', { class: 'karte' }, form);
  }

  async #pruefeEinfuegung(armored: string, name: string): Promise<void> {
    try {
      const ergebnis = await this.#client.ruf('kontakte.pruefe', { armored, binaer: null, name });
      if (ergebnis.art === 'schluesselwechsel') {
        this.#zeigeWechsel(armored, name, ergebnis.kontakt, ergebnis.bisher);
        return;
      }
      await this.#client.ruf('kontakte.uebernimm', { armored, binaer: null, name });
      await this.#zeichneListe();
      this.#melde(
        ergebnis.art === 'bekannt'
          ? 'Diesen Schlüssel hattest du schon — der Name wurde aufgefrischt.'
          : 'Aufgenommen. Gleiche jetzt den Fingerprint ab, sonst weisst du nicht, wessen Schlüssel das ist.',
        ergebnis.art === 'bekannt' ? 'neutral' : 'gut');
    } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
  }

  /**
   * Der Schlüsselwechsel bekommt eine eigene Ansicht.
   *
   * ⚠️ Er wird NIE beiläufig übernommen. Das ist die einzige Stelle, an der
   *    sich jemand unbemerkt einschleichen könnte.
   */
  #zeigeWechsel(armored: string, name: string, neu: Kontakt, bisher: Kontakt): void {
    this.#schritt = 'wechsel';

    ersetze(this.wurzel,
      el('h2', { class: 'ansicht-titel', text: 'Achtung: anderer Schlüssel' }),
      el('section', { class: 'karte' },
        el('div', { class: 'warnkasten mahnung' },
          el('strong', { text: `Für „${bisher.name}" kennst du bereits einen anderen Schlüssel.` }),
          el('p', {
            class: 'hinweis',
            text:
              'Das kann zweierlei bedeuten: Die Person hat sich einen neuen Schlüssel gemacht — ' +
              'oder jemand versucht gerade, sich zwischen euch zu setzen. Von aussen ist das ' +
              'nicht zu unterscheiden. Frag über einen Kanal nach, den du schon kennst, BEVOR ' +
              'du das übernimmst.',
          })),

        el('div', { class: 'gegenueber' },
          el('div', {},
            el('h3', { text: 'Bisher' }),
            el('p', { class: 'fingerprint klein', text: gruppiert(bisher.fingerprint) }),
            el('p', { class: 'hinweis', text: bisher.vertrauen === 'verifiziert' ? 'war verifiziert' : 'war nicht verifiziert' }),
            el('ol', { class: 'woerter klein' }, ...bisher.woerter.map((w) => el('li', { class: 'wort', text: w })))),
          el('div', {},
            el('h3', { text: 'Neu' }),
            el('p', { class: 'fingerprint klein', text: gruppiert(neu.fingerprint) }),
            el('p', { class: 'hinweis', text: 'nicht verifiziert' }),
            el('ol', { class: 'woerter klein' }, ...neu.woerter.map((w) => el('li', { class: 'wort', text: w }))))),

        el('div', { class: 'knopfreihe' },
          knopfMit('Abbrechen — alten Schlüssel behalten', () => { void this.#zeichneListe(); }),
          knopfMit('Ich habe nachgefragt: neuen Schlüssel übernehmen', () => {
            void this.#uebernimmWechsel(armored, name);
          }, 'gefahr'))),
      this.#meldung);
  }

  async #uebernimmWechsel(armored: string, name: string): Promise<void> {
    try {
      await this.#client.ruf('kontakte.uebernimm', { armored, binaer: null, name });
      await this.#zeichneListe();
      this.#melde('Neuer Schlüssel übernommen — und wieder als unverifiziert markiert. Gleiche den Fingerprint ab.', 'warnung');
    } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
  }

  // ------------------------------------------------------------- Kleinkram

  async #gibSchluessel(kontakt: Kontakt): Promise<void> {
    try {
      const { armored } = await this.#client.ruf('kontakte.schluessel', { fingerprint: kontakt.fingerprint });
      const blob = new Blob([armored], { type: 'application/pgp-keys' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `${kontakt.name.replace(/\W+/g, '-')}.pub.asc` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { URL.revokeObjectURL(url); }, 10_000);
    } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
  }

  async #loesche(kontakt: Kontakt): Promise<void> {
    try {
      await this.#client.ruf('kontakte.loesche', { fingerprint: kontakt.fingerprint });
      await this.#zeichneListe();
      this.#melde(`${kontakt.name} entfernt.`, 'neutral');
    } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
  }

  #melde(text: string, art: string): void {
    this.#meldung.textContent = text;
    this.#meldung.dataset['art'] = art;
  }

  get schritt(): string { return this.#schritt; }
}
