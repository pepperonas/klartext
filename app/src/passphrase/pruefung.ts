/**
 * Nachweis, dass die Passphrase wirklich gesichert wurde.
 *
 * ⚠️ Ein Haken „Ich habe sie notiert" ist eine Selbstauskunft, die man in zwei
 *    Sekunden setzt, ohne etwas notiert zu haben. Und das Wiederholfeld beim
 *    Anlegen prüft nichts, sobald der Vorschlag es mitfüllt.
 *
 * Deshalb: drei Wörter nach Position abfragen, wie es Wallets tun. Das belegt
 * den Besitz des Zettels, ohne 55 Zeichen abtippen zu lassen — was viele über
 * die Zwischenablage umgehen würden, womit wieder nichts bewiesen wäre.
 */

import { zieheIndex, type Zufallsquelle, browserZufall } from './generator.ts';

export const ABGEFRAGTE_WOERTER = 3;

/**
 * Wählt verschiedene Positionen (1-basiert, aufsteigend) aus.
 *
 * ⚠️ Bewusst als teilweises Fisher-Yates-Mischen und NICHT als „ziehen, bis
 *    genug Verschiedene beisammen sind". Die naive Fassung dreht sich ewig,
 *    sobald die Quelle nicht genug verschiedene Werte hergibt — beim ersten
 *    Testlauf ist genau das passiert: die Suite hing, statt fehlzuschlagen.
 *    Mit `crypto.getRandomValues` wäre es nie aufgefallen, in einem Formular
 *    wäre es ein eingefrorener Schritt ohne Fehlermeldung gewesen.
 *
 *    Diese Fassung braucht exakt `anzahl` Ziehungen und ist gleichverteilt
 *    über alle Teilmengen.
 */
export function waehlePositionen(
  wortzahl: number,
  anzahl: number = ABGEFRAGTE_WOERTER,
  quelle: Zufallsquelle = browserZufall,
): number[] {
  if (!Number.isInteger(wortzahl) || !Number.isInteger(anzahl) || anzahl < 1) {
    throw new RangeError('Ungültige Anzahl.');
  }
  if (wortzahl < anzahl) throw new RangeError('Weniger Wörter als abzufragen.');

  const topf = Array.from({ length: wortzahl }, (_, i) => i + 1);
  for (let i = 0; i < anzahl; i++) {
    const j = i + zieheIndex(quelle, wortzahl - i);
    const a = topf[i];
    const b = topf[j];
    if (a === undefined || b === undefined) throw new Error('Topf unerwartet leer.');
    topf[i] = b;
    topf[j] = a;
  }
  return topf.slice(0, anzahl).sort((a, b) => a - b);
}

/** Vergleicht ohne Rücksicht auf Groß-/Kleinschreibung und Leerraum. */
export function stimmt(eingabe: string, erwartet: string): boolean {
  return eingabe.trim().toLocaleLowerCase('de') === erwartet.trim().toLocaleLowerCase('de');
}

export interface PruefErgebnis {
  readonly bestanden: boolean;
  /** Positionen (1-basiert), die falsch beantwortet wurden. */
  readonly falsch: readonly number[];
}

export function pruefe(
  woerter: readonly string[],
  positionen: readonly number[],
  antworten: readonly string[],
): PruefErgebnis {
  const falsch: number[] = [];
  positionen.forEach((position, i) => {
    const erwartet = woerter[position - 1];
    const gegeben = antworten[i] ?? '';
    if (erwartet === undefined || !stimmt(gegeben, erwartet)) falsch.push(position);
  });
  return { bestanden: falsch.length === 0, falsch };
}
