/**
 * Der Postfachwächter.
 *
 * Er holt ab, was im eigenen Postfach liegt — **unabhängig davon, welche
 * Ansicht gerade offen ist**.
 *
 * ⚠️ Vorher lag das Abholen allein in der Gesprächsansicht. Wer noch keinen
 *    Kontakt hatte, öffnete nie ein Gespräch und holte darum nie ab: eine
 *    Vorstellung („ich habe deine Einladung angenommen") wäre für immer im
 *    Postfach liegengeblieben, bis sie nach sieben Tagen verfällt. Genau der
 *    Fall, um den es ging.
 *
 * ⚠️ Es darf nur EINEN Abholer geben. Zwei, die gleichzeitig lange abfragen,
 *    teilen sich die Nachrichten zufällig auf — der eine bekommt sie, der
 *    andere sieht nichts. Die Gesprächsansicht fragt deshalb nicht mehr selbst
 *    ab, sie lässt sich benachrichtigen.
 */

import type { CryptoClient } from '../crypto/client.ts';
import type { Postfach } from './postfach.ts';

/** So lange hält eine Langabfrage die Verbindung offen. */
const WARTEN_S = 25;
/** Nach einem Fehlschlag: erst einmal Ruhe, dann wieder versuchen. */
const RUHE_MS = 15_000;

export interface WaechterOptionen {
  readonly client: CryptoClient;
  readonly postfach: Postfach;
  /** Wird gerufen, wenn etwas angekommen ist — mit der Zahl der Vorstellungen. */
  readonly beiNeuem: (neue: number, vorstellungen: number) => void;
}

export class Postfachwaechter {
  readonly #client: CryptoClient;
  readonly #postfach: Postfach;
  readonly #beiNeuem: (neue: number, vorstellungen: number) => void;
  #laeuft = false;
  #gestoppt = false;

  constructor(optionen: WaechterOptionen) {
    this.#client = optionen.client;
    this.#postfach = optionen.postfach;
    this.#beiNeuem = optionen.beiNeuem;
  }

  /** Startet die Schleife, falls sie nicht schon läuft. */
  starte(): void {
    if (this.#laeuft) return;
    this.#gestoppt = false;
    this.#laeuft = true;
    void this.#schleife();
  }

  /**
   * Hält an.
   *
   * ⚠️ Muss beim Sperren geschehen: eine weiterlaufende Langabfrage hinter
   *    einem gesperrten Schlüsselbund hielte die Verbindung offen und verriete
   *    dem Server Anwesenheit, die ihn nichts angeht. Ausserdem könnte sie
   *    nichts entschlüsseln und würde alles als „unbekannt" ablegen.
   */
  stoppe(): void {
    this.#gestoppt = true;
    this.#laeuft = false;
  }

  async #schleife(): Promise<void> {
    try {
      while (!this.#gestoppt && this.#client.status.state === 'unlocked') {
        const eigener = await this.#eigenerFingerprint();
        if (eigener === null) { await warte(RUHE_MS); continue; }

        const lage = await this.#postfach.lage(eigener);
        if (!lage.aktiv) { await warte(RUHE_MS); continue; }

        // ⚠️ Postfach einrichten, sobald Modus B an ist — nicht erst, wenn man
        //    ein Gespräch öffnet. Genau daran scheiterte der gemeldete Fall:
        //    wer noch keinen Kontakt hat, öffnet nie ein Gespräch, richtet also
        //    nie ein Postfach ein und kann darum nie erfahren, dass jemand
        //    seine Einladung angenommen hat. Modus B einzuschalten heisst
        //    „ich möchte empfangen".
        if (!lage.eingerichtet) {
          const eingerichtet = await this.#postfach.richteEin(eigener);
          if (!eingerichtet.ok) { await warte(RUHE_MS); continue; }
        }

        // ⚠️ Zuerst das Ausstehende verschicken. Wer eine Einladung annimmt,
        //    tut das fast immer bei gesperrtem Bund (der Link lädt die Seite
        //    neu) — signieren geht dann nicht, also wurde die Vorstellung nur
        //    vorgemerkt. Hier ist der erste Moment, in dem sie gehen kann.
        await this.#holeVorstellungenNach(eigener);

        const ergebnis = await this.#postfach.holeNeues(eigener, WARTEN_S);
        if (!ergebnis.ok) { await warte(RUHE_MS); continue; }
        if (ergebnis.wert.neue > 0) {
          this.#beiNeuem(ergebnis.wert.neue, ergebnis.wert.vorstellungen);
        }
      }
    } finally {
      this.#laeuft = false;
    }
  }

  /**
   * Verschickt vorgemerkte Vorstellungen.
   *
   * Eine, die nicht durchgeht, bleibt vorgemerkt — der Empfänger könnte Modus
   * B erst später einschalten. Eine, die durchgeht, wird gestrichen: zweimal
   * dasselbe zu schicken hilft niemandem.
   */
  async #holeVorstellungenNach(eigener: string): Promise<void> {
    const offen = this.#client.einstellungen.offeneVorstellungen;
    if (offen.length === 0) return;

    const bleiben: string[] = [];
    for (const an of offen) {
      const ergebnis = await this.#postfach.stelleDichVor(eigener, an).catch(() => ({ ok: false as const }));
      if (!ergebnis.ok) bleiben.push(an);
    }
    if (bleiben.length !== offen.length) {
      await this.#client.setzeEinstellungen({ offeneVorstellungen: bleiben });
    }
  }

  async #eigenerFingerprint(): Promise<string | null> {
    try {
      const schluessel = await this.#client.ruf('keys.list', {});
      return (schluessel.find((k) => k.isDefault) ?? schluessel[0])?.fingerprint ?? null;
    } catch {
      return null;
    }
  }
}

function warte(ms: number): Promise<void> {
  return new Promise((fertig) => setTimeout(fertig, ms));
}
