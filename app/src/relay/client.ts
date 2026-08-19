/**
 * Der Relay-Client — Modus B.
 *
 * ⚠️ **Dies ist die EINZIGE Datei in der App, die das Netz anspricht.** Der
 *    Test `vertrag.test.ts` hält das fest: überall sonst ist `fetch` verboten.
 *    Wer hier etwas hinzufügt, tut das an einer Stelle, die man findet.
 *
 * ⚠️ Und sie schickt ausschliesslich Ciphertext. Der Klartext existiert nur im
 *    Worker und in der Anzeige; hierher kommt er nie.
 *
 * Modus B ist eine Bequemlichkeit, kein Sicherheitsgewinn — Modus A braucht
 *    keinen Server. Die Oberfläche sagt das an der Stelle, an der man ihn
 *    einschaltet.
 *
 * ## Warum der Zustellserver unter DERSELBEN Herkunft liegen muss
 *
 * Die CSP der Seite erlaubt `connect-src 'self'`. Ein Server auf einem anderen
 * Host wird vom Browser abgelehnt, bevor auch nur eine Anfrage hinausgeht.
 *
 * ⚠️ Das ist keine Einschränkung, die man wegkonfigurieren sollte, sondern eine
 *    Eigenschaft: klartext kann strukturell mit niemandem sonst sprechen. Wer
 *    einen eigenen Zustellserver betreibt, hängt ihn unter seine eigene
 *    Adresse (etwa `/relay/`), statt die Richtlinie aufzuweichen. Aufgefallen
 *    ist das im zweiseitigen Abnahmetest — dort lief das Relay zunächst auf
 *    einem anderen Port, und der Browser liess die Anfrage gar nicht erst los.
 */

export const STANDARD_RELAY_PFAD = '/relay';

export type HerkunftsPruefung =
  | { readonly ok: true; readonly basis: string }
  | { readonly ok: false; readonly meldung: string };

/**
 * Prüft, ob eine Adresse unter der eigenen Herkunft liegt, und macht daraus
 * eine benutzbare Basis.
 */
export function pruefeHerkunft(eingabe: string, eigeneHerkunft: string): HerkunftsPruefung {
  const roh = eingabe.trim();
  if (roh.length === 0) return { ok: false, meldung: 'Keine Adresse angegeben.' };
  try {
    const url = new URL(roh, eigeneHerkunft);
    if (url.origin !== new URL(eigeneHerkunft).origin) {
      return {
        ok: false,
        meldung:
          'Diese Adresse liegt auf einem anderen Server. klartext spricht ausschliesslich mit ' +
          'der eigenen Herkunft — der Browser würde die Anfrage ohnehin blockieren. Häng deinen ' +
          `Zustellserver unter einen Pfad wie ${STANDARD_RELAY_PFAD}.`,
      };
    }
    return { ok: true, basis: url.pathname.replace(/\/+$/, '') };
  } catch {
    return { ok: false, meldung: 'Das ist keine gültige Adresse.' };
  }
}

export interface RelayFehler {
  readonly art: 'netz' | 'abgelehnt' | 'voll' | 'zu-viele' | 'nicht-berechtigt' | 'unbekannt';
  readonly meldung: string;
}

export type RelayErgebnis<T> =
  | { readonly ok: true; readonly wert: T }
  | { readonly ok: false; readonly fehler: RelayFehler };

export interface RelayNachricht {
  readonly id: string;
  readonly blob: string;
  readonly erstellt: number;
}

const MELDUNGEN: Readonly<Record<RelayFehler['art'], string>> = {
  netz: 'Der Zustellserver ist nicht erreichbar. Modus A funktioniert weiterhin — dafür braucht es keinen Server.',
  abgelehnt: 'Der Zustellserver hat die Anfrage abgelehnt.',
  voll: 'Das Postfach ist voll. Die Gegenseite muss erst abholen.',
  'zu-viele': 'Zu viele Anfragen in kurzer Zeit. Bitte einen Moment warten.',
  'nicht-berechtigt': 'Für dieses Postfach fehlt die Berechtigung — richte es neu ein.',
  unbekannt: 'Unerwartete Antwort vom Zustellserver.',
};

function fehler(art: RelayFehler['art']): { ok: false; fehler: RelayFehler } {
  return { ok: false, fehler: { art, meldung: MELDUNGEN[art] } };
}

function ausStatus(status: number): { ok: false; fehler: RelayFehler } {
  if (status === 401) return fehler('nicht-berechtigt');
  if (status === 429) return fehler('zu-viele');
  if (status === 507) return fehler('voll');
  if (status >= 400 && status < 500) return fehler('abgelehnt');
  return fehler('unbekannt');
}

export class RelayClient {
  readonly #basis: string;

  constructor(basis: string) {
    this.#basis = basis.replace(/\/+$/, '');
  }

  async #hole<T>(pfad: string, optionen: RequestInit, zeitLimitMs = 15_000): Promise<RelayErgebnis<T>> {
    try {
      const antwort = await fetch(`${this.#basis}${pfad}`, {
        ...optionen,
        signal: AbortSignal.timeout(zeitLimitMs),
        // Keine Anmeldedaten, keine Weitergabe von Herkunftsangaben.
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
      if (!antwort.ok) return ausStatus(antwort.status);
      return { ok: true, wert: (await antwort.json()) as T };
    } catch {
      return fehler('netz');
    }
  }

  /** Ciphertext in ein fremdes Postfach legen. Braucht keine Anmeldung. */
  async sende(kennung: string, blob: string): Promise<RelayErgebnis<{ id: string }>> {
    return await this.#hole(`/v1/mailbox/${kennung}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blob }),
    });
  }

  async herausforderung(kennung: string): Promise<RelayErgebnis<{ nonce: string; laeuftAb: number }>> {
    return await this.#hole('/v1/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kennung }),
    });
  }

  async richteEin(
    kennung: string, schluessel: string, nonce: string, signatur: string,
  ): Promise<RelayErgebnis<{ token: string }>> {
    return await this.#hole('/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kennung, schluessel, nonce, signatur }),
    });
  }

  /**
   * Nachrichten abholen.
   *
   * `wartenS > 0` hält die Verbindung offen, bis etwas ankommt (Long-Polling).
   * Das Zeitlimit liegt bewusst über der Wartezeit, sonst bricht der Client die
   * eigene Abfrage ab, kurz bevor der Server antwortet.
   */
  async hole(
    kennung: string, token: string, wartenS = 0,
  ): Promise<RelayErgebnis<{ nachrichten: RelayNachricht[] }>> {
    return await this.#hole(
      `/v1/mailbox/${kennung}/messages?wait=${String(wartenS)}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
      (wartenS + 10) * 1000,
    );
  }

  /** Bestätigen, dass die Nachrichten sicher angekommen sind. */
  async bestaetige(
    kennung: string, token: string, ids: readonly string[],
  ): Promise<RelayErgebnis<{ geloescht: number }>> {
    return await this.#hole(`/v1/mailbox/${kennung}/messages`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  }
}
