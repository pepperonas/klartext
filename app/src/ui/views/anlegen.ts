/**
 * Der geführte Ablauf für den ersten Schlüssel.
 *
 * Aus einem langen Formular werden benannte Schritte. Jeder sagt, warum es ihn
 * gibt; weiter geht es erst, wenn er erledigt ist; zurück geht immer.
 *
 * Zwei Schritte sind neu und beheben echte Lücken:
 *
 *  · **Sichern** fragt drei Wörter nach Position ab. Der bisherige Haken
 *    „notiert" war eine Selbstauskunft, und das Wiederholfeld prüfte nichts,
 *    sobald der Vorschlag es mitfüllte.
 *  · **Backup** exportiert den privaten Schlüssel. Ohne das hält man die sechs
 *    Wörter für eine Sicherung — sie sind aber KEIN Seed: sie entsperren einen
 *    gespeicherten Schlüssel, sie stellen ihn nicht wieder her. Gelöschte
 *    Browserdaten bedeuten sonst den Verlust, mit dem Zettel in der Hand.
 */

import type { CryptoClient } from '../../crypto/client.ts';
import { KlartextError } from '../../crypto/errors.ts';
import type { KeyAlgorithm } from '../../crypto/protocol.ts';
import {
  einordnung,
  ziehePassphrase,
  type Passphrase,
} from '../../passphrase/generator.ts';
import { pruefe, waehlePositionen } from '../../passphrase/pruefung.ts';
import { druckblatt, kopierKnopf } from '../components/kopieren.ts';
import { PasswortFeld } from '../components/passwortfeld.ts';
import { Schrittleiste } from '../components/schritte.ts';
import { el, ersetze } from '../dom.ts';

const SCHRITTE = [
  { titel: 'Wer bist du' },
  { titel: 'Verfahren' },
  { titel: 'Passphrase' },
  { titel: 'Sichern' },
  { titel: 'Widerruf' },
  { titel: 'Backup' },
] as const;

export const LETZTER_SCHRITT = SCHRITTE.length;

interface Entwurf {
  name: string;
  email: string;
  algorithmus: KeyAlgorithm;
  vorschlag: Passphrase | null;
  eigene: string | null;
  positionen: number[];
  geprueft: boolean;
  zertifikat: string | null;
  zertifikatGeholt: boolean;
  fingerprint: string | null;
  backupGemacht: boolean;
}

export interface AnlegenOptionen {
  readonly client: CryptoClient;
  readonly beiSchritt: (schritt: number) => void;
  readonly beiFertig: () => void;
  readonly beiAbbruch: () => void;
}

export class AnlegenAblauf {
  readonly wurzel = el('div', { class: 'ansicht' });
  readonly #client: CryptoClient;
  readonly #beiSchritt: (schritt: number) => void;
  readonly #beiFertig: () => void;
  readonly #beiAbbruch: () => void;
  readonly #leiste = new Schrittleiste(SCHRITTE);
  #schritt = 1;
  #arbeitet = false;

  #entwurf: Entwurf = {
    name: '',
    email: '',
    algorithmus: 'rsa4096',
    vorschlag: null,
    eigene: null,
    positionen: [],
    geprueft: false,
    zertifikat: null,
    zertifikatGeholt: false,
    fingerprint: null,
    backupGemacht: false,
  };

  constructor(optionen: AnlegenOptionen) {
    this.#client = optionen.client;
    this.#beiSchritt = optionen.beiSchritt;
    this.#beiFertig = optionen.beiFertig;
    this.#beiAbbruch = optionen.beiAbbruch;
  }

  get passphrase(): string {
    return this.#entwurf.eigene ?? this.#entwurf.vorschlag?.text ?? '';
  }

  /** Vom Router aufgerufen. Springt nie weiter, als der Entwurf hergibt. */
  zeigeSchritt(gewuenscht: number): void {
    const erlaubt = Math.min(Math.max(1, gewuenscht), this.#hoechsterErreichbarer());
    this.#schritt = erlaubt;
    this.#zeichne();
    if (erlaubt !== gewuenscht) this.#beiSchritt(erlaubt);
  }

  #hoechsterErreichbarer(): number {
    const e = this.#entwurf;
    if (e.name.trim().length === 0) return 1;
    if (this.passphrase.length < 8) return 3;
    if (!e.geprueft) return 4;
    if (e.zertifikat === null) return 4;
    if (!e.zertifikatGeholt) return 5;
    return LETZTER_SCHRITT;
  }

  #weiter(): void {
    this.#beiSchritt(Math.min(this.#schritt + 1, LETZTER_SCHRITT));
  }

  #zurueck(): void {
    if (this.#schritt === 1) { this.#beiAbbruch(); return; }
    this.#beiSchritt(this.#schritt - 1);
  }

  // ------------------------------------------------------------------ Rahmen

  #zeichne(): void {
    const inhalt = this.#inhaltFuerSchritt();
    ersetze(
      this.wurzel,
      el('h2', { class: 'ansicht-titel', text: 'Neuen Schlüssel anlegen' }),
      this.#leiste.zeige(this.#schritt),
      el('section', { class: 'karte' }, inhalt),
    );
  }

  #inhaltFuerSchritt(): HTMLElement {
    switch (this.#schritt) {
      case 1: return this.#schrittIdentitaet();
      case 2: return this.#schrittVerfahren();
      case 3: return this.#schrittPassphrase();
      case 4: return this.#schrittSichern();
      case 5: return this.#schrittWiderruf();
      default: return this.#schrittBackup();
    }
  }

  #fuss(zurueckText: string, weiter: HTMLElement | null, hinweis?: string): HTMLElement {
    const zurueck = el('button', { class: 'knopf', type: 'button', text: zurueckText });
    zurueck.addEventListener('click', () => { this.#zurueck(); });
    return el(
      'div',
      { class: 'schritt-fuss' },
      hinweis === undefined ? null : el('p', { class: 'hinweis', text: hinweis }),
      el('div', { class: 'knopfreihe' }, zurueck, weiter),
    );
  }

  // ------------------------------------------------------------- 1 Identität

  #schrittIdentitaet(): HTMLElement {
    const name = el('input', { id: 'name', type: 'text', autocomplete: 'off', spellcheck: 'false' });
    name.value = this.#entwurf.name;
    const email = el('input', { id: 'email', type: 'email', autocomplete: 'off', spellcheck: 'false' });
    email.value = this.#entwurf.email;

    const weiter = el('button', { class: 'knopf haupt', type: 'button', text: 'Weiter' });
    const pruefeName = (): void => { weiter.disabled = name.value.trim().length === 0; };
    name.addEventListener('input', pruefeName);
    pruefeName();
    weiter.addEventListener('click', () => {
      this.#entwurf.name = name.value.trim();
      this.#entwurf.email = email.value.trim();
      this.#weiter();
    });

    return el(
      'div',
      { class: 'schritt-inhalt' },
      el('h3', { text: 'Wie soll dein Schlüssel heißen?' }),
      el('p', {
        class: 'hinweis',
        text:
          'Dieser Name steht sichtbar in deinem öffentlichen Schlüssel — daran erkennen ' +
          'dich andere, wenn du ihnen den Schlüssel gibst. Ein Spitzname genügt.',
      }),
      el('div', { class: 'feld' }, el('label', { for: 'name', text: 'Name oder Bezeichnung' }), name),
      el(
        'details',
        { class: 'ausklapp' },
        el('summary', { text: 'E-Mail-Adresse hinzufügen (optional)' }),
        el('p', {
          class: 'hinweis',
          text:
            'klartext braucht keine: hier ist deine Identität der Fingerprint. Sinnvoll ist ' +
            'sie nur, wenn du denselben Schlüssel auch für verschlüsselte E-Mail nutzen ' +
            'willst — Programme wie Thunderbird suchen danach.',
        }),
        el('p', {
          class: 'hinweis warnend',
          text:
            'Was hier steht, steht unveränderlich im öffentlichen Schlüssel. Jede Kopie ' +
            'trägt es weiter, zurücknehmen lässt es sich nicht.',
        }),
        el('div', { class: 'feld' }, el('label', { for: 'email', text: 'E-Mail' }), email),
      ),
      this.#fuss('Abbrechen', weiter),
    );
  }

  // -------------------------------------------------------------- 2 Verfahren

  #schrittVerfahren(): HTMLElement {
    const wahl = (wert: KeyAlgorithm, titel: string, text: string): HTMLElement => {
      const knopf = el('button', {
        class: `wahlkarte${this.#entwurf.algorithmus === wert ? ' an' : ''}`,
        type: 'button',
        'aria-pressed': this.#entwurf.algorithmus === wert ? 'true' : 'false',
      },
        el('span', { class: 'wahl-titel', text: titel }),
        el('span', { class: 'wahl-text', text }));
      knopf.addEventListener('click', () => {
        this.#entwurf.algorithmus = wert;
        this.#zeichne();
      });
      return knopf;
    };

    const weiter = el('button', { class: 'knopf haupt', type: 'button', text: 'Weiter' });
    weiter.addEventListener('click', () => { this.#weiter(); });

    return el(
      'div',
      { class: 'schritt-inhalt' },
      el('h3', { text: 'Welches Verfahren?' }),
      el('p', {
        class: 'hinweis',
        text: 'Beide sind sicher. Der Unterschied liegt darin, wer den Schlüssel später lesen kann.',
      }),
      el('div', { class: 'wahlreihe' },
        wahl('rsa4096', 'RSA-4096',
          'Versteht jedes GnuPG, auch alte Fassungen. Das Erzeugen dauert bis zu einer Minute.'),
        wahl('curve25519', 'Curve25519',
          'In einem Augenblick erzeugt und mindestens genauso sicher. Braucht GnuPG 2.1 oder neuer — praktisch überall vorhanden.')),
      this.#fuss('Zurück', weiter),
    );
  }

  // ------------------------------------------------------------- 3 Passphrase

  #schrittPassphrase(): HTMLElement {
    const inhalt = el('div', { class: 'schritt-inhalt' });
    const eigenModus = this.#entwurf.eigene !== null;

    const weiter = el('button', { class: 'knopf haupt', type: 'button', text: 'Weiter' });
    weiter.addEventListener('click', () => {
      this.#entwurf.geprueft = false;
      this.#entwurf.positionen = [];
      this.#weiter();
    });

    if (eigenModus) {
      const pw = new PasswortFeld({ id: 'pw', beschriftung: 'Passphrase' });
      const pw2 = new PasswortFeld({ id: 'pw2', beschriftung: 'Passphrase wiederholen' });
      pw.wert = this.#entwurf.eigene ?? '';
      const meldung = el('p', { class: 'meldung', role: 'status', 'aria-live': 'polite' });

      const pruefen = (): void => {
        const a = pw.wert;
        const b = pw2.wert;
        if (a.length > 0 && a.length < 12) {
          meldung.textContent = 'Kürzer als zwölf Zeichen — das ist wenig für etwas, das alles schützt.';
          meldung.dataset['art'] = 'warnung';
        } else if (b.length > 0 && a !== b) {
          meldung.textContent = 'Die beiden Eingaben sind noch nicht gleich.';
          meldung.dataset['art'] = 'gefahr';
        } else {
          meldung.textContent = '';
          meldung.removeAttribute('data-art');
        }
        weiter.disabled = a.length < 8 || a !== b;
        this.#entwurf.eigene = a;
      };
      pw.eingabe.addEventListener('input', pruefen);
      pw2.eingabe.addEventListener('input', pruefen);
      pruefen();

      const zurueckZumVorschlag = el('button', { class: 'knopf klein', type: 'button', text: 'Doch vorschlagen lassen' });
      zurueckZumVorschlag.addEventListener('click', () => {
        this.#entwurf.eigene = null;
        this.#entwurf.vorschlag = ziehePassphrase();
        this.#zeichne();
      });

      inhalt.append(
        el('h3', { text: 'Eigene Passphrase' }),
        el('p', {
          class: 'hinweis',
          text:
            'Vier zufällige Wörter sind besser als ein kurzes Wirrwarr aus Sonderzeichen — ' +
            'leichter zu merken und schwerer zu raten.',
        }),
        pw.wurzel, pw2.wurzel, meldung,
        el('div', { class: 'knopfreihe eng' }, zurueckZumVorschlag),
        this.#fuss('Zurück', weiter),
      );
      return inhalt;
    }

    this.#entwurf.vorschlag ??= ziehePassphrase();
    const p = this.#entwurf.vorschlag;

    const woerter = el('div', { class: 'vorschlag-woerter' },
      ...p.woerter.map((w, i) => el('div', { class: 'vorschlag-wort' },
        el('span', { class: 'vw-pos', text: String(i + 1) }),
        el('span', { class: 'vw-text', text: w.wort }),
        el('span', { class: 'vw-wuerfel', text: w.wuerfel }))));

    const nochmal = el('button', { class: 'knopf klein', type: 'button', text: 'Andere Wörter' });
    nochmal.addEventListener('click', () => {
      this.#entwurf.vorschlag = ziehePassphrase(p.woerter.length);
      this.#zeichne();
    });

    const selbst = el('button', { class: 'knopf klein', type: 'button', text: 'Lieber selbst tippen' });
    selbst.addEventListener('click', () => {
      this.#entwurf.eigene = '';
      this.#zeichne();
    });

    const chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Anzahl der Wörter' },
      ...[5, 6, 7, 8].map((n) => {
        const an = n === p.woerter.length;
        const chip = el('button', {
          class: `chip${an ? ' an' : ''}`, type: 'button',
          text: `${String(n)} Wörter`, 'aria-pressed': an ? 'true' : 'false',
        });
        chip.addEventListener('click', () => {
          this.#entwurf.vorschlag = ziehePassphrase(n);
          this.#zeichne();
        });
        return chip;
      }));

    inhalt.append(
      el('h3', { text: 'Das ist dein Vorschlag' }),
      el('p', {
        class: 'hinweis',
        text:
          `${String(p.woerter.length)} Wörter · ${String(Math.round(p.bits))} Bit — ${einordnung(p.bits)}. ` +
          'Gezogen aus dem Zufallsgenerator des Browsers, gleichverteilt über alle 7776 Wörter ' +
          'der Liste. Die kleine Zahl unter jedem Wort ist seine Würfelnummer.',
      }),
      woerter,
      chips,
      el('div', { class: 'knopfreihe eng' }, nochmal, selbst),
      el('p', { class: 'hinweis leise', text: 'Im nächsten Schritt sicherst du sie. Erst danach wird der Schlüssel erzeugt.' }),
      this.#fuss('Zurück', weiter),
    );
    return inhalt;
  }

  // ---------------------------------------------------------------- 4 Sichern

  #schrittSichern(): HTMLElement {
    const p = this.#entwurf.vorschlag;
    const eigen = this.#entwurf.eigene;
    const meldung = el('p', { class: 'meldung', role: 'status', 'aria-live': 'polite' });

    const weiter = el('button', { class: 'knopf haupt', type: 'button', text: 'Schlüssel jetzt erzeugen' });
    weiter.disabled = true;
    // ⚠️ Der Handler MUSS hier hängen, vor jedem frühen return. Stand er am Ende
    //    der Funktion, war der Knopf im Zweig „selbst getippt" eine Attrappe —
    //    dieselbe Falle wie beim Widerrufs-Schritt. Gefunden vom Offline-Test,
    //    weil der als einziger die selbst getippte Passphrase durchspielt.
    weiter.addEventListener('click', () => { void this.#erzeuge(weiter, meldung); });

    const inhalt = el('div', { class: 'schritt-inhalt' });

    // ---- Selbst getippt: einmal aus dem Gedächtnis wiederholen -------------
    if (eigen !== null || p === null) {
      const probe = new PasswortFeld({ id: 'probe', beschriftung: 'Passphrase noch einmal eingeben' });
      const pruefen = (): void => {
        const gleich = probe.wert === this.passphrase && probe.wert.length > 0;
        weiter.disabled = !gleich;
        this.#entwurf.geprueft = gleich;
        meldung.textContent = probe.wert.length > 0 && !gleich ? 'Stimmt noch nicht überein.' : '';
        meldung.dataset['art'] = 'gefahr';
      };
      probe.eingabe.addEventListener('input', pruefen);

      inhalt.append(
        el('h3', { text: 'Kannst du sie wiedergeben?' }),
        el('p', {
          class: 'hinweis',
          text:
            'Gib sie einmal aus dem Gedächtnis oder von deinem Zettel ein. Wenn du sie hier ' +
            'nicht zusammenbekommst, bekommst du sie später auch nicht zusammen — und dann ' +
            'ist der Schlüssel verloren.',
        }),
        probe.wurzel, meldung,
        this.#fuss('Zurück', weiter),
      );
      return inhalt;
    }

    // ---- Vorgeschlagen: sichern, dann drei Wörter nach Position ------------
    this.#entwurf.positionen = this.#entwurf.positionen.length > 0
      ? this.#entwurf.positionen
      : waehlePositionen(p.woerter.length);
    const positionen = this.#entwurf.positionen;

    const kopierMeldung = el('p', { class: 'meldung', role: 'status', 'aria-live': 'polite' });
    const kopieren = kopierKnopf({
      text: () => p.text,
      beschriftung: 'Passphrase kopieren',
      meldung: kopierMeldung,
    });
    const drucken = el('button', { class: 'knopf klein', type: 'button', text: 'Zum Ausdrucken' });
    drucken.addEventListener('click', () => {
      const ok = druckblatt({
        woerter: p.woerter,
        bezeichnung: this.#entwurf.name,
        datum: new Date().toISOString().slice(0, 10),
      });
      if (!ok) {
        kopierMeldung.textContent = 'Der Browser hat das Druckfenster blockiert — bitte Pop-ups erlauben.';
        kopierMeldung.dataset['art'] = 'gefahr';
      }
    });

    const felder = positionen.map((pos) => {
      const eingabe = el('input', {
        class: 'wortprobe', type: 'text', autocomplete: 'off',
        spellcheck: 'false', autocapitalize: 'off',
        'aria-label': `Wort Nummer ${String(pos)}`,
      });
      return { pos, eingabe };
    });

    const pruefen = (): void => {
      const ergebnis = pruefe(
        p.woerter.map((w) => w.wort),
        positionen,
        felder.map((f) => f.eingabe.value),
      );
      const vollstaendig = felder.every((f) => f.eingabe.value.trim().length > 0);
      this.#entwurf.geprueft = ergebnis.bestanden;
      weiter.disabled = !ergebnis.bestanden;

      for (const f of felder) {
        const falsch = vollstaendig && ergebnis.falsch.includes(f.pos);
        f.eingabe.classList.toggle('falsch', falsch);
      }
      if (ergebnis.bestanden) {
        meldung.textContent = 'Stimmt. Der Schlüssel kann erzeugt werden.';
        meldung.dataset['art'] = 'gut';
      } else if (vollstaendig) {
        meldung.textContent = `Noch nicht richtig: Wort ${ergebnis.falsch.join(', ')}. Schau auf deinem Zettel nach.`;
        meldung.dataset['art'] = 'gefahr';
      } else {
        meldung.textContent = '';
        meldung.removeAttribute('data-art');
      }
    };
    for (const f of felder) f.eingabe.addEventListener('input', pruefen);

    inhalt.append(
      el('h3', { text: 'Jetzt sichern — das ist der wichtigste Schritt' }),
      el('p', {
        class: 'hinweis',
        text:
          'Schreib die Wörter auf Papier oder leg sie in deinen Passwortmanager. Ohne sie ' +
          'kommst du nicht mehr an deinen Schlüssel; es gibt hier niemanden, der etwas ' +
          'zurücksetzen könnte.',
      }),
      el('div', { class: 'vorschlag-woerter' },
        ...p.woerter.map((w, i) => el('div', { class: 'vorschlag-wort' },
          el('span', { class: 'vw-pos', text: String(i + 1) }),
          el('span', { class: 'vw-text', text: w.wort }),
          el('span', { class: 'vw-wuerfel', text: w.wuerfel })))),
      el('div', { class: 'knopfreihe eng' }, kopieren, drucken),
      kopierMeldung,

      el('div', { class: 'warnkasten' },
        el('strong', { text: 'Das ist kein Backup deines Schlüssels.' }),
        el('p', {
          class: 'hinweis',
          text:
            'Anders als bei einer Krypto-Wallet stellen diese Wörter den Schlüssel nicht ' +
            'wieder her — sie entsperren ihn nur in diesem Browser. Löschst du die ' +
            'Browserdaten, ist der Schlüssel weg, auch mit dem Zettel in der Hand. Das ' +
            'eigentliche Backup legst du in Schritt 6 an.',
        })),

      el('h4', { class: 'unterabschnitt', text: 'Zur Kontrolle' }),
      el('p', {
        class: 'hinweis',
        text: 'Trag die folgenden Wörter von deinem Zettel ein — dann wissen wir beide, dass er stimmt.',
      }),
      el('div', { class: 'wortproben' },
        ...felder.map((f) => el('label', { class: 'wortprobe-zeile' },
          el('span', { text: `Wort ${String(f.pos)}` }), f.eingabe))),
      meldung,
      this.#fuss('Zurück', weiter),
    );

    return inhalt;
  }

  async #erzeuge(knopf: HTMLButtonElement, meldung: HTMLElement): Promise<void> {
    if (this.#arbeitet) return;
    this.#arbeitet = true;
    knopf.disabled = true;
    knopf.textContent = 'Erzeuge…';
    meldung.dataset['art'] = 'neutral';
    meldung.textContent = this.#entwurf.algorithmus === 'rsa4096'
      ? 'Der Schlüssel wird erzeugt. Bei RSA-4096 kann das bis zu einer Minute dauern — das ist normal, der Browser sucht große Primzahlen.'
      : 'Der Schlüssel wird erzeugt.';

    try {
      const ergebnis = await this.#client.ruf('keys.generate', {
        algorithm: this.#entwurf.algorithmus,
        userId: { name: this.#entwurf.name, email: this.#entwurf.email },
        passphrase: this.passphrase,
      });
      this.#entwurf.zertifikat = ergebnis.revocationCertificate;
      this.#entwurf.fingerprint = ergebnis.info.fingerprint;
      await this.#client.aktualisiereStatus();
      this.#weiter();
    } catch (fehler) {
      meldung.dataset['art'] = 'gefahr';
      meldung.textContent = fehler instanceof KlartextError ? fehler.message : 'Unerwarteter Fehler.';
      knopf.disabled = false;
      knopf.textContent = 'Noch einmal versuchen';
    } finally {
      this.#arbeitet = false;
    }
  }

  // --------------------------------------------------------------- 5 Widerruf

  #schrittWiderruf(): HTMLElement {
    const zertifikat = this.#entwurf.zertifikat ?? '';
    const weiter = el('button', { class: 'knopf haupt', type: 'button', text: 'Weiter' });
    weiter.disabled = !this.#entwurf.zertifikatGeholt;
    // ⚠️ Ohne diesen Handler ist der Knopf eine Attrappe — er sieht aus wie ein
    //    Weg nach vorn und tut nichts. Gefunden von tools/e2e/wegfindung.mjs,
    //    beim allerersten Lauf.
    weiter.addEventListener('click', () => { this.#weiter(); });

    const holen = el('button', { class: 'knopf haupt', type: 'button', text: 'Widerrufszertifikat herunterladen' });
    holen.addEventListener('click', () => {
      lade('klartext-widerruf.asc', zertifikat);
      this.#entwurf.zertifikatGeholt = true;
      weiter.disabled = false;
      holen.textContent = 'Noch einmal herunterladen';
      holen.classList.remove('haupt');
    });

    return el(
      'div',
      { class: 'schritt-inhalt' },
      el('h3', { text: 'Der Schlüssel ist da — jetzt der Notausschalter' }),
      el('p', {
        class: 'hinweis',
        text:
          'Mit diesem Zertifikat erklärst du den Schlüssel für ungültig, falls du ihn ' +
          'verlierst oder er in falsche Hände gerät. Es hilft nur, wenn du es jetzt ' +
          'woanders ablegst — ohne es bleibt ein verlorener Schlüssel für immer gültig.',
      }),
      el('textarea', { class: 'block', readonly: true, rows: '8', 'aria-label': 'Widerrufszertifikat' }, zertifikat),
      el('div', { class: 'knopfreihe' }, holen),
      el('p', {
        class: 'hinweis leise',
        text: 'Weiter geht es, sobald du es heruntergeladen hast.',
      }),
      this.#fuss('Zurück', weiter),
    );
  }

  // ----------------------------------------------------------------- 6 Backup

  #schrittBackup(): HTMLElement {
    const meldung = el('p', { class: 'meldung', role: 'status', 'aria-live': 'polite' });
    const pw = new PasswortFeld({ id: 'backup-pw', beschriftung: 'Passwort für die Sicherungsdatei' });

    const fertig = el('button', { class: 'knopf haupt', type: 'button', text: 'Sicherung erzeugen' });
    fertig.addEventListener('click', () => { void this.#sichere(pw.wert, meldung); });

    const ueberspringen = el('button', { class: 'knopf', type: 'button', text: 'Ohne Sicherung fortfahren' });
    ueberspringen.addEventListener('click', () => {
      meldung.dataset['art'] = 'warnung';
      meldung.textContent =
        'Ohne Sicherung ist dein Schlüssel weg, sobald die Browserdaten gelöscht werden — ' +
        'auch mit der Passphrase. Du kannst sie jederzeit auf der Schlüsselseite nachholen.';
      const wirklich = el('button', { class: 'knopf gefahr', type: 'button', text: 'Verstanden, trotzdem weiter' });
      wirklich.addEventListener('click', () => { this.#beiFertig(); });
      ueberspringen.replaceWith(wirklich);
    });

    return el(
      'div',
      { class: 'schritt-inhalt' },
      el('h3', { text: 'Sicherung anlegen' }),
      el('p', {
        class: 'hinweis',
        text:
          'Das hier ist das eigentliche Backup: eine Datei mit deinem privaten Schlüssel. ' +
          'Mit ihr kommst du auf einem neuen Rechner oder nach einem gelöschten Browser ' +
          'wieder an deine Nachrichten. Die Passphrase allein reicht dafür nicht.',
      }),
      el('div', { class: 'warnkasten' },
        el('p', {
          class: 'hinweis',
          text:
            'Wähle ein anderes Passwort als deine Passphrase und leg die Datei getrennt ' +
            'davon ab — auf einem Stick, in einem Passwortmanager, nicht daneben.',
        })),
      pw.wurzel,
      meldung,
      el('div', { class: 'knopfreihe' }, ueberspringen, fertig),
    );
  }

  async #sichere(passwort: string, meldung: HTMLElement): Promise<void> {
    const fingerprint = this.#entwurf.fingerprint;
    if (fingerprint === null) return;
    if (passwort.length < 8) {
      meldung.dataset['art'] = 'gefahr';
      meldung.textContent = 'Das Passwort ist zu kurz — mindestens 8 Zeichen.';
      return;
    }
    try {
      const ergebnis = await this.#client.ruf('keys.export', {
        fingerprint, secret: true, exportPassphrase: passwort,
      });
      lade(ergebnis.filename, ergebnis.armored);
      this.#entwurf.backupGemacht = true;
      meldung.dataset['art'] = 'gut';
      meldung.textContent = 'Sicherung erzeugt. Behandle die Datei wie den Schlüssel selbst.';
      setTimeout(() => { this.#beiFertig(); }, 1200);
    } catch (fehler) {
      meldung.dataset['art'] = 'gefahr';
      meldung.textContent = fehler instanceof KlartextError ? fehler.message : 'Unerwarteter Fehler.';
    }
  }
}

function lade(dateiname: string, inhalt: string): void {
  const blob = new Blob([inhalt], { type: 'application/pgp-keys' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: dateiname });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { URL.revokeObjectURL(url); }, 10_000);
}
