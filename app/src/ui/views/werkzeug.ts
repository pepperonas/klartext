/**
 * Das Werkzeug — Modus A.
 *
 * Bewusst KEINE Reiter für „verschlüsseln / entschlüsseln / signieren /
 * prüfen". Wer etwas eingefügt bekommt, weiß oft gar nicht, was es ist; er
 * müsste den richtigen Reiter erraten, bevor er anfangen kann.
 *
 * Stattdessen ein Feld: du fügst etwas ein, klartext sagt dir, was es ist, und
 * bietet an, was damit geht. Das ist derselbe Gedanke wie beim Rest der App —
 * der Nutzer soll wissen, was er tut, ohne es vorher zu wissen.
 */

import type { CryptoClient } from '../../crypto/client.ts';
import type { Erkennung, KeyInfo, SignaturBefund, VaultStatus } from '../../crypto/protocol.ts';
import { kopierKnopf } from '../components/kopieren.ts';
import { zeigeMitZerfall } from '../components/zerfall.ts';
import { el, ersetze } from '../dom.ts';
import { fehlertext, lade } from './schluessel.ts';

const ERKENN_VERZUG_MS = 220;

export interface WerkzeugOptionen {
  readonly client: CryptoClient;
  readonly beiEntsperren: () => void;
}

export class WerkzeugAnsicht {
  readonly wurzel = el('div', { class: 'ansicht' });
  readonly #client: CryptoClient;
  readonly #beiEntsperren: () => void;

  #eingabe = el('textarea', {
    id: 'wz-eingabe', class: 'block gross-feld', rows: '9',
    placeholder: 'Text schreiben — oder etwas einfügen, das du bekommen hast.',
    'aria-label': 'Text oder eingefügter OpenPGP-Block',
    spellcheck: 'false',
  });
  #erkanntZeile = el('p', { class: 'erkannt', role: 'status', 'aria-live': 'polite' });
  #aktionen = el('div', { class: 'knopfreihe' });
  #ergebnisKarte = el('section', { class: 'karte', hidden: true });
  #meldung = el('p', { class: 'meldung', role: 'status', 'aria-live': 'polite' });
  #empfaengerKarte = el('section', { class: 'karte' });
  #fremdKey = el('textarea', {
    id: 'wz-fremd', class: 'block', rows: '3',
    placeholder: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
    'aria-label': 'Öffentlicher Schlüssel eines Empfängers',
  });

  #schluessel: readonly KeyInfo[] = [];
  #gewaehlt = new Set<string>();
  #signieren = true;
  #erkennung: Erkennung | null = null;
  #erkennTimer: ReturnType<typeof setTimeout> | null = null;
  #status: VaultStatus['state'] = 'empty';

  constructor(optionen: WerkzeugOptionen) {
    this.#client = optionen.client;
    this.#beiEntsperren = optionen.beiEntsperren;
    this.#eingabe.addEventListener('input', () => { this.#erkennenGleich(); });
  }

  async zeichne(status: VaultStatus): Promise<void> {
    this.#status = status.state;

    if (status.state === 'empty') {
      ersetze(this.wurzel, el('section', { class: 'karte' },
        el('h2', { text: 'Erst brauchst du einen Schlüssel' }),
        el('p', { text: 'Ohne Schlüssel gibt es nichts zu ver- oder entschlüsseln. Leg zuerst einen an.' })));
      return;
    }

    this.#schluessel = await this.#client.ruf('keys.list', {});
    if (this.#gewaehlt.size === 0) {
      const standard = this.#schluessel.find((k) => k.isDefault) ?? this.#schluessel[0];
      if (standard !== undefined) this.#gewaehlt.add(standard.fingerprint);
    }

    ersetze(
      this.wurzel,
      el('h2', { class: 'ansicht-titel', text: 'Werkzeug' }),
      status.state === 'locked' ? this.#gesperrtHinweis() : null,
      el('section', { class: 'karte' },
        el('div', { class: 'feld' },
          el('label', { for: 'wz-eingabe', text: 'Text oder eingefügter Block' }),
          this.#eingabe),
        this.#erkanntZeile,
        this.#aktionen),
      this.#empfaengerKarte,
      this.#dateiKarte(),
      this.#ergebnisKarte,
      this.#meldung,
    );
    this.#zeichneEmpfaenger();
    await this.#erkennen();
  }

  #gesperrtHinweis(): HTMLElement {
    const knopf = el('button', { class: 'knopf haupt', type: 'button', text: 'Entsperren' });
    knopf.addEventListener('click', () => { this.#beiEntsperren(); });
    return el('div', { class: 'warnkasten' },
      el('strong', { text: 'Der Schlüsselbund ist gesperrt.' }),
      el('p', {
        class: 'hinweis',
        text:
          'Verschlüsseln und Signaturen prüfen geht auch so — dafür braucht es nur öffentliche ' +
          'Schlüssel. Zum Entschlüsseln und Signieren musst du entsperren.',
      }),
      el('div', { class: 'knopfreihe' }, knopf));
  }

  // ----------------------------------------------------------- Erkennung

  #erkennenGleich(): void {
    if (this.#erkennTimer !== null) clearTimeout(this.#erkennTimer);
    this.#erkennTimer = setTimeout(() => { void this.#erkennen(); }, ERKENN_VERZUG_MS);
  }

  async #erkennen(): Promise<void> {
    try {
      this.#erkennung = await this.#client.ruf('tool.erkenne', { eingabe: this.#eingabe.value });
    } catch {
      this.#erkennung = null;
    }
    this.#zeichneErkennung();
  }

  #zeichneErkennung(): void {
    const e = this.#erkennung;
    ersetze(this.#erkanntZeile);
    ersetze(this.#aktionen);
    if (e === null) return;

    this.#erkanntZeile.dataset['art'] = e.art;
    this.#erkanntZeile.appendChild(el('span', { class: 'erkannt-marke', text: marke(e.art) }));
    this.#erkanntZeile.appendChild(document.createTextNode(` ${e.beschreibung}`));
    if (e.fingerprint !== null) {
      this.#erkanntZeile.appendChild(el('span', {
        class: 'erkannt-fp',
        text: (e.fingerprint.match(/.{1,4}/g) ?? []).join(' '),
      }));
    }

    const offen = this.#status === 'unlocked';
    switch (e.art) {
      case 'klartext':
        this.#aktion('Verschlüsseln', () => { void this.#verschluesseln(); }, 'haupt',
          this.#gewaehlt.size === 0 && this.#fremdKey.value.trim().length === 0
            ? 'Wähle zuerst mindestens einen Empfänger.' : null);
        this.#aktion('Signieren', () => { void this.#signierenJetzt(false); }, '',
          offen ? null : 'Dafür muss der Schlüsselbund entsperrt sein.');
        this.#aktion('Nur Signatur erzeugen', () => { void this.#signierenJetzt(true); }, '',
          offen ? null : 'Dafür muss der Schlüsselbund entsperrt sein.');
        break;
      case 'nachricht':
        this.#aktion('Entschlüsseln', () => { void this.#entschluesseln(); }, 'haupt',
          !offen ? 'Dafür muss der Schlüsselbund entsperrt sein.'
            : e.fuerUns ? null : 'Diese Nachricht ist an keinen deiner Schlüssel gerichtet.');
        break;
      case 'signierter-text':
        this.#aktion('Signatur prüfen', () => { void this.#pruefen(); }, 'haupt', null);
        break;
      case 'signatur':
        this.#erkanntZeile.appendChild(el('span', {
          class: 'hinweis',
          text: ' Füge den zugehörigen Text unten ein, dann lässt sie sich prüfen.',
        }));
        break;
      case 'oeffentlicher-key':
        this.#aktion('Als Empfänger übernehmen', () => {
          this.#fremdKey.value = this.#eingabe.value;
          this.#eingabe.value = '';
          void this.#erkennen();
          this.#zeichneEmpfaenger();
          this.#melde('Als Empfänger übernommen. In Phase 3 wird daraus ein dauerhafter Kontakt.', 'gut');
        }, 'haupt', null);
        break;
      case 'privater-key':
        this.#erkanntZeile.appendChild(el('span', {
          class: 'hinweis',
          text: ' Solche Schlüssel gehören in den Schlüsselbund — dort gibt es „Vorhandenen Schlüssel übernehmen".',
        }));
        break;
    }
  }

  #aktion(text: string, beiKlick: () => void, klasse: string, gesperrtWeil: string | null): void {
    const knopf = el('button', { class: `knopf ${klasse}`.trim(), type: 'button', text });
    if (gesperrtWeil !== null) {
      knopf.disabled = true;
      knopf.title = gesperrtWeil;
      this.#aktionen.appendChild(knopf);
      this.#aktionen.appendChild(el('span', { class: 'hinweis leise', text: gesperrtWeil }));
      return;
    }
    knopf.addEventListener('click', beiKlick);
    this.#aktionen.appendChild(knopf);
  }

  // ---------------------------------------------------------- Empfänger

  #zeichneEmpfaenger(): void {
    const kaesten = this.#schluessel.map((k) => {
      const haken = el('input', { type: 'checkbox', id: `emp-${k.fingerprint.slice(-8)}` });
      haken.checked = this.#gewaehlt.has(k.fingerprint);
      haken.addEventListener('change', () => {
        if (haken.checked) this.#gewaehlt.add(k.fingerprint);
        else this.#gewaehlt.delete(k.fingerprint);
        this.#zeichneErkennung();
      });
      return el('label', { class: 'empfaenger' }, haken,
        el('span', {}, el('strong', { text: k.userIds[0] ?? k.label }),
          el('span', { class: 'hinweis', text: ` ${(k.fingerprint.match(/.{1,4}/g) ?? []).slice(-4).join(' ')}` })));
    });

    const sig = el('input', { type: 'checkbox', id: 'wz-sig' });
    sig.checked = this.#signieren;
    sig.addEventListener('change', () => { this.#signieren = sig.checked; });

    this.#fremdKey.addEventListener('input', () => { this.#zeichneErkennung(); });

    ersetze(this.#empfaengerKarte,
      el('h3', { text: 'An wen?' }),
      el('p', { class: 'hinweis', text: 'Nur wer hier steht, kann die Nachricht später lesen. Dich selbst mitzunehmen ist meist sinnvoll — sonst kommst du an deine eigene Nachricht nicht mehr heran.' }),
      ...kaesten,
      el('details', { class: 'ausklapp' },
        el('summary', { text: 'Fremden öffentlichen Schlüssel einfügen' }),
        el('p', { class: 'hinweis', text: 'Solange es keine Kontakte gibt (Phase 3), fügst du den Schlüssel deines Gegenübers hier ein.' }),
        this.#fremdKey),
      el('label', { class: 'empfaenger' }, sig,
        el('span', { text: 'Mit meinem Standardschlüssel signieren — der Empfänger sieht dann, dass es wirklich von dir ist' })));
  }

  #empfaengerListe(): { anFingerprints: string[]; anArmored: string[] } {
    const fremd = this.#fremdKey.value.trim();
    return {
      anFingerprints: [...this.#gewaehlt],
      anArmored: fremd.length > 0 ? [fremd] : [],
    };
  }

  #standardFingerprint(): string | null {
    return (this.#schluessel.find((k) => k.isDefault) ?? this.#schluessel[0])?.fingerprint ?? null;
  }

  // ------------------------------------------------------------ Aktionen

  async #verschluesseln(): Promise<void> {
    const { anFingerprints, anArmored } = this.#empfaengerListe();
    try {
      const { armored } = await this.#client.ruf('tool.verschluessele', {
        klartext: this.#eingabe.value,
        anFingerprints, anArmored,
        signiereMit: this.#signieren && this.#status === 'unlocked' ? this.#standardFingerprint() : null,
      });
      this.#zeigeErgebnis('Verschlüsselt', armored, 'zerfall',
        'Das kannst du über jeden Kanal schicken — Signal, Mail, Matrix. Lesen kann es nur, wer oben steht.');
    } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
  }

  async #entschluesseln(): Promise<void> {
    try {
      const e = await this.#client.ruf('tool.entschluessele', {
        armored: this.#eingabe.value,
        pruefeMit: this.#fremdKey.value.trim().length > 0 ? [this.#fremdKey.value.trim()] : [],
      });
      this.#zeigeErgebnis('Entschlüsselt', e.klartext, 'aufbau', null, e.signaturen);
    } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
  }

  async #signierenJetzt(abgetrennt: boolean): Promise<void> {
    const fingerprint = this.#standardFingerprint();
    if (fingerprint === null) return;
    try {
      const { armored } = await this.#client.ruf('tool.signiere', {
        text: this.#eingabe.value, fingerprint, abgetrennt,
      });
      this.#zeigeErgebnis(
        abgetrennt ? 'Signatur' : 'Signierter Text', armored, 'zerfall',
        abgetrennt
          ? 'Diese Signatur gehört zum Text — verschicke beides. Der Text bleibt dabei lesbar.'
          : 'Der Text bleibt lesbar, die Signatur hängt darunter.');
    } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
  }

  async #pruefen(): Promise<void> {
    try {
      const e = await this.#client.ruf('tool.pruefe', {
        text: this.#eingabe.value, signatur: null,
        schluessel: this.#fremdKey.value.trim().length > 0 ? [this.#fremdKey.value.trim()] : [],
      });
      this.#zeigeErgebnis('Geprüft', e.klartext ?? '', 'aufbau', null, e.signaturen);
    } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
  }

  // ------------------------------------------------------------- Ergebnis

  #zeigeErgebnis(
    titel: string,
    inhalt: string,
    richtung: 'zerfall' | 'aufbau',
    hinweis: string | null,
    signaturen: readonly SignaturBefund[] = [],
  ): void {
    const feld = el('pre', { class: 'ergebnis' });
    const kopierMeldung = el('p', { class: 'meldung' });

    ersetze(this.#ergebnisKarte,
      el('div', { class: 'kopfzeile' },
        el('h3', { text: titel }),
        ...signaturen.map((s) => signaturPille(s))),
      ...signaturen.map((s) => el('p', { class: 'hinweis', text: signaturText(s) })),
      feld,
      hinweis === null ? null : el('p', { class: 'hinweis', text: hinweis }),
      el('div', { class: 'knopfreihe' },
        kopierKnopf({ text: () => inhalt, beschriftung: 'Ergebnis kopieren', meldung: kopierMeldung }),
        knopfMit('Als Datei sichern', () => {
          lade(richtung === 'zerfall' ? 'klartext-nachricht.asc' : 'klartext-entschluesselt.txt', inhalt);
        }),
        knopfMit('Ins Eingabefeld übernehmen', () => {
          this.#eingabe.value = inhalt;
          void this.#erkennen();
        })),
      kopierMeldung);

    this.#ergebnisKarte.hidden = false;
    // ⚠️ Der Inhalt steht sofort im DOM; die Bewegung läuft darüber. Die
    //    Krypto wartet nie auf eine Animation.
    zeigeMitZerfall(feld, inhalt, richtung);
    this.#melde('', 'neutral');
    feld.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // -------------------------------------------------------------- Dateien

  #dateiKarte(): HTMLElement {
    const zone = el('div', { class: 'ablage', tabindex: '0', role: 'button',
      'aria-label': 'Datei hierher ziehen oder zum Auswählen klicken' },
      el('p', { text: 'Datei hierher ziehen' }),
      el('p', { class: 'hinweis', text: 'Zum Verschlüsseln jede Datei. Zum Entschlüsseln eine .gpg oder .asc.' }));

    // ⚠️ `aria-hidden` allein reicht nicht: ein <input type=file> bleibt
    //    fokussierbar, und ein für Hilfsmittel unsichtbares, aber per Tabulator
    //    erreichbares Element ist eine Falle. Bedient wird die Ablagefläche,
    //    die trägt die Beschriftung — die Eingabe selbst ist nur ihr Werkzeug.
    const auswahl = el('input', {
      type: 'file', class: 'weg', 'aria-hidden': 'true', tabindex: '-1',
    });
    zone.addEventListener('click', () => { auswahl.click(); });
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); auswahl.click(); }
    });
    auswahl.addEventListener('change', () => {
      const datei = auswahl.files?.[0];
      if (datei !== undefined) void this.#datei(datei);
    });

    for (const typ of ['dragenter', 'dragover'] as const) {
      zone.addEventListener(typ, (e) => { e.preventDefault(); zone.classList.add('bereit'); });
    }
    for (const typ of ['dragleave', 'drop'] as const) {
      zone.addEventListener(typ, () => { zone.classList.remove('bereit'); });
    }
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      const datei = e.dataTransfer?.files[0];
      if (datei !== undefined) void this.#datei(datei);
    });

    return el('section', { class: 'karte' },
      el('h3', { text: 'Dateien' }), zone, auswahl);
  }

  async #datei(datei: File): Promise<void> {
    const verschluesselt = /\.(gpg|pgp|asc)$/i.test(datei.name);
    if (datei.size > 100 * 1024 * 1024) {
      this.#melde(
        `Die Datei ist ${String(Math.round(datei.size / 1024 / 1024))} MB groß. Sie wird dabei ` +
        'vollständig in den Arbeitsspeicher geladen — auf einem knappen Gerät kann der Tab das ' +
        'übelnehmen. Es läuft trotzdem los.',
        'warnung');
    } else {
      this.#melde(verschluesselt ? 'Wird entschlüsselt…' : 'Wird verschlüsselt…', 'neutral');
    }

    try {
      if (verschluesselt) {
        if (this.#status !== 'unlocked') {
          this.#melde('Zum Entschlüsseln muss der Schlüsselbund entsperrt sein.', 'gefahr');
          return;
        }
        const e = await this.#client.ruf('datei.entschluessele', { datei, pruefeMit: [] });
        ladeBinaer(e.dateiname, e.daten);
        this.#melde(`Entschlüsselt: ${e.dateiname}${signaturKurz(e.signaturen)}`, 'gut');
      } else {
        const { anFingerprints, anArmored } = this.#empfaengerListe();
        const e = await this.#client.ruf('datei.verschluessele', {
          datei, anFingerprints, anArmored,
          signiereMit: this.#signieren && this.#status === 'unlocked' ? this.#standardFingerprint() : null,
        });
        ladeBinaer(e.dateiname, e.daten);
        this.#melde(`Verschlüsselt: ${e.dateiname}`, 'gut');
      }
    } catch (fehler) { this.#melde(fehlertext(fehler), 'gefahr'); }
  }

  #melde(text: string, art: string): void {
    this.#meldung.textContent = text;
    this.#meldung.dataset['art'] = art;
  }
}

// ------------------------------------------------------------------- Beiwerk

function marke(art: Erkennung['art']): string {
  const marken: Readonly<Record<Erkennung['art'], string>> = {
    klartext: 'Klartext', nachricht: 'Verschlüsselt', 'signierter-text': 'Signierter Text',
    signatur: 'Signatur', 'oeffentlicher-key': 'Öffentlicher Schlüssel', 'privater-key': 'Privater Schlüssel',
  };
  return marken[art];
}

function signaturPille(s: SignaturBefund): HTMLElement {
  const klassen: Readonly<Record<SignaturBefund['zustand'], string>> = {
    gueltig: 'gut', ungueltig: 'gefahr', 'unbekannter-schluessel': 'warnung',
  };
  const texte: Readonly<Record<SignaturBefund['zustand'], string>> = {
    gueltig: 'Signatur gültig', ungueltig: 'Signatur UNGÜLTIG', 'unbekannter-schluessel': 'Unterzeichner unbekannt',
  };
  return el('span', { class: `pille ${klassen[s.zustand]}`, text: texte[s.zustand] });
}

function signaturText(s: SignaturBefund): string {
  switch (s.zustand) {
    case 'gueltig':
      return `Unterschrieben von ${s.wer ?? s.keyId}. Der Text stammt von diesem Schlüssel und wurde seither nicht verändert.`;
    case 'ungueltig':
      return 'Die Signatur stimmt nicht. Entweder wurde der Text nachträglich verändert, oder er stammt nicht von dem angegebenen Schlüssel. Behandle ihn als unecht.';
    case 'unbekannter-schluessel':
      return `Unterschrieben mit dem Schlüssel ${s.keyId}, den klartext nicht kennt. Ob die Unterschrift echt ist, lässt sich ohne diesen Schlüssel nicht sagen — füge ihn oben als Empfänger ein, dann wird geprüft.`;
  }
}

function signaturKurz(signaturen: readonly SignaturBefund[]): string {
  if (signaturen.length === 0) return '';
  const s = signaturen[0];
  if (s === undefined) return '';
  return s.zustand === 'gueltig' ? ` · Signatur gültig (${s.wer ?? s.keyId})`
    : s.zustand === 'ungueltig' ? ' · ⚠ Signatur UNGÜLTIG'
    : ' · Unterzeichner unbekannt';
}

function knopfMit(text: string, beiKlick: () => void): HTMLElement {
  const knopf = el('button', { class: 'knopf', type: 'button', text });
  knopf.addEventListener('click', beiKlick);
  return knopf;
}

function ladeBinaer(dateiname: string, daten: Uint8Array): void {
  const blob = new Blob([daten as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: dateiname });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { URL.revokeObjectURL(url); }, 10_000);
}
