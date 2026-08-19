/**
 * Der lokale Gesprächsverlauf.
 *
 * ⚠️ Gespeichert wird der CIPHERTEXT. Eine Nachricht an mich ist per Definition
 *    an meinen Schlüssel verschlüsselt; eine von mir nehme ich als Empfänger
 *    mit auf. Damit ist der Verlauf im Ruhezustand verschlüsselt, OHNE dass
 *    irgendwo eigene Kryptografie dazukäme — und Lesen setzt einen entsperrten
 *    Schlüsselbund voraus, genau wie alles andere.
 *
 * ⚠️ Entschlüsselt wird erst beim Anzeigen. Scheitert es bei einem Eintrag,
 *    wird das GESAGT und der Rest trotzdem angezeigt — ein Verlauf, der wegen
 *    einer kaputten Zeile ganz verschwindet, wäre die schlechtere Antwort.
 */

import type { Key, PrivateKey } from 'openpgp';

import type { EntfaltetesGespraech, VerlaufsEintrag } from '../crypto/protocol.ts';
import { KlartextError } from '../crypto/errors.ts';
import * as idb from './idb.ts';
import { normalisiereFingerprint } from './keys.ts';
import { entschluessele } from './werkzeug.ts';

export class Verlauf {
  readonly #db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.#db = db;
  }

  async #alle(): Promise<VerlaufsEintrag[]> {
    return await idb.alle<VerlaufsEintrag>(this.#db, idb.STORE_MESSAGES);
  }

  async lege(eintrag: VerlaufsEintrag): Promise<void> {
    await idb.schreibe(this.#db, idb.STORE_MESSAGES, {
      ...eintrag, kontaktFp: normalisiereFingerprint(eintrag.kontaktFp),
    });
  }

  /** Kennt der Verlauf diese Nachricht schon? Gegen doppeltes Abholen. */
  async kennt(id: string): Promise<boolean> {
    return (await idb.lies<VerlaufsEintrag>(this.#db, idb.STORE_MESSAGES, id)) !== undefined;
  }

  async liste(
    kontaktFp: string,
    meine: readonly PrivateKey[],
    pruefeMit: readonly Key[],
  ): Promise<EntfaltetesGespraech[]> {
    const gesucht = normalisiereFingerprint(kontaktFp);
    const eintraege = (await this.#alle())
      .filter((e) => e.kontaktFp === gesucht)
      .sort((a, b) => a.zeit - b.zeit);

    const raus: EntfaltetesGespraech[] = [];
    for (const eintrag of eintraege) {
      try {
        const ergebnis = await entschluessele(eintrag.ciphertext, meine, pruefeMit);
        raus.push({ eintrag, klartext: ergebnis.klartext, fehler: null, signaturen: ergebnis.signaturen });
      } catch (fehler) {
        raus.push({
          eintrag, klartext: null, signaturen: [],
          fehler: fehler instanceof KlartextError
            ? fehler.message
            : 'Diese Nachricht lässt sich nicht mehr entschlüsseln.',
        });
      }
    }
    return raus;
  }

  async loesche(kontaktFp: string): Promise<void> {
    const gesucht = normalisiereFingerprint(kontaktFp);
    for (const eintrag of await this.#alle()) {
      if (eintrag.kontaktFp === gesucht) {
        await idb.loesche(this.#db, idb.STORE_MESSAGES, eintrag.id);
      }
    }
  }

  /** Anzahl je Kontakt — für die Übersicht. */
  async zaehler(): Promise<Record<string, number>> {
    const raus: Record<string, number> = {};
    for (const eintrag of await this.#alle()) {
      raus[eintrag.kontaktFp] = (raus[eintrag.kontaktFp] ?? 0) + 1;
    }
    return raus;
  }
}
