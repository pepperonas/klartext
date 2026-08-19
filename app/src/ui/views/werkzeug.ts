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
import {
  GROSS_AB_BYTES,
  frageZiel,
  kannAufPlatteSchreiben,
  legeAb,
} from '../datei-ziel.ts';
import { zeigeMitZerfall } from '../components/zerfall.ts';
import { el, ersetze } from '../dom.ts';
import { fehlertext, lade } from './schluessel.ts';

const ERKENN_VERZUG_MS = 220;

export interface WerkzeugOptionen {
  readonly client: CryptoClient;
  readonly beiEntsperren: () => void;
  readonly beiAnlegen: () => void;
}

export class WerkzeugAnsicht {
  readonly wurzel = el('div', { class: 'ansicht' });
  readonly #client: CryptoClient;
  readonly #beiEntsperren: () => void;
  readonly #beiAnlegen: () => void;

  #eingabe = el('textarea', {
    id: 'wz-eingabe', class: 'block gross-feld', rows: '9',
    placeholder: 'Text schreiben — oder etwas einfügen, das du bekommen hast.',
    'aria-label': 'Text oder eingefügter OpenPGP-Block',
    spellcheck: 'false',
  });
  #erkanntZeile = el('p', { class: 'erkannt', role: 'status', 'aria-live': 'polite' });
  #aktionen = el('div', { class: 'knopfreihe' });
  /**
   * Was zu den Knöpfen gehört, aber kein Knopf ist: Optionen und Sperrgründe.
   *
   * ⚠️ Beides stand vorher IN der Knopfreihe. Die ist ein `flex`-Container, und
   *    das globale `input { width: 100% }` blies das Kästchen darin auf volle
   *    Breite auf, während die Beschriftung in eine schmale Spalte am Rand
   *    umbrach. Optionen sind keine Knöpfe und gehören darum darunter, nicht
   *    dazwischen.
   */
  #aktionsZusatz = el('div', { class: 'aktions-zusatz' });
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
  #abgetrennt = false;
  #erkennung: Erkennung | null = null;
  #erkennTimer: ReturnType<typeof setTimeout> | null = null;
  #status: VaultStatus['state'] = 'empty';

  constructor(optionen: WerkzeugOptionen) {
    this.#client = optionen.client;
    this.#beiEntsperren = optionen.beiEntsperren;
    this.#beiAnlegen = optionen.beiAnlegen;
    this.#eingabe.addEventListener('input', () => { this.#erkennenGleich(); });
  }

  async zeichne(status: VaultStatus): Promise<void> {
    this.#status = status.state;

    // ⚠️ Hier stand ein Frühausstieg: ohne eigenen Schlüssel zeigte das
    //    Werkzeug nur „Erst brauchst du einen Schlüssel". Der Satz dazu war zur
    //    Hälfte unwahr — an jemanden zu verschlüsseln und eine Signatur zu
    //    prüfen braucht NUR den fremden öffentlichen Schlüssel, nie einen
    //    eigenen. Der Krypto-Kern konnte das die ganze Zeit (`signiereMit:
    //    null`), allein die Oberfläche verbot es. Damit lag der erste Nutzen
    //    hinter dreizehn Schritten Assistent.
    //
    //    Jetzt wird derselbe Schirm gezeichnet; gesperrt ist nur, was wirklich
    //    einen eigenen Schlüssel braucht — mit dem Grund daneben.
    this.#schluessel = status.state === 'empty' ? [] : await this.#client.ruf('keys.list', {});
    if (this.#gewaehlt.size === 0) {
      const standard = this.#schluessel.find((k) => k.isDefault) ?? this.#schluessel[0];
      if (standard !== undefined) this.#gewaehlt.add(standard.fingerprint);
    }

    ersetze(
      this.wurzel,
      el('h2', { class: 'ansicht-titel', text: 'Werkzeug' }),
      status.state === 'locked' ? this.#gesperrtHinweis() : null,
      status.state === 'empty' ? this.#ohneSchluesselHinweis() : null,
      el('section', { class: 'karte' },
        el('div', { class: 'feld' },
          el('label', { for: 'wz-eingabe', text: 'Text oder eingefügter Block' }),
          this.#eingabe),
        this.#erkanntZeile,
        this.#aktionen,
        this.#aktionsZusatz),
      // ⚠️ Die Ergebniskarte stand hier zuletzt in der Liste — hinter „An wen?"
      //    und „Dateien". Das war keine Entscheidung, sondern die Stelle, an
      //    der eine nachträglich hinzugefügte Karte landet. Die Folge: zwischen
      //    dem, was man hineingibt, und dem, was herauskommt, lagen 730 px von
      //    zwei Karten, die Eingaben für die NÄCHSTE Handlung sind. Die App
      //    scrollte zwar selbst hin (gemessen 598 px, mobil 1067 px), aber die
      //    Zuordnung Eingabe → Ausgabe musste man sich merken statt sie zu
      //    sehen. Jetzt steht das Ergebnis unmittelbar unter seiner Eingabe.
      this.#ergebnisKarte,
      this.#empfaengerKarte,
      this.#dateiKarte(),
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

  /**
   * Was ohne eigenen Schlüssel geht — und was nicht.
   *
   * Bewusst dieselbe Form wie der Gesperrt-Hinweis: es ist derselbe Gedanke.
   * Die eine Hälfte des Werkzeugs braucht nur das Gegenüber, die andere den
   * eigenen Schlüssel.
   */
  #ohneSchluesselHinweis(): HTMLElement {
    const knopf = el('button', { class: 'knopf haupt', type: 'button', text: 'Schlüssel anlegen' });
    knopf.addEventListener('click', () => { this.#beiAnlegen(); });
    return el('div', { class: 'hinweiskasten' },
      el('strong', { text: 'Du kannst hier sofort loslegen.' }),
      el('p', {
        class: 'hinweis',
        text:
          'An jemanden verschlüsseln und Signaturen prüfen braucht nur den öffentlichen ' +
          'Schlüssel des Gegenübers — füge ihn unter „An wen?" ein. Zum Entschlüsseln und ' +
          'Signieren brauchst du einen eigenen.',
      }),
      el('div', { class: 'knopfreihe' }, knopf));
  }

  /**
   * Der Grund, warum eine Handlung gerade nicht geht — oder null.
   *
   * ⚠️ Vorher stand hier überall derselbe Satz („entsperren"). Ohne eigenen
   *    Schlüssel ist der falsch: da gibt es nichts zu entsperren.
   */
  #warumNicht(): string | null {
    if (this.#status === 'unlocked') return null;
    return this.#status === 'empty'
      ? 'Dafür brauchst du einen eigenen Schlüssel.'
      : 'Dafür muss der Schlüsselbund entsperrt sein.';
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
    ersetze(this.#aktionsZusatz);
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

    const warum = this.#warumNicht();
    switch (e.art) {
      case 'klartext':
        this.#aktion('Verschlüsseln', () => { void this.#verschluesseln(); }, 'haupt',
          this.#gewaehlt.size === 0 && this.#fremdKey.value.trim().length === 0
            ? 'Wähle zuerst mindestens einen Empfänger.' : null);
        // ⚠️ Aus „Signieren" und „Nur Signatur erzeugen" ist EIN Knopf plus
        //    eine Option geworden. Der Unterschied eingebettet/abgetrennt ist
        //    eine Fachfrage; als zwei gleich laute Knöpfe verlangte er eine
        //    Entscheidung von Leuten, die die Begriffe nicht kennen.
        this.#aktion('Signieren', () => { void this.#signierenJetzt(this.#abgetrennt); }, '', warum);
        if (warum === null) this.#aktionsZusatz.appendChild(this.#abgetrenntWahl());
        break;
      case 'nachricht':
        this.#aktion('Entschlüsseln', () => { void this.#entschluesseln(); }, 'haupt',
          warum ?? (e.fuerUns ? null : 'Diese Nachricht ist an keinen deiner Schlüssel gerichtet.'));
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

  /** Die Wahl zwischen eingebetteter und abgetrennter Signatur, im Klartext. */
  #abgetrenntWahl(): HTMLElement {
    const haken = el('input', { type: 'checkbox', id: 'wz-abgetrennt' });
    haken.checked = this.#abgetrennt;
    haken.addEventListener('change', () => { this.#abgetrennt = haken.checked; });
    return el('label', { class: 'nebenwahl' }, haken,
      el('span', { text: 'Signatur abgetrennt — sie kommt als eigener Block, der Text bleibt unverändert' }));
  }

  #aktion(text: string, beiKlick: () => void, klasse: string, gesperrtWeil: string | null): void {
    const knopf = el('button', { class: `knopf ${klasse}`.trim(), type: 'button', text });
    this.#aktionen.appendChild(knopf);
    if (gesperrtWeil === null) {
      knopf.addEventListener('click', beiKlick);
      return;
    }
    knopf.disabled = true;
    // ⚠️ Der Grund steht UNTER der Reihe und nennt seinen Knopf beim Namen.
    //    Zwischen den Knöpfen eingeschoben war bei zwei gesperrten Knöpfen
    //    nicht mehr zu sehen, welcher Grund zu welchem gehört.
    this.#aktionsZusatz.appendChild(el('p', { class: 'hinweis leise' },
      el('strong', { text: `${text}: ` }),
      document.createTextNode(gesperrtWeil)));
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
    // ⚠️ Hier stand der Haken auch bei GESPERRTEM Bund angehakt da — signiert
    //    wurde dann trotzdem nicht (`signiereMit` fällt auf null zurück), und
    //    zwar wortlos. Der Absender glaubte an eine Unterschrift, der Empfänger
    //    sah keine. Eine App, die Signaturen anbietet, darf eine zugesagte
    //    Signatur nicht stillschweigend weglassen.
    const kannSignieren = this.#status === 'unlocked' && this.#schluessel.length > 0;
    sig.checked = this.#signieren && kannSignieren;
    sig.disabled = !kannSignieren;
    sig.addEventListener('change', () => { this.#signieren = sig.checked; });

    this.#fremdKey.addEventListener('input', () => { this.#zeichneErkennung(); });

    const ohneEigenen = this.#schluessel.length === 0;

    ersetze(this.#empfaengerKarte,
      el('h3', { text: 'An wen?' }),
      el('p', { class: 'hinweis', text: ohneEigenen
        // Ohne eigenen Schlüssel wäre „nimm dich selbst mit" ein Rat, den man
        // gar nicht befolgen kann — und der Hinweis auf die Folge zählt hier
        // umso mehr: ohne eigenen Schlüssel liest man die eigene Nachricht nie
        // wieder.
        ? 'Füge den öffentlichen Schlüssel deines Gegenübers ein — nur wer hier steht, kann die '
          + 'Nachricht später lesen. Du selbst kannst sie danach nicht mehr öffnen; dafür '
          + 'bräuchtest du einen eigenen Schlüssel.'
        : 'Nur wer hier steht, kann die Nachricht später lesen. Dich selbst mitzunehmen ist meist '
          + 'sinnvoll — sonst kommst du an deine eigene Nachricht nicht mehr heran.' }),
      ...kaesten,
      // Ohne eigene Schlüssel ist dies das einzige Eingabefeld der Karte —
      // dann steht es offen statt hinter einem Aufklapper.
      ohneEigenen
        ? el('div', { class: 'feld' },
            el('label', { for: 'wz-fremd', text: 'Öffentlicher Schlüssel des Gegenübers' }),
            this.#fremdKey)
        : el('details', { class: 'ausklapp' },
            el('summary', { text: 'Fremden öffentlichen Schlüssel einfügen' }),
            el('p', { class: 'hinweis', text: 'Für jemanden, der nicht in deinen Kontakten steht — einmalig, ohne ihn aufzunehmen.' }),
            this.#fremdKey),
      ohneEigenen ? null : el('label', { class: `empfaenger${kannSignieren ? '' : ' gesperrt'}` }, sig,
        el('span', {},
          document.createTextNode('Mit meinem Standardschlüssel signieren — der Empfänger sieht dann, dass es wirklich von dir ist'),
          kannSignieren ? null : el('span', { class: 'hinweis',
            text: ' Dafür muss der Schlüsselbund entsperrt sein.' }))));
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
    // Genau EINMAL entscheiden, ob signiert wird — und dasselbe Ergebnis
    // danach im Text melden. Vorher wurde die Bedingung an der Aufrufstelle
    // gerechnet und nirgends erwähnt.
    const signaturSchluessel =
      this.#signieren && this.#status === 'unlocked' ? this.#standardFingerprint() : null;
    try {
      const { armored } = await this.#client.ruf('tool.verschluessele', {
        klartext: this.#eingabe.value,
        anFingerprints, anArmored,
        signiereMit: signaturSchluessel,
      });
      this.#zeigeErgebnis(
        signaturSchluessel === null ? 'Verschlüsselt' : 'Verschlüsselt und signiert',
        armored, 'zerfall',
        'Das kannst du über jeden Kanal schicken — Signal, Mail, Matrix. Lesen kann es nur, wer oben steht.'
        + (signaturSchluessel === null
          ? ' Ohne Unterschrift — der Empfänger kann nicht prüfen, dass es von dir stammt.'
          : ''));
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

    // ⚠️ Das Ziel wird VOR der Arbeit erfragt, nicht danach: showSaveFilePicker
    //    verlangt eine frische Nutzergeste, und die verfällt nach wenigen
    //    Sekunden. Nach dem Verschlüsseln einer grossen Datei wäre sie
    //    zuverlässig abgelaufen — also ausgerechnet dort, wo der direkte Weg
    //    auf die Platte etwas bringt.
    const grossesZiel =
      datei.size > GROSS_AB_BYTES && kannAufPlatteSchreiben()
        ? await frageZiel(verschluesselt ? datei.name.replace(/\.(gpg|pgp|asc)$/i, '') : `${datei.name}.gpg`)
        : null;

    const mb = String(Math.round(datei.size / 1024 / 1024));
    if (datei.size > GROSS_AB_BYTES) {
      this.#melde(
        grossesZiel !== null
          ? `${mb} MB. Das Ergebnis geht direkt auf die Platte — das spart die zweite Kopie im ` +
            'Arbeitsspeicher. Die Datei selbst wird trotzdem als Ganzes verarbeitet.'
          : `Die Datei ist ${mb} MB groß. Sie wird vollständig in den Arbeitsspeicher geladen — ` +
            'auf einem knappen Gerät kann der Tab das übelnehmen. Es läuft trotzdem los.',
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
        const wohin = await legeAb(grossesZiel, e.daten, () => { ladeBinaer(e.dateiname, e.daten); });
        this.#melde(`Entschlüsselt: ${e.dateiname}${wohin}${signaturKurz(e.signaturen)}`, 'gut');
      } else {
        const { anFingerprints, anArmored } = this.#empfaengerListe();
        // Wie beim Text: einmal entscheiden, dann dasselbe melden.
        const signaturSchluessel =
          this.#signieren && this.#status === 'unlocked' ? this.#standardFingerprint() : null;
        const e = await this.#client.ruf('datei.verschluessele', {
          datei, anFingerprints, anArmored,
          signiereMit: signaturSchluessel,
        });
        const wohin = await legeAb(grossesZiel, e.daten, () => { ladeBinaer(e.dateiname, e.daten); });
        this.#melde(
          `${signaturSchluessel === null ? 'Verschlüsselt' : 'Verschlüsselt und signiert'}: ` +
          `${e.dateiname}${wohin}`, 'gut');
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
