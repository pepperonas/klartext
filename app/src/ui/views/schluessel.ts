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

  constructor(optionen: SchluesselOptionen) {
    this.#client = optionen.client;
    this.#optionen = optionen;
  }

  async zeichne(status: VaultStatus): Promise<void> {
    if (status.state === 'empty') { this.#zeichneLeer(); return; }
    const schluessel = await this.#client.ruf('keys.list', {});
    if (status.state === 'locked') { this.#zeichneGesperrt(status, schluessel); return; }
    this.#zeichneOffen(schluessel);
  }

  // ------------------------------------------------------------------- leer

  #zeichneLeer(): void {
    const anlegen = knopfMit('Schlüssel anlegen', () => { this.#optionen.beiAnlegen(); }, 'haupt gross');
    const info = knopfMit('Was klartext nicht kann', () => { this.#optionen.beiInfo(); });

    ersetze(
      this.wurzel,
      karte(
        el('h2', { class: 'gross', text: 'PGP, das in deinem Browser bleibt' }),
        el('p', {
          text:
            'klartext verschlüsselt, entschlüsselt, signiert und prüft OpenPGP — vollständig ' +
            'hier auf diesem Gerät. Dein privater Schlüssel verlässt den Browser nicht, es gibt ' +
            'kein Konto und keine Anmeldung.',
        }),
        el('ul', { class: 'liste' },
          el('li', { text: 'Was gpg erzeugt, liest klartext. Was klartext erzeugt, liest gpg.' }),
          el('li', { text: 'Der Ciphertext geht über den Kanal, den du wählst — Signal, Mail, Matrix.' }),
          el('li', { text: 'Ohne Netz funktioniert es genauso, denn es gibt nichts zu fragen.' })),
        el('p', {
          class: 'hinweis warnend',
          text:
            'Was diese App NICHT kann, steht ausgeschrieben da — ein Tipp genügt. Bitte lies es, ' +
            'bevor du dich auf sie verlässt.',
        }),
        el('div', { class: 'knopfreihe' }, anlegen, info),
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

      ...schluessel.map((k) => this.#schluesselkarte(k, false)),
      this.#importKarte(),
      this.#meldungsfeld(),
    );
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
    }

    return karte(
      el('div', { class: 'kopfzeile' },
        el('h3', { text: schluessel.userIds[0] ?? schluessel.label }),
        schluessel.isDefault ? el('span', { class: 'pille', text: 'Standard' }) : null,
        schluessel.isRevoked ? el('span', { class: 'pille gefahr', text: 'widerrufen' }) : null,
        gesperrt ? el('span', { class: 'pille', text: 'gesperrt' }) : null,
        schluessel.hasBackup
          ? el('span', { class: 'pille gut', text: 'gesichert' })
          : el('span', { class: 'pille warnung', text: 'nicht gesichert' })),
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
