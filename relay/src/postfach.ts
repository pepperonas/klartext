/**
 * Postfach-Kennungen.
 *
 * Die Kennung wird aus dem Fingerprint abgeleitet, damit ein Absender sie
 * berechnen kann, ohne dass es ein Verzeichnis gäbe. Sie ist deshalb auch
 * NICHT geheim: wer den öffentlichen Schlüssel hat, kann sie ausrechnen.
 *
 * Daraus folgt die Aufteilung der Rechte:
 *
 *   Schreiben  — offen für jeden, der den öffentlichen Schlüssel hat. Genau so
 *                ist es gemeint: wer meinen Schlüssel kennt, darf mir schreiben.
 *   Lesen      — nur gegen Besitznachweis am privaten Schlüssel.
 *
 * ⚠️ Der Server kann die Kennung nicht zurückrechnen — aber wer den
 *    öffentlichen Schlüssel ohnehin hat, kann sie ausrechnen und einen
 *    Postfachinhaber damit wiedererkennen. Das steht so im Threat-Model.
 */

import { createHash } from 'node:crypto';

export const KENNUNG_PRAEFIX = 'klartext-mailbox-v1|';
export const AUTH_PRAEFIX = 'klartext-relay-auth:v1:';

/** Fingerprint (40 Hex) → Postfach-Kennung (base64url, 43 Zeichen). */
export function postfachKennung(fingerprint: string): string {
  const rein = fingerprint.replace(/\s+/g, '').toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(rein)) {
    throw new RangeError('Kein v4-Fingerprint.');
  }
  return createHash('sha256').update(KENNUNG_PRAEFIX + rein).digest('base64url');
}

/** Der Text, den der Postfachinhaber signieren muss. */
export function herausforderungsText(kennung: string, nonce: string): string {
  return `${AUTH_PRAEFIX}${kennung}:${nonce}`;
}

export function istKennung(wert: unknown): wert is string {
  return typeof wert === 'string' && /^[A-Za-z0-9_-]{43}$/.test(wert);
}
