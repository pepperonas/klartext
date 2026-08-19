/**
 * Postfach-Kennungen — dieselbe Ableitung wie im Relay.
 *
 * Sie muss auf beiden Seiten Zeichen für Zeichen dieselbe sein, sonst schreibt
 * ein Absender in ein Postfach, das der Empfänger nie abfragt. Deshalb ist der
 * Präfix hier UND im Relay festgeschrieben, und ein Test vergleicht beide.
 *
 * Nur SHA-256 über die Plattform-Krypto — kein openpgp, also darf das im
 * Main-Thread stehen.
 */

export const KENNUNG_PRAEFIX = 'klartext-mailbox-v1|';
export const AUTH_PRAEFIX = 'klartext-relay-auth:v1:';

function nachBase64Url(bytes: Uint8Array): string {
  let roh = '';
  for (const b of bytes) roh += String.fromCharCode(b);
  return btoa(roh).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Fingerprint (40 Hex) → Postfach-Kennung (base64url, 43 Zeichen). */
export async function postfachKennung(fingerprint: string): Promise<string> {
  const rein = fingerprint.replace(/\s+/g, '').toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(rein)) throw new RangeError('Kein v4-Fingerprint.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(KENNUNG_PRAEFIX + rein));
  return nachBase64Url(new Uint8Array(hash));
}

/** Der Text, den der Postfachinhaber signieren muss. */
export function herausforderungsText(kennung: string, nonce: string): string {
  return `${AUTH_PRAEFIX}${kennung}:${nonce}`;
}
