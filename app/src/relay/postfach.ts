/**
 * Der Umgang mit dem eigenen Postfach — Einrichten, Senden, Abholen.
 *
 * Bündelt Relay-Client, Krypto-Worker und Einstellungen an einer Stelle, damit
 * die Ansichten sich nicht mit Herausforderungen und Tokens befassen müssen.
 *
 * ⚠️ Modus B ist eine BEQUEMLICHKEIT, kein Sicherheitsgewinn. Ohne ihn
 *    funktioniert alles weiter — der Ciphertext wandert dann eben über den
 *    Kanal, den du selbst wählst.
 */

import type { CryptoClient } from '../crypto/client.ts';
import { pruefeHerkunft, RelayClient, type RelayErgebnis } from './client.ts';
import { herausforderungsText, postfachKennung } from './kennung.ts';

export interface Postfachlage {
  readonly aktiv: boolean;
  readonly url: string;
  readonly kennung: string | null;
  readonly eingerichtet: boolean;
}

export class Postfach {
  readonly #client: CryptoClient;

  constructor(client: CryptoClient) {
    this.#client = client;
  }

  #relay(): RelayClient | null {
    const url = this.#client.einstellungen.relayUrl.trim();
    if (!this.#client.einstellungen.relayAktiv || url.length === 0) return null;
    const geprueft = pruefeHerkunft(url, location.origin);
    if (!geprueft.ok) return null;
    return new RelayClient(geprueft.basis);
  }

  async lage(fingerprint: string): Promise<Postfachlage> {
    const e = this.#client.einstellungen;
    if (!e.relayAktiv || e.relayUrl.trim().length === 0) {
      return { aktiv: false, url: e.relayUrl, kennung: null, eingerichtet: false };
    }
    const kennung = await postfachKennung(fingerprint);
    return {
      aktiv: true, url: e.relayUrl, kennung,
      eingerichtet: typeof e.relayTokens[kennung] === 'string',
    };
  }

  /**
   * Richtet das eigene Postfach ein: Herausforderung holen, signieren,
   * Lesetoken entgegennehmen.
   *
   * Der Server rechnet dabei selbst nach, dass die Kennung zum Schlüssel
   * gehört — wir behaupten nichts, was er nicht prüfen könnte.
   */
  async richteEin(fingerprint: string): Promise<RelayErgebnis<{ kennung: string }>> {
    const relay = this.#relay();
    if (relay === null) return { ok: false, fehler: { art: 'abgelehnt', meldung: 'Modus B ist nicht eingeschaltet.' } };

    const kennung = await postfachKennung(fingerprint);
    const heraus = await relay.herausforderung(kennung);
    if (!heraus.ok) return heraus;

    const { signatur, schluessel } = await this.#client.ruf('relay.signiere', {
      fingerprint,
      text: herausforderungsText(kennung, heraus.wert.nonce),
    });

    const antwort = await relay.richteEin(kennung, schluessel, heraus.wert.nonce, signatur);
    if (!antwort.ok) return antwort;

    const tokens = { ...this.#client.einstellungen.relayTokens, [kennung]: antwort.wert.token };
    await this.#client.setzeEinstellungen({ relayTokens: tokens });
    return { ok: true, wert: { kennung } };
  }

  /** Ciphertext in das Postfach des Gegenübers legen. */
  async sende(empfaengerFingerprint: string, blob: string): Promise<RelayErgebnis<{ id: string }>> {
    const relay = this.#relay();
    if (relay === null) return { ok: false, fehler: { art: 'abgelehnt', meldung: 'Modus B ist nicht eingeschaltet.' } };
    return await relay.sende(await postfachKennung(empfaengerFingerprint), blob);
  }

  /**
   * Holt Neues ab und bestätigt es erst NACH dem Ablegen im Verlauf.
   *
   * ⚠️ Die Reihenfolge ist wichtig: erst lokal sichern, dann dem Server sagen,
   *    dass er löschen darf. Andersherum vernichtet ein Abbruch die Nachricht.
   */
  /**
   * Schickt die eigene Vorstellung an jemanden, dessen Schlüssel man gerade
   * aufgenommen hat — damit die Aufnahme gegenseitig wird.
   *
   * ⚠️ Die Postfach-Kennung des Gegenübers lässt sich aus seinem Fingerprint
   *    rechnen; es braucht also keinen Rückkanal und keine Verabredung. Ob
   *    dort überhaupt ein Postfach eingerichtet ist, weiss man vorher nicht —
   *    schlägt es fehl, sagt der Aufrufer es und bietet den Weg von Hand an.
   */
  async stelleDichVor(
    eigenerFingerprint: string,
    anFingerprint: string,
  ): Promise<RelayErgebnis<{ id: string }>> {
    const { nutzlast } = await this.#client.ruf('vorstellungen.baue', {
      fingerprint: eigenerFingerprint,
    });
    // ⚠️ Über `anArmored`, nicht `anFingerprints`: die Auflösung eines
    //    Fingerprints sucht ausschliesslich in den EIGENEN Schlüsseln, nicht
    //    in den Kontakten. Mit `anFingerprints` scheiterte das Verschlüsseln
    //    an einen Kontakt mit KEY_NOT_FOUND — und weil der Aufrufer den
    //    Fehlschlag nur als „nicht zugestellt" verbuchte, blieb die
    //    Vorstellung stumm in der Warteschlange liegen.
    const kontaktSchluessel = await this.#client.ruf('kontakte.schluessel', {
      fingerprint: anFingerprint,
    });
    const { armored } = await this.#client.ruf('tool.verschluessele', {
      klartext: nutzlast,
      anFingerprints: [],
      anArmored: [kontaktSchluessel.armored],
      // Signiert, damit die Gegenseite sieht, dass der Absender den privaten
      // Teil des mitgeschickten Schlüssels wirklich besitzt.
      signiereMit: eigenerFingerprint,
    });
    return await this.sende(anFingerprint, armored);
  }

  /**
   * Holt alles ab, was im eigenen Postfach liegt.
   *
   * ⚠️ Ohne Gesprächspartner — der Aufruf hatte einmal einen, und genau darin
   *    lag der Fehler: die Nachricht wurde dem zugeordnet, dessen Fenster
   *    gerade offen war. Wer der Absender ist, entscheidet die Signatur.
   */
  async holeNeues(
    eigenerFingerprint: string,
    wartenS = 0,
  ): Promise<RelayErgebnis<{ neue: number; vorstellungen: number }>> {
    const relay = this.#relay();
    if (relay === null) return { ok: false, fehler: { art: 'abgelehnt', meldung: 'Modus B ist nicht eingeschaltet.' } };

    const kennung = await postfachKennung(eigenerFingerprint);
    const token = this.#client.einstellungen.relayTokens[kennung];
    if (token === undefined) {
      return { ok: false, fehler: { art: 'nicht-berechtigt', meldung: 'Dieses Postfach ist noch nicht eingerichtet.' } };
    }

    const antwort = await relay.hole(kennung, token, wartenS);
    if (!antwort.ok) return antwort;

    // ⚠️ Hier stand: jede ankommende Nachricht bekam `kontaktFp:
    //    kontaktFingerprint` — also den Gesprächspartner, dessen Fenster
    //    gerade offen war. Das Postfach gehört einem selbst, und jeder darf
    //    hineinschreiben: sobald man mit zwei Leuten schrieb, landete eine
    //    Nachricht von Bob im Gespräch mit Carol. Wer sie geschickt hat, steht
    //    in der Signatur — dafür muss entschlüsselt werden, also entscheidet
    //    das jetzt der Worker.
    const angekommen: string[] = [];
    let vorstellungen = 0;
    for (const nachricht of antwort.wert.nachrichten) {
      const ergebnis = await this.#client.ruf('verlauf.nimmAn', {
        relayId: nachricht.id,
        blob: nachricht.blob,
        zeit: nachricht.erstellt * 1000,
      });
      if (ergebnis.art === 'vorstellung') vorstellungen += 1;
      angekommen.push(nachricht.id);
    }

    // Erst jetzt darf der Server löschen.
    if (angekommen.length > 0) await relay.bestaetige(kennung, token, angekommen);
    return { ok: true, wert: { neue: angekommen.length, vorstellungen } };
  }
}
