/**
 * Die Schlüssel-Ansicht.
 *
 * ⚠️ Der gesperrte Zustand zeigt die Schlüssel weiterhin — nur eben gesperrt.
 *    Vorher gab es dort genau einen Handgriff (Passphrase eintippen), kein
 *    Zurück, keine Übersicht, keine Erklärung: eine Sackgasse für jeden, der
 *    aus Neugier auf „Sperren" geklickt hat. Dabei sind öffentliche Schlüssel
 *    gar nicht geheim und lassen sich auch gesperrt lesen und ausgeben.
 */

import type { CryptoClient } from '../../crypto/client.ts';
import { KlartextError } from '../../crypto/errors.ts';
import type { KeyInfo, VaultStatus } from '../../crypto/protocol.ts';
import { PasswortFeld } from '../components/passwortfeld.ts';
import { el, ersetze } from '../dom.ts';

function gruppiere(fingerprint: string): string {
  return (fingerprint.match(/.{1,4}/g) ?? []).join(' ');
}

function karte(...kinder: (Node | string | false | null)[]): HTMLElement {
  return el('section', { class: 'karte' }, ...kinder);
}

function knopfMit(beschriftung: string, beiKlick: () => void, klasse = ''): HTMLButtonElement {
  const knopf = el('button', { class: `knopf ${klasse}`.trim(), type: 'button', text: beschriftung });
  knopf.addEventListener('click', beiKlick);
  return knopf;
}

function verfahrenName(algorithmus: string, bits: number | null, kurve: string | null): string {
  if (bits !== null) return `RSA-${String(bits)}`;
  const kurven: Readonly<Record<string, string>> = {
    ed25519Legacy: 'Curve25519', curve25519Legacy: 'Curve25519',
    ed25519: 'Curve25519', curve25519: 'Curve25519',
    nistP256: 'NIST P-256', nistP384: 'NIST P-384', nistP521: 'NIST P-521',
    brainpoolP256r1: 'Brainpool P-256', brainpoolP384r1: 'Brainpool P-384',
    brainpoolP512r1: 'Brainpool P-512', secp256k1: 'secp256k1',
  };
  if (kurve !== null) return kurven[kurve] ?? kurve;
  return algorithmus;
}

export interface SchluesselOptionen {
  readonly client: CryptoClient;
  readonly beiAnlegen: () => void;
  readonly beiExport: (fingerprint: string) => void;
  readonly beiInfo: () => void;
}

export class SchluesselAnsicht {
  readonly wurzel = el('div', { class: 'ansicht' });
  readonly #client: CryptoClient;
  readonly #optionen: SchluesselOptionen;
  #meldung: HTMLElement | null = null;
  /** Welcher Schlüssel gerade umbenannt wird — null heisst: keiner. */
  #umbenennt: string | null = null;
  /**
   * Der zuletzt gezeichnete Zustand.
   *
   * ⚠️ Nötig, weil das Umbenennen die Ansicht neu zeichnen muss und der
   *    Zustand nur als Argument hereinkommt. Ihn zu erraten (etwa immer
   *    „unlocked") wäre falsch: die Sperre kann inzwischen zugefallen sein.
   */
  #letzterStatus: VaultStatus = {
    state: 'empty', keyCount: 0, lockAt: null, lastLockReason: null,
  };

  constructor(optionen: SchluesselOptionen) {
    this.#client = optionen.client;
    this.#optionen = optionen;
  }

  async zeichne(status: VaultStatus): Promise<void> {
    this.#letzterStatus = status;
    // Ein Zustandswechsel bricht eine offene Umbenennung ab — bei zugefallener
    // Sperre stünde sonst ein Formular da, das nichts mehr speichern kann.
    if (status.state !== 'unlocked') this.#umbenennt = null;
    if (status.state === 'empty') { this.#zeichneLeer(); return; }
    const schluessel = await this.#client.ruf('keys.list', {});
    if (status.state === 'locked') { this.#zeichneGesperrt(status, schluessel); return; }
    this.#zeichneOffen(schluessel);
  }

  // ------------------------------------------------------------------- leer

  #zeichneLeer(): void {
    const anlegen = knopfMit('Schlüssel anlegen', () => { this.#optionen.beiAnlegen(); }, 'haupt gross');
    // Kein zweiter Knopf neben dem Hauptknopf mehr — ein Textlink im Satz, der
    // ohnehin dorthin schickt. Ein <button> und kein <a>, weil der Router den
    // Weg kennt und keine Adresse nötig ist.
    const info = el('button', { class: 'textlink', type: 'button', text: 'Was klartext nicht kann' });
    info.addEventListener('click', () => { this.#optionen.beiInfo(); });

    ersetze(
      this.wurzel,
      karte(
        el('h2', { class: 'gross', text: 'Schick jemandem etwas, das unterwegs niemand lesen kann' }),
        // ⚠️ Ein Satz über das ANLIEGEN, bevor der Satz über die Technik kommt.
        //    Vorher stand hier zuerst „PGP, OpenPGP, Ciphertext, gpg" — wer die
        //    Begriffe kennt, war sofort zu Hause; alle anderen fanden keinen
        //    Satz über ihr eigenes Vorhaben.
        el('p', { class: 'vorspann', text:
          'Auch nicht der Dienst, über den du es schickst. Du behältst den Schlüssel dazu — ' +
          'hier auf diesem Gerät, ohne Konto und ohne Anmeldung.' }),
        el('p', {
          text:
            'klartext verschlüsselt, entschlüsselt, signiert und prüft OpenPGP, vollständig im ' +
            'Browser. Dein privater Schlüssel verlässt ihn nicht.',
        }),
        el('ul', { class: 'liste' },
          el('li', { text: 'Was gpg erzeugt, liest klartext. Was klartext erzeugt, liest gpg.' }),
          el('li', { text: 'Der Ciphertext geht über den Kanal, den du wählst — Signal, Mail, Matrix.' }),
          el('li', { text: 'Ohne Netz funktioniert es genauso, denn es gibt nichts zu fragen.' })),
        // ⚠️ Eigener Absatz, kein Listenpunkt: auf der Einrückung der Liste,
        //    aber ohne Punkt davor, las sich der Satz wie ein vierter, kaputter
        //    Eintrag — in jeder Fenstergrösse.
        el('p', { class: 'hinweis warnend abgesetzt' },
          info,
          document.createTextNode(' steht ausgeschrieben da. Bitte lies es, bevor du dich auf sie verlässt.')),
        // „Was klartext nicht kann" stand zweimal gleichzeitig auf dem Schirm —
        // als zweiter Knopf neben dem Hauptknopf und in der Fusszeile. Einmal
        // genügt; der Weg dorthin bleibt über den Satz darüber und den Fuss.
        el('div', { class: 'knopfreihe' }, anlegen),
      ),
      this.#meldungsfeld(),
    );
  }

  // --------------------------------------------------------------- gesperrt

  #zeichneGesperrt(status: VaultStatus, schluessel: readonly KeyInfo[]): void {
    const pw = new PasswortFeld({ id: 'pw', beschriftung: 'Passphrase', autocomplete: 'current-password' });

    const grund: Readonly<Record<string, string>> = {
      idle: 'Der Schlüsselbund hat sich nach Leerlauf von selbst gesperrt.',
      hidden: 'Der Schlüsselbund hat sich gesperrt, weil dieser Tab im Hintergrund war.',
      unload: 'Der Schlüsselbund wurde beim Verlassen der Seite gesperrt.',
      manual: 'Du hast den Schlüsselbund gesperrt.',
      error: 'Der Schlüsselbund wurde nach einem Fehler gesperrt.',
    };

    const form = el('form', { class: 'form', novalidate: true },
      pw.wurzel,
      el('button', { class: 'knopf haupt', type: 'submit', text: 'Entsperren' }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        try { await this.#client.entsperre(pw.wert); }
        catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
      })();
    });

    ersetze(
      this.wurzel,
      karte(
        el('h2', { text: 'Gesperrt' }),
        el('p', { class: 'hinweis', text: status.lastLockReason === null ? '' : grund[status.lastLockReason] ?? '' }),
        el('p', {
          text:
            'Deine Schlüssel liegen weiterhin hier — nur der private Teil ist verschlossen. ' +
            'Öffentliche Schlüssel kannst du auch jetzt ansehen und weitergeben, die sind ' +
            'nicht geheim.',
        }),
        form,
      ),
      el('h3', { class: 'ansicht-titel', text: 'Deine Schlüssel' }),
      ...schluessel.map((k) => this.#schluesselkarte(k, true)),
      this.#meldungsfeld(),
    );
    pw.eingabe.focus();
  }

  // ------------------------------------------------------------------ offen

  #zeichneOffen(schluessel: readonly KeyInfo[]): void {
    const ohneBackup = schluessel.filter((k) => !k.hasBackup);

    ersetze(
      this.wurzel,
      el('div', { class: 'kopfzeile ansicht-kopf' },
        el('h2', { class: 'ansicht-titel', text: 'Deine Schlüssel' }),
        knopfMit('Weiteren Schlüssel anlegen', () => { this.#optionen.beiAnlegen(); })),

      ohneBackup.length === 0 ? null : el('div', { class: 'warnkasten mahnung' },
        el('strong', { text: ohneBackup.length === 1 ? 'Ein Schlüssel ist nicht gesichert.' : `${String(ohneBackup.length)} Schlüssel sind nicht gesichert.` }),
        el('p', {
          class: 'hinweis',
          text:
            'Deine Passphrase ist kein Backup — sie entsperrt den Schlüssel nur in diesem ' +
            'Browser. Werden die Browserdaten gelöscht, ist er weg. Leg über „Sicherung ' +
            'erzeugen" eine Datei an und bewahre sie getrennt von der Passphrase auf.',
        })),

      this.#aufgaben(schluessel),
      ...schluessel.map((k) => this.#schluesselkarte(k, false)),
      this.#importKarte(),
      this.#meldungsfeld(),
    );
  }

  /**
   * „Was jetzt?" — die Frage, die nach dem Anlegen unbeantwortet blieb.
   *
   * Hier landen die zwei Schritte, die aus dem Assistenten herausgenommen
   * wurden (Widerrufszertifikat, Sicherung), plus der nächste sinnvolle
   * Handgriff. Bewusst KEIN Assistent und kein Zwang: eine Liste, die
   * verschwindet, sobald nichts mehr offen ist.
   *
   * ⚠️ Die rote Warnung über der fehlenden Sicherung bleibt bestehen. Diese
   *    Liste ist der WEG zur Erledigung, nicht ihr Ersatz — eine Aufgabe
   *    freundlich zu formulieren macht sie nicht weniger dringend.
   */
  #aufgaben(schluessel: readonly KeyInfo[]): HTMLElement | null {
    const eigener = schluessel.find((k) => k.isDefault) ?? schluessel[0];
    if (eigener === undefined) return null;

    const offen: HTMLElement[] = [];

    if (eigener.widerrufAt === null) {
      offen.push(this.#aufgabe(
        'Widerrufszertifikat anlegen',
        'Damit erklärst du den Schlüssel für ungültig, falls er dir abhandenkommt. ' +
        'Ohne dieses Zertifikat geht das nie mehr — es lässt sich nur mit dem ' +
        'Schlüssel erzeugen, den du dann nicht mehr hast.',
        'Jetzt erzeugen',
        () => { void this.#widerruf(eigener); }));
    }

    if (!eigener.hasBackup) {
      offen.push(this.#aufgabe(
        'Schlüssel sichern',
        'Eine Datei mit deinem privaten Schlüssel, getrennt von der Passphrase aufbewahrt. ' +
        'Ohne sie ist der Schlüssel weg, sobald die Browserdaten gelöscht werden.',
        'Sicherung erzeugen',
        () => { this.#optionen.beiExport(eigener.fingerprint); }));
    }

    if (offen.length === 0) return null;

    return el('section', { class: 'karte aufgabenkarte' },
      el('h3', { text: 'Als Nächstes' }),
      el('p', { class: 'hinweis', text: 'Zwei Dinge, die man einmal erledigt und danach nie wieder braucht — bis man sie braucht.' }),
      ...offen);
  }

  #aufgabe(titel: string, warum: string, knopfText: string, beiKlick: () => void): HTMLElement {
    return el('div', { class: 'aufgabe' },
      el('div', { class: 'aufgabe-text' },
        el('strong', { text: titel }),
        el('p', { class: 'hinweis', text: warum })),
      knopfMit(knopfText, beiKlick, 'haupt'));
  }

  #schluesselkarte(schluessel: KeyInfo, gesperrt: boolean): HTMLElement {
    const beschreibung = verfahrenName(schluessel.algorithm, schluessel.bits, schluessel.curve);

    const aktionen = el('div', { class: 'knopfreihe' },
      knopfMit('Öffentlichen Schlüssel geben', () => { void this.#exportOeffentlich(schluessel); }));

    if (!gesperrt) {
      aktionen.appendChild(knopfMit(
        schluessel.hasBackup ? 'Neue Sicherung erzeugen' : 'Sicherung erzeugen',
        () => { this.#optionen.beiExport(schluessel.fingerprint); },
        schluessel.hasBackup ? '' : 'haupt',
      ));
      aktionen.appendChild(knopfMit('Widerrufszertifikat', () => { void this.#widerruf(schluessel); }));
      aktionen.appendChild(knopfMit('Umbenennen', () => {
        this.#umbenennt = schluessel.fingerprint;
        void this.zeichne(this.#letzterStatus);
      }));
    }

    if (this.#umbenennt === schluessel.fingerprint) {
      return karte(
        el('div', { class: 'kopfzeile' }, el('h3', { text: schluessel.label })),
        el('p', { class: 'fingerprint', text: gruppiere(schluessel.fingerprint) }),
        this.#benenneUm(schluessel),
      );
    }

    // ⚠️ Hier stand `userIds[0] ?? label` — die Beschriftung wurde also nie
    //    angezeigt, solange es eine User-ID gab. Eine Umbenennung wäre
    //    unsichtbar geblieben. Jetzt führt die Beschriftung (die beim Anlegen
    //    auf die User-ID gesetzt wird), und die User-ID steht darunter, sobald
    //    sie abweicht — man soll immer sehen, was ANDERE sehen.
    const eigenerName = schluessel.label;
    const userId = schluessel.userIds[0] ?? null;

    return karte(
      el('div', { class: 'kopfzeile' },
        el('h3', { text: eigenerName }),
        schluessel.isDefault ? el('span', { class: 'pille', text: 'Standard' }) : null,
        schluessel.isRevoked ? el('span', { class: 'pille gefahr', text: 'widerrufen' }) : null,
        gesperrt ? el('span', { class: 'pille', text: 'gesperrt' }) : null,
        schluessel.hasBackup
          ? el('span', { class: 'pille gut', text: 'gesichert' })
          : el('span', { class: 'pille warnung', text: 'nicht gesichert' })),
      userId !== null && userId !== eigenerName
        ? el('p', { class: 'hinweis' },
            el('strong', { text: 'Andere sehen: ' }),
            document.createTextNode(userId))
        : null,
      el('p', { class: 'fingerprint', text: gruppiere(schluessel.fingerprint) }),
      el('p', {
        class: 'hinweis',
        text:
          `${beschreibung} · angelegt ${schluessel.created.slice(0, 10)}` +
          (schluessel.backupAt !== null ? ` · gesichert ${schluessel.backupAt.slice(0, 10)}` : ''),
      }),
      aktionen,
    );
  }

  /**
   * Umbenennen — nur die eigene Beschriftung.
   *
   * ⚠️ Der begleitende Satz ist der eigentliche Gehalt dieser Funktion. Wer
   *    hier umbenennt und glaubt, damit ändere sich der Name im Schlüssel,
   *    verlässt sich auf etwas, das nicht passiert ist: die User-ID steht
   *    unveränderlich im öffentlichen Schlüssel und reist mit jeder Kopie mit.
   */
  #benenneUm(schluessel: KeyInfo): HTMLElement {
    const feld = el('input', {
      type: 'text', id: `name-${schluessel.fingerprint.slice(-8)}`,
      value: schluessel.label, maxlength: '120',
      'aria-label': 'Name in deinem Schlüsselbund',
    });
    const form = el('form', { class: 'form umbenennen', novalidate: true },
      el('div', { class: 'feld' },
        el('label', { for: feld.id, text: 'Name in deinem Schlüsselbund' }),
        feld),
      el('p', { class: 'hinweis' },
        el('strong', { text: 'Nur für dich. ' }),
        document.createTextNode(
          'Der Name im Schlüssel selbst („' + (schluessel.userIds[0] ?? '—') + '") bleibt, wie er ist — ' +
          'er steht unveränderlich im öffentlichen Schlüssel, und jede Kopie davon trägt ihn weiter. ' +
          'Andere sehen also weiterhin den alten.')),
      el('div', { class: 'knopfreihe eng' },
        el('button', { class: 'knopf haupt', type: 'submit', text: 'Namen übernehmen' }),
        knopfMit('Abbrechen', () => { void this.zeichne(this.#letzterStatus); })));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        try {
          await this.#client.ruf('keys.beschrifte', {
            fingerprint: schluessel.fingerprint, label: feld.value,
          });
          this.#umbenennt = null;
          await this.zeichne(this.#letzterStatus);
          this.#melde('Name geändert — in deinem Schlüsselbund.', 'gut');
        } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
      })();
    });
    return form;
  }

  async #exportOeffentlich(schluessel: KeyInfo): Promise<void> {
    try {
      const ergebnis = await this.#client.ruf('keys.export', {
        fingerprint: schluessel.fingerprint, secret: false, exportPassphrase: null,
      });
      lade(ergebnis.filename, ergebnis.armored);
      this.#melde('Öffentlicher Schlüssel als Datei. Den darfst du weitergeben — er ist nicht geheim.', 'gut');
    } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
  }

  async #widerruf(schluessel: KeyInfo): Promise<void> {
    try {
      const { armored } = await this.#client.ruf('keys.revocationCertificate', {
        fingerprint: schluessel.fingerprint,
      });
      lade(`klartext-widerruf-${schluessel.fingerprint.slice(-16)}.asc`, armored);
      this.#melde('Widerrufszertifikat als Datei. Lege es getrennt vom Schlüssel ab.', 'gut');
    } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
  }

  #importKarte(): HTMLElement {
    const einfuhrPw = new PasswortFeld({ id: 'einfuhr-pw', beschriftung: 'Passphrase dieses Schlüssels' });
    const bereich = el('textarea', {
      id: 'einfuhr', class: 'block', rows: '6',
      placeholder: '-----BEGIN PGP PRIVATE KEY BLOCK-----',
      'aria-label': 'Privater Schlüssel im ASCII-Format',
    });

    const form = el('form', { class: 'form', novalidate: true },
      el('h3', { text: 'Vorhandenen Schlüssel übernehmen' }),
      el('p', {
        class: 'hinweis',
        text:
          'Ein privater Schlüssel aus GnuPG oder aus einer Sicherungsdatei. Er wird danach mit ' +
          'der Passphrase dieses Schlüsselbunds geschützt — ab dann gilt hier eine Passphrase ' +
          'für alles.',
      }),
      bereich, einfuhrPw.wurzel,
      el('button', { class: 'knopf', type: 'submit', text: 'Übernehmen' }));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        try {
          await this.#client.ruf('keys.import', {
            armored: bereich.value,
            passphrase: einfuhrPw.wert.length > 0 ? einfuhrPw.wert : null,
          });
          await this.#client.aktualisiereStatus();
          this.#melde('Schlüssel übernommen.', 'gut');
        } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
      })();
    });
    return karte(form);
  }

  #meldungsfeld(): HTMLElement {
    this.#meldung = el('p', { class: 'meldung', role: 'status', 'aria-live': 'polite' });
    return this.#meldung;
  }

  #melde(text: string, art: 'gut' | 'gefahr' | 'warnung' | 'neutral'): void {
    if (this.#meldung === null) return;
    this.#meldung.textContent = text;
    this.#meldung.dataset['art'] = art;
  }
}

export function lade(dateiname: string, inhalt: string): void {
  const blob = new Blob([inhalt], { type: 'application/pgp-keys' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: dateiname });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { URL.revokeObjectURL(url); }, 10_000);
}

export function fehlertext(fehler: unknown): string {
  return fehler instanceof KlartextError ? fehler.message : 'Unerwarteter Fehler.';
}
