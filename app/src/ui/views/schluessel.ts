/**
 * Die Schluessel-Ansicht: erzeugen, entsperren, auflisten, aus- und einfuehren.
 *
 * Phase 1 hat bewusst nur diese eine Ansicht. Sie ist kein Wegwerf-Geruest,
 * sondern die spaetere "Schluessel"-Seite — Phase 2 legt das Werkzeug daneben.
 */

import type { CryptoClient } from '../../crypto/client.ts';
import { KlartextError } from '../../crypto/errors.ts';
import type { KeyAlgorithm, KeyInfo, VaultStatus } from '../../crypto/protocol.ts';
import { Vorschlag } from '../components/vorschlag.ts';
import { el, ersetze } from '../dom.ts';

function gruppiere(fingerprint: string): string {
  return (fingerprint.match(/.{1,4}/g) ?? []).join(' ');
}

/**
 * Interne Bezeichner von OpenPGP.js in etwas uebersetzen, das man einem
 * Menschen zeigen kann. "ed25519Legacy" ist der OID-Name des v4-Verfahrens —
 * korrekt, aber im UI eine Zumutung.
 */
function verfahrenName(algorithmus: string, bits: number | null, kurve: string | null): string {
  if (bits !== null) return `RSA-${String(bits)}`;
  const kurven: Readonly<Record<string, string>> = {
    ed25519Legacy: 'Curve25519',
    curve25519Legacy: 'Curve25519',
    ed25519: 'Curve25519',
    curve25519: 'Curve25519',
    nistP256: 'NIST P-256',
    nistP384: 'NIST P-384',
    nistP521: 'NIST P-521',
    brainpoolP256r1: 'Brainpool P-256',
    brainpoolP384r1: 'Brainpool P-384',
    brainpoolP512r1: 'Brainpool P-512',
    secp256k1: 'secp256k1',
  };
  if (kurve !== null) return kurven[kurve] ?? kurve;
  return algorithmus;
}

function karte(...kinder: (Node | string | false | null)[]): HTMLElement {
  return el('section', { class: 'karte' }, ...kinder);
}

function feld(id: string, beschriftung: string, art: string, hinweis?: string): HTMLElement {
  return el(
    'div',
    { class: 'feld' },
    el('label', { for: id, text: beschriftung }),
    el('input', { id, type: art, autocomplete: 'off', spellcheck: 'false' }),
    hinweis === undefined ? null : el('p', { class: 'hinweis', text: hinweis }),
  );
}

function wert(wurzel: HTMLElement, id: string): string {
  const eingabe = wurzel.querySelector<HTMLInputElement>(`#${id}`);
  return eingabe?.value ?? '';
}

export class SchluesselAnsicht {
  readonly wurzel = el('div', { class: 'ansicht' });
  readonly #client: CryptoClient;
  #meldung: HTMLElement | null = null;
  /**
   * Ein Zwischenschritt, den ein Statuswechsel NICHT wegraeumen darf.
   *
   * ⚠️ Ohne das hier ist das Widerrufszertifikat unsichtbar: das Erzeugen
   *    schaltet den Vault von "leer" auf "offen", der Statusbeobachter zeichnet
   *    daraufhin die Schluesselliste — und ueberschreibt die Seite mit dem
   *    Zertifikat, bevor der Nutzer sie zu Gesicht bekommt. Gefunden im echten
   *    Browserlauf; kein Test im Node-Umfeld haette das sehen koennen.
   */
  #schritt: 'widerruf' | 'export' | null = null;

  constructor(client: CryptoClient) {
    this.#client = client;
  }

  async zeichne(status: VaultStatus): Promise<void> {
    // Sperren und Leerlaufen setzen sich immer durch — ein Zwischenschritt darf
    // nicht darueber hinwegtaeuschen, dass der Schluesselbund zugegangen ist.
    if (status.state !== 'unlocked') this.#schritt = null;
    if (this.#schritt !== null) return;

    if (status.state === 'empty') { this.#zeichneLeer(); return; }
    if (status.state === 'locked') { this.#zeichneGesperrt(); return; }
    await this.#zeichneOffen();
  }

  // ------------------------------------------------------------------ leer

  #zeichneLeer(): void {
    const bestaetigung = el('label', { class: 'bestaetigung', hidden: true });
    const haken = el('input', { type: 'checkbox', id: 'notiert' });
    bestaetigung.appendChild(haken);
    bestaetigung.appendChild(
      el('span', { text: 'Ich habe die Passphrase notiert — an einem Ort, den ich wiederfinde.' }),
    );

    const absenden = el('button', { class: 'knopf haupt', type: 'submit', text: 'Schlüssel erzeugen' });

    const vorschlag = new Vorschlag({
      art: 'passphrase',
      beiUebernahme: (text) => {
        for (const id of ['pw', 'pw2']) {
          const feld = form.querySelector<HTMLInputElement>(`#${id}`);
          if (feld !== null) feld.value = text;
        }
        // ⚠️ Erst ab hier gilt die Bestätigungspflicht. Wer die Passphrase
        //    selbst getippt hat, kennt sie; wer sie vorgeschlagen bekam,
        //    hat sie vielleicht nur gesehen.
        bestaetigung.hidden = false;
        absenden.disabled = true;
        haken.checked = false;
      },
    });
    haken.addEventListener('change', () => { absenden.disabled = !haken.checked; });

    const form = el(
      'form',
      { class: 'form', novalidate: true },
      el('h2', { text: 'Ersten Schlüssel anlegen' }),
      el('p', {
        class: 'hinweis',
        text:
          'Der Schlüssel entsteht in diesem Browser und bleibt hier. Die Passphrase schützt ihn — ' +
          'ohne sie kommt niemand an ihn heran, auch du nicht.',
      }),

      feld('name', 'Name oder Bezeichnung', 'text',
        'Steht später sichtbar in deinem öffentlichen Schlüssel. Ein Spitzname tut es auch.'),

      // ---- E-Mail ist OPTIONAL ------------------------------------------
      // OpenPGP schreibt sie nirgends vor: gemessen mit gpg 2.5.21 — ein
      // Schlüssel mit reinem Namen wird importiert, gelistet und man kann an
      // ihn verschlüsseln. Die Adresse ist eine Konvention aus der Zeit, als
      // PGP fast nur für E-Mail benutzt wurde.
      el(
        'details',
        { class: 'ausklapp' },
        el('summary', { text: 'E-Mail-Adresse hinzufügen (optional)' }),
        el('p', {
          class: 'hinweis',
          text:
            'Hier ist deine Identität der Fingerprint, nicht eine Adresse — für klartext ' +
            'brauchst du keine. Sinnvoll ist sie nur, wenn du denselben Schlüssel auch für ' +
            'verschlüsselte E-Mail nutzen willst; Programme wie Thunderbird suchen danach.',
        }),
        el('p', {
          class: 'hinweis warnend',
          text:
            'Bedenke: Der Name steht unveränderlich im öffentlichen Schlüssel. Jede Kopie ' +
            'trägt ihn weiter, und zurücknehmen lässt sich das nicht.',
        }),
        el('div', { class: 'feld' },
          el('label', { for: 'email', text: 'E-Mail' }),
          el('input', { id: 'email', type: 'email', autocomplete: 'off', spellcheck: 'false' })),
      ),

      el(
        'div',
        { class: 'feld' },
        el('label', { for: 'algo', text: 'Verfahren' }),
        el(
          'select',
          { id: 'algo' },
          el('option', { value: 'rsa4096', text: 'RSA-4096 — höchste Kompatibilität' }),
          el('option', { value: 'curve25519', text: 'Curve25519 — schneller, moderner' }),
        ),
        el('p', {
          class: 'hinweis',
          text: 'RSA-4096 versteht jedes GnuPG. Die Erzeugung kann eine Minute dauern.',
        }),
      ),

      feld('pw', 'Passphrase', 'password', 'Lang und einprägsam schlägt kurz und kryptisch.'),
      el('div', { class: 'knopfreihe eng' }, vorschlag.knopf()),
      vorschlag.wurzel,
      feld('pw2', 'Passphrase wiederholen', 'password'),
      bestaetigung,
      absenden,
    );

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.#erzeuge(form);
    });
    ersetze(this.wurzel, karte(form), this.#meldungsfeld());
  }

  async #erzeuge(form: HTMLElement): Promise<void> {
    const pw = wert(form, 'pw');
    if (pw !== wert(form, 'pw2')) { this.#melde('Die beiden Passphrasen sind nicht gleich.', 'gefahr'); return; }
    if (pw.length < 8) { this.#melde('Die Passphrase ist zu kurz — mindestens 8 Zeichen.', 'gefahr'); return; }

    // ⚠️ NICHT `form.querySelector('button')` — seit der Vorschlags-Knopf im
    //    Formular steht, ist der erste Knopf nicht mehr der zum Absenden.
    //    Der falsche wurde deaktiviert und umbeschriftet.
    const knopf = form.querySelector<HTMLButtonElement>('button[type=submit]');
    if (knopf !== null) { knopf.disabled = true; knopf.textContent = 'Erzeuge…'; }
    this.#melde('Der Schlüssel wird erzeugt. Bei RSA-4096 kann das eine Minute dauern.', 'neutral');

    try {
      const auswahl = form.querySelector<HTMLSelectElement>('#algo')?.value ?? 'rsa4096';
      const ergebnis = await this.#client.ruf('keys.generate', {
        algorithm: auswahl as KeyAlgorithm,
        userId: { name: wert(form, 'name'), email: wert(form, 'email') },
        passphrase: pw,
      });
      // Reihenfolge ist wichtig: erst den Schritt setzen, dann den Status
      // auffrischen — sonst raeumt der Beobachter die Seite ab (siehe #schritt).
      this.#schritt = 'widerruf';
      this.#zeigeWiderrufszertifikat(ergebnis.revocationCertificate);
      await this.#client.aktualisiereStatus();
    } catch (fehler) {
      if (knopf !== null) { knopf.disabled = false; knopf.textContent = 'Schlüssel erzeugen'; }
      this.#melde(fehlertext(fehler), 'gefahr');
    }
  }

  #zeigeWiderrufszertifikat(zertifikat: string): void {
    ersetze(
      this.wurzel,
      karte(
        el('h2', { text: 'Schlüssel angelegt — jetzt das Widerrufszertifikat sichern' }),
        el('p', {
          class: 'hinweis',
          text:
            'Mit diesem Zertifikat kannst du den Schlüssel für ungültig erklären, falls du ihn ' +
            'verlierst oder er in falsche Hände gerät. Es hilft nur, wenn du es JETZT woanders ' +
            'ablegst — ausgedruckt oder auf einem Stick. Ohne es bleibt ein verlorener Schlüssel ' +
            'für immer gültig.',
        }),
        el('textarea', { class: 'block', readonly: true, rows: '10', 'aria-label': 'Widerrufszertifikat' }, zertifikat),
        el(
          'div',
          { class: 'knopfreihe' },
          knopfMit('Herunterladen', () => { lade('klartext-widerruf.asc', zertifikat); }),
          knopfMit('Weiter', () => { void this.#weiter(); }, 'haupt'),
        ),
      ),
    );
  }

  async #weiter(): Promise<void> {
    this.#schritt = null;
    await this.zeichne(this.#client.status);
  }

  // -------------------------------------------------------------- gesperrt

  #zeichneGesperrt(): void {
    const form = el(
      'form',
      { class: 'form', novalidate: true },
      el('h2', { text: 'Schlüsselbund entsperren' }),
      feld('pw', 'Passphrase', 'password'),
      el('button', { class: 'knopf haupt', type: 'submit', text: 'Entsperren' }),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        try {
          await this.#client.entsperre(wert(form, 'pw'));
        } catch (fehler) {
          this.#melde(fehlertext(fehler), 'gefahr');
        }
      })();
    });
    ersetze(this.wurzel, karte(form), this.#meldungsfeld());
    form.querySelector('input')?.focus();
  }

  // ---------------------------------------------------------------- offen

  async #zeichneOffen(): Promise<void> {
    const schluessel = await this.#client.ruf('keys.list', {});
    ersetze(
      this.wurzel,
      el('h2', { class: 'ansicht-titel', text: 'Deine Schlüssel' }),
      ...schluessel.map((k) => this.#schluesselkarte(k)),
      this.#importKarte(),
      this.#meldungsfeld(),
    );
  }

  #schluesselkarte(schluessel: KeyInfo): HTMLElement {
    const beschreibung = verfahrenName(schluessel.algorithm, schluessel.bits, schluessel.curve);
    return karte(
      el(
        'div',
        { class: 'kopfzeile' },
        el('h3', { text: schluessel.userIds[0] ?? schluessel.label }),
        schluessel.isDefault ? el('span', { class: 'pille', text: 'Standard' }) : null,
        schluessel.isRevoked ? el('span', { class: 'pille gefahr', text: 'widerrufen' }) : null,
      ),
      el('p', { class: 'fingerprint', text: gruppiere(schluessel.fingerprint) }),
      el('p', { class: 'hinweis', text: `${beschreibung} · angelegt ${schluessel.created.slice(0, 10)}` }),
      el(
        'div',
        { class: 'knopfreihe' },
        knopfMit('Öffentlichen Schlüssel', () => { void this.#exportiere(schluessel, false); }),
        knopfMit('Privaten Schlüssel', () => { void this.#exportiere(schluessel, true); }),
        knopfMit('Widerrufszertifikat', () => { void this.#widerruf(schluessel); }),
      ),
    );
  }

  async #exportiere(schluessel: KeyInfo, geheim: boolean): Promise<void> {
    if (geheim) { this.#zeigeExport(schluessel); return; }
    try {
      const ergebnis = await this.#client.ruf('keys.export', {
        fingerprint: schluessel.fingerprint,
        secret: false,
        exportPassphrase: null,
      });
      lade(ergebnis.filename, ergebnis.armored);
    } catch (fehler) {
      this.#melde(fehlertext(fehler), 'gefahr');
    }
  }

  /**
   * Export des privaten Schlüssels.
   *
   * Früher ein `prompt()` — das lässt sich weder gestalten noch mit der
   * Tastatur vernünftig bedienen, und ein Vorschlagsfeld passt schon gar nicht
   * hinein. Jetzt ein eigener Schritt, den ein Statuswechsel nicht wegräumt.
   */
  #zeigeExport(schluessel: KeyInfo): void {
    this.#schritt = 'export';

    const vorschlag = new Vorschlag({
      art: 'passwort',
      beiUebernahme: (text) => {
        const feld = form.querySelector<HTMLInputElement>('#export-pw');
        if (feld !== null) feld.value = text;
      },
    });

    const form = el(
      'form',
      { class: 'form', novalidate: true },
      el('h2', { text: 'Privaten Schlüssel ausführen' }),
      el('p', { class: 'fingerprint', text: gruppiere(schluessel.fingerprint) }),
      el('p', {
        class: 'hinweis',
        text:
          'Die Datei enthält deinen privaten Schlüssel. Das Passwort schützt sie außerhalb ' +
          'dieses Browsers — es ist nicht die Passphrase deines Schlüsselbunds und darf eine ' +
          'andere sein.',
      }),
      el('p', {
        class: 'hinweis warnend',
        text:
          'Der Export ist schwächer geschützt als der Schlüsselbund hier: er nutzt das ältere ' +
          'Verfahren iterated+salted statt Argon2id. Anders kann GnuPG die Datei nicht lesen.',
      }),
      feld('export-pw', 'Passwort für die Datei', 'password'),
      el('div', { class: 'knopfreihe eng' }, vorschlag.knopf()),
      vorschlag.wurzel,
      el(
        'div',
        { class: 'knopfreihe' },
        knopfMit('Abbrechen', () => { void this.#zurueck(); }),
        el('button', { class: 'knopf haupt', type: 'submit', text: 'Datei erzeugen' }),
      ),
    );

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        const passwort = wert(form, 'export-pw');
        if (passwort.length < 8) {
          this.#melde('Das Passwort ist zu kurz — mindestens 8 Zeichen.', 'gefahr');
          return;
        }
        try {
          const ergebnis = await this.#client.ruf('keys.export', {
            fingerprint: schluessel.fingerprint,
            secret: true,
            exportPassphrase: passwort,
          });
          lade(ergebnis.filename, ergebnis.armored);
          await this.#zurueck();
          this.#melde('Ausgeführt. Behandle die Datei wie den Schlüssel selbst.', 'warnung');
        } catch (fehler) {
          this.#melde(fehlertext(fehler), 'gefahr');
        }
      })();
    });

    ersetze(this.wurzel, karte(form), this.#meldungsfeld());
    form.querySelector('input')?.focus();
  }

  async #zurueck(): Promise<void> {
    this.#schritt = null;
    await this.zeichne(this.#client.status);
  }

  async #widerruf(schluessel: KeyInfo): Promise<void> {
    try {
      const { armored } = await this.#client.ruf('keys.revocationCertificate', {
        fingerprint: schluessel.fingerprint,
      });
      lade(`klartext-widerruf-${schluessel.fingerprint.slice(-16)}.asc`, armored);
    } catch (fehler) {
      this.#melde(fehlertext(fehler), 'gefahr');
    }
  }

  #importKarte(): HTMLElement {
    const form = el(
      'form',
      { class: 'form', novalidate: true },
      el('h3', { text: 'Schlüssel einfügen' }),
      el('p', {
        class: 'hinweis',
        text: 'Ein privater Schlüssel aus GnuPG oder einem Backup. Er wird danach mit der Passphrase dieses Schlüsselbunds geschützt.',
      }),
      el('textarea', {
        id: 'einfuhr',
        class: 'block',
        rows: '6',
        placeholder: '-----BEGIN PGP PRIVATE KEY BLOCK-----',
        'aria-label': 'Privater Schlüssel im ASCII-Format',
      }),
      feld('einfuhr-pw', 'Passphrase dieses Schlüssels', 'password'),
      el('button', { class: 'knopf', type: 'submit', text: 'Einfügen' }),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        try {
          const bereich = form.querySelector<HTMLTextAreaElement>('#einfuhr');
          await this.#client.ruf('keys.import', {
            armored: bereich?.value ?? '',
            passphrase: wert(form, 'einfuhr-pw') || null,
          });
          await this.#zeichneOffen();
          this.#melde('Schlüssel übernommen.', 'gut');
        } catch (fehler) {
          this.#melde(fehlertext(fehler), 'gefahr');
        }
      })();
    });
    return karte(form);
  }

  // -------------------------------------------------------------- Meldungen

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

function knopfMit(beschriftung: string, beiKlick: () => void, klasse = ''): HTMLElement {
  const knopf = el('button', { class: `knopf ${klasse}`.trim(), type: 'button', text: beschriftung });
  knopf.addEventListener('click', beiKlick);
  return knopf;
}

function lade(dateiname: string, inhalt: string): void {
  const blob = new Blob([inhalt], { type: 'application/pgp-keys' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: dateiname });
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Sofortiges Widerrufen kann den Download in Safari abschneiden.
  setTimeout(() => { URL.revokeObjectURL(url); }, 10_000);
}

function fehlertext(fehler: unknown): string {
  return fehler instanceof KlartextError ? fehler.message : 'Unerwarteter Fehler.';
}
