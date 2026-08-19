/**
 * Fingerprints als Wörter — zum Vorlesen am Telefon.
 *
 * Vierzig Hexstellen über eine schlechte Verbindung vorzulesen ist mühsam und
 * fehleranfällig; nach der zwölften Stelle hört niemand mehr genau hin. Wörter
 * gehen leichter über die Leitung, und ein verhörtes Wort fällt auf, wo ein
 * verhörtes „D" statt „B" durchrutscht.
 *
 * ⚠️ ABWEICHUNG von meiner Empfehlung aus Phase 0: dort hatte ich die englische
 *    PGP Word List vorgeschlagen. Hier liegt die deutsche `de-7776-v1` bereits
 *    im Repo — mit Prüfsumme festgenagelt, ohne Umlaute, aus bekannten Wörtern.
 *    Für deutsche Ohren am Telefon ist sie das bessere Werkzeug, und es gibt
 *    keinen Interop-Zwang: GnuPG kennt gar keine Wortliste für Fingerprints,
 *    die Gegenseite liest ohnehin klartext. Eine zweite Liste einzuschleppen
 *    hätte 512 abgeschriebene englische Wörter bedeutet — also eine zweite
 *    Fehlerquelle für nichts.
 *
 * Verfahren: der Fingerprint ist eine 160-Bit-Zahl. Sie wird in die Basis 7776
 * umgeschrieben; jede Stelle ist ein Wort. 13 Wörter tragen 168 Bit und damit
 * die vollen 160. Die Umrechnung ist umkehrbar — der Test rechnet sie über
 * Zufallswerte hin und zurück.
 */

import { LISTENGROESSE, WOERTER } from '../passphrase/generator.ts';

/** 13 × 12,925 Bit = 168 Bit ≥ 160 Bit eines v4-Fingerprints. */
export const WORTZAHL = 13;

const BASIS = BigInt(LISTENGROESSE);

function alsZahl(fingerprint: string): bigint {
  const rein = fingerprint.replace(/\s+/g, '').toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(rein)) {
    throw new RangeError('Kein v4-Fingerprint (40 Hexstellen erwartet).');
  }
  return BigInt(`0x${rein}`);
}

/** Fingerprint → Wörter. */
export function alsWoerter(fingerprint: string): string[] {
  let rest = alsZahl(fingerprint);
  const raus: string[] = [];
  for (let i = 0; i < WORTZAHL; i++) {
    const stelle = Number(rest % BASIS);
    rest /= BASIS;
    const wort = WOERTER[stelle];
    if (wort === undefined) throw new Error('Wortliste unvollständig.');
    raus.push(wort);
  }
  // Höchstwertige Stelle zuerst — so, wie man eine Zahl vorliest.
  return raus.reverse();
}

/** Wörter → Fingerprint. Wirft, wenn ein Wort nicht in der Liste steht. */
export function ausWoertern(woerter: readonly string[]): string {
  if (woerter.length !== WORTZAHL) {
    throw new RangeError(`${String(WORTZAHL)} Wörter erwartet, ${String(woerter.length)} bekommen.`);
  }
  let zahl = 0n;
  for (const wort of woerter) {
    const stelle = WOERTER.indexOf(wort.trim().toLocaleLowerCase('de'));
    if (stelle < 0) throw new RangeError(`Unbekanntes Wort: ${wort}`);
    zahl = zahl * BASIS + BigInt(stelle);
  }
  const hex = zahl.toString(16).toUpperCase().padStart(40, '0');
  if (hex.length !== 40) throw new RangeError('Diese Wörter ergeben keinen Fingerprint.');
  return hex;
}

/**
 * Vergleicht zwei Fingerprints.
 *
 * ⚠️ Ohne Rücksicht auf Schreibweise und Leerzeichen, aber SONST exakt. Ein
 *    „stimmt ungefähr" gibt es hier nicht: der ganze Zweck des Abgleichs ist,
 *    einen untergeschobenen Schlüssel zu erkennen, und der unterscheidet sich
 *    naturgemäss nur in Details.
 */
export function stimmenUeberein(a: string, b: string): boolean {
  const rein = (s: string): string => s.replace(/\s+/g, '').toUpperCase();
  return rein(a).length === 40 && rein(a) === rein(b);
}

/** In Vierergruppen, wie man ihn ansieht. */
export function gruppiert(fingerprint: string): string {
  return (fingerprint.replace(/\s+/g, '').toUpperCase().match(/.{1,4}/g) ?? []).join(' ');
}

/** Die letzten 16 Stellen — kurz genug für eine Zeile, lang genug zum Wiedererkennen. */
export function kurzform(fingerprint: string): string {
  return fingerprint.replace(/\s+/g, '').toUpperCase().slice(-16);
}
