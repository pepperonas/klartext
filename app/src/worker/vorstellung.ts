/**
 * Vorstellungen: „Ich habe deine Einladung angenommen, hier ist mein Schlüssel."
 *
 * Eine Einladung geht nur in eine Richtung — sie trägt den Schlüssel dessen,
 * der sie schickt. Wer sie annimmt, sieht den Absender; der Absender sieht ihn
 * deswegen nicht. Damit die Aufnahme gegenseitig wird, legt der Annehmende
 * seinen eigenen Schlüssel in das Postfach des Einladenden. Dessen Kennung
 * lässt sich aus dem Fingerprint rechnen, es braucht also keinen Rückkanal.
 *
 * ⚠️ Sie wird NICHT automatisch zum Kontakt. Das Postfach steht jedem offen,
 *    der den öffentlichen Schlüssel hat — das ist Absicht („wer meinen
 *    Schlüssel kennt, darf mir schreiben"). Würde ein eingehender Schlüssel
 *    ungefragt eingetragen, könnte jeder eine Kontaktliste mit frei gewählten
 *    Namen befüllen, und der Fingerprint-Abgleich wäre genau dort ausgehebelt,
 *    wo er zählt. Sie landet deshalb in einem eigenen Speicher und wartet auf
 *    eine Entscheidung.
 *
 * ⚠️ Der Fingerprint wird aus dem SCHLÜSSEL gerechnet, nie aus der Nutzlast
 *    übernommen — dieselbe Regel wie beim Einladungslink. Zwei Wahrheiten
 *    nebeneinander kann jemand auseinanderlaufen lassen; eine gerechnete kann
 *    das nicht.
 */

import * as openpgp from 'openpgp';

import { KlartextError } from '../crypto/errors.ts';
import { READ_CONFIG } from './openpgp-config.ts';
import { normalisiereFingerprint } from './keys.ts';

/** Der Marker im Klartext der Nachricht. Fassung inklusive. */
export const VORSTELLUNG_MARKE = 'klartext-vorstellung-v1';

export interface GespeicherteVorstellung {
  readonly fingerprint: string;
  /** Der Name, den die andere Seite ANGIBT — nicht überprüfbar. */
  readonly name: string;
  readonly armoredPublic: string;
  readonly angekommenAm: string;
  /** War die Nachricht mit genau diesem Schlüssel unterschrieben? */
  readonly selbstSigniert: boolean;
}

/** Baut die Nutzlast, die verschlüsselt und signiert verschickt wird. */
export function baueNutzlast(name: string, armoredPublic: string): string {
  return JSON.stringify({ marke: VORSTELLUNG_MARKE, name, schluessel: armoredPublic });
}

export function istVorstellung(klartext: string): boolean {
  // Billiger Vortest, bevor JSON.parse über eine 40-kB-Nachricht läuft.
  return klartext.includes(VORSTELLUNG_MARKE);
}

/**
 * Liest eine Vorstellung aus dem entschlüsselten Klartext.
 *
 * Gibt `null` zurück, wenn es keine ist — das ist der Normalfall für jede
 * gewöhnliche Nachricht und kein Fehler.
 */
export async function lese(
  klartext: string,
  unterzeichnerFingerprint: string | null,
): Promise<GespeicherteVorstellung | null> {
  if (!istVorstellung(klartext)) return null;

  let roh: unknown;
  try { roh = JSON.parse(klartext); } catch { return null; }
  if (typeof roh !== 'object' || roh === null) return null;

  const feld = roh as Record<string, unknown>;
  if (feld['marke'] !== VORSTELLUNG_MARKE) return null;
  const armored = feld['schluessel'];
  if (typeof armored !== 'string' || armored.length === 0) return null;

  let key: openpgp.PublicKey;
  try {
    key = await openpgp.readKey({ armoredKey: armored, config: READ_CONFIG });
  } catch {
    // Marke da, Schlüssel unbrauchbar — das ist keine gültige Vorstellung.
    throw new KlartextError('NOT_A_KEY');
  }
  if (key.isPrivate()) throw new KlartextError('NOT_A_KEY');

  const fingerprint = normalisiereFingerprint(key.getFingerprint());
  const name = typeof feld['name'] === 'string' && feld['name'].trim().length > 0
    ? feld['name'].trim().slice(0, 120)
    : (key.getUserIDs()[0] ?? fingerprint);

  return {
    fingerprint,
    name,
    armoredPublic: key.armor(),
    angekommenAm: new Date().toISOString(),
    // ⚠️ Das ist die einzige Aussage, die sich hier überhaupt prüfen lässt:
    //    ob die Nachricht mit genau dem Schlüssel unterschrieben wurde, den
    //    sie enthält. Das beweist Besitz des privaten Teils — mehr nicht. WER
    //    das ist, sagt weiterhin nur der Fingerprint-Abgleich.
    selbstSigniert: unterzeichnerFingerprint !== null
      && normalisiereFingerprint(unterzeichnerFingerprint) === fingerprint,
  };
}
