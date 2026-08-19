/**
 * Wer darf ein Postfach leeren?
 *
 * Die Postfach-Kennung ist nicht geheim — wer den öffentlichen Schlüssel hat,
 * kann sie ausrechnen. Ohne weiteren Nachweis könnte also jeder Einladungs-
 * empfänger fremde Postfächer leerräumen (mitlesen kann er nichts, es ist
 * Ciphertext — aber er könnte Nachrichten wegnehmen, bevor der Empfänger sie
 * holt).
 *
 * Deshalb: **Besitznachweis am privaten Schlüssel**, einmal bei der
 * Einrichtung. Der Server prüft dabei ZWEI Dinge, und beide rechnet er selbst
 * nach — er glaubt nichts:
 *
 *   1. Die Kennung ist wirklich der Hash des Fingerprints dieses Schlüssels.
 *   2. Die Signatur über die Herausforderung stimmt.
 *
 * ⚠️ Danach wird der öffentliche Schlüssel VERWORFEN. Gespeichert bleibt nur
 *    der Hash eines Lesetokens. Der Server hält damit im Ruhezustand kein
 *    Schlüsselmaterial und keine Identität — der Schlüssel war einmal da, das
 *    ist ein echtes Restrisiko und steht als solches im Threat-Model.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import * as openpgp from 'openpgp';

import { herausforderungsText, postfachKennung } from './postfach.ts';

/** Lebensdauer einer Herausforderung. Kurz — sie wird sofort gebraucht. */
export const HERAUSFORDERUNG_TTL_MS = 120_000;

export function neuerNonce(): string {
  return randomBytes(24).toString('base64url');
}

export function neuesToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** Vergleich in gleichbleibender Zeit — sonst verrät die Dauer das Token. */
export function tokenStimmt(gegeben: string, erwarteterHash: string): boolean {
  const a = Buffer.from(tokenHash(gegeben));
  const b = Buffer.from(erwarteterHash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Offene Herausforderungen — nur im Speicher, einmal verwendbar. */
export class Herausforderungen {
  readonly #offen = new Map<string, { kennung: string; laeuftAb: number }>();

  stelle(kennung: string, jetzt: number): { nonce: string; laeuftAb: number } {
    this.#raeumeAuf(jetzt);
    const nonce = neuerNonce();
    const laeuftAb = jetzt + HERAUSFORDERUNG_TTL_MS;
    this.#offen.set(nonce, { kennung, laeuftAb });
    return { nonce, laeuftAb };
  }

  /** Prüft und verbraucht. Ein Nonce gilt genau einmal. */
  verbrauche(nonce: string, kennung: string, jetzt: number): boolean {
    const eintrag = this.#offen.get(nonce);
    if (eintrag === undefined) return false;
    this.#offen.delete(nonce);
    if (eintrag.laeuftAb < jetzt) return false;
    return eintrag.kennung === kennung;
  }

  #raeumeAuf(jetzt: number): void {
    for (const [nonce, eintrag] of this.#offen) {
      if (eintrag.laeuftAb < jetzt) this.#offen.delete(nonce);
    }
  }

  get offeneAnzahl(): number { return this.#offen.size; }
}

export type PruefFehler =
  | 'kennung-passt-nicht'
  | 'kein-schluessel'
  | 'signatur-ungueltig';

export type PruefErgebnis =
  | { readonly ok: true }
  | { readonly ok: false; readonly fehler: PruefFehler };

/**
 * Prüft den Besitznachweis.
 *
 * `armoredKey` wird ausschliesslich hier gebraucht und danach fallengelassen —
 * die Aufrufstelle speichert ihn nicht.
 */
export async function pruefeBesitz(
  kennung: string,
  armoredKey: string,
  nonce: string,
  armoredSignatur: string,
): Promise<PruefErgebnis> {
  let key: openpgp.PublicKey;
  try {
    key = await openpgp.readKey({ armoredKey });
  } catch {
    return { ok: false, fehler: 'kein-schluessel' };
  }

  // 1. Gehört die Kennung wirklich zu diesem Schlüssel? Der Server rechnet das
  //    selbst nach — die Bindung ist damit selbstzertifizierend.
  let erwartet: string;
  try {
    erwartet = postfachKennung(key.getFingerprint());
  } catch {
    return { ok: false, fehler: 'kein-schluessel' };
  }
  if (erwartet !== kennung) return { ok: false, fehler: 'kennung-passt-nicht' };

  // 2. Stimmt die Signatur über genau diese Herausforderung?
  try {
    const signatur = await openpgp.readSignature({ armoredSignature: armoredSignatur });
    const nachricht = await openpgp.createMessage({ text: herausforderungsText(kennung, nonce) });
    const { signatures } = await openpgp.verify({
      message: nachricht, signature: signatur, verificationKeys: key,
    });
    const erste = signatures[0];
    if (erste === undefined) return { ok: false, fehler: 'signatur-ungueltig' };
    // ⚠️ `verified` WIRFT bei ungültiger Signatur, statt false zu liefern.
    await erste.verified;
    return { ok: true };
  } catch {
    return { ok: false, fehler: 'signatur-ungueltig' };
  }
}
