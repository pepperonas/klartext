/**
 * Vorschläge für Passphrasen und Export-Passwörter.
 *
 * Reine Funktionen, keine DOM-Bezüge, Zufallsquelle injizierbar — damit die
 * Verteilung nicht statistisch geschätzt, sondern vollständig durchgerechnet
 * werden kann (siehe tests/passphrase.test.ts).
 *
 * Das ist bewusst KEINE eigene Kryptografie: gezogen wird aus dem CSPRNG des
 * Browsers. Die einzige Stelle, an der man hier etwas falsch machen kann, ist
 * die gleichmäßige Verteilung — und genau die ist unten begründet und getestet.
 */

import rohliste from './de-7776-v1.txt?raw';

export const WOERTER: readonly string[] = Object.freeze(
  rohliste.split('\n').map((z) => z.trim()).filter((z) => z.length > 0),
);

/** 7776 = 6⁵ — fünf Würfel je Wort. */
export const LISTENGROESSE = 7776;
export const BITS_PRO_WORT = Math.log2(LISTENGROESSE); // 12,925

export const STANDARD_WORTZAHL = 6;
export const MIN_WORTZAHL = 4;
export const MAX_WORTZAHL = 10;

/** Liefert genau `anzahl` zufällige Bytes. */
export type Zufallsquelle = (anzahl: number) => Uint8Array;

export const browserZufall: Zufallsquelle = (anzahl) =>
  crypto.getRandomValues(new Uint8Array(anzahl));

export interface Wortwahl {
  readonly wort: string;
  /** Die fünf Würfelaugen, die zu diesem Wort führen — z. B. "41111". */
  readonly wuerfel: string;
  readonly index: number;
}

export type Herkunft = 'zufall' | 'wuerfel';

export interface Passphrase {
  readonly woerter: readonly Wortwahl[];
  /** Was in das Eingabefeld wandert. */
  readonly text: string;
  readonly bits: number;
  readonly herkunft: Herkunft;
}

// ---------------------------------------------------------------- Würfel

/**
 * Index → Würfelzahl. Die Reihenfolge der Liste IST die Diceware-Nummerierung:
 * Basis 6, wobei die Ziffer 0 als Würfelauge 1 geschrieben wird.
 */
export function indexZuWuerfel(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= LISTENGROESSE) {
    throw new RangeError(`Index ausserhalb der Liste: ${String(index)}`);
  }
  let rest = index;
  const ziffern: number[] = [];
  for (let i = 0; i < 5; i++) {
    ziffern.unshift((rest % 6) + 1);
    rest = Math.floor(rest / 6);
  }
  return ziffern.join('');
}

export function wuerfelZuIndex(wuerfel: string): number {
  if (!/^[1-6]{5}$/.test(wuerfel)) {
    throw new RangeError(`Keine gültige Würfelfolge: ${wuerfel}`);
  }
  let index = 0;
  for (const ziffer of wuerfel) index = index * 6 + (Number(ziffer) - 1);
  return index;
}

function wahlFuer(index: number): Wortwahl {
  const wort = WOERTER[index];
  if (wort === undefined) throw new RangeError(`Kein Wort an Index ${String(index)}`);
  return { wort, wuerfel: indexZuWuerfel(index), index };
}

// ------------------------------------------------------------- Ziehung

/**
 * Gleichverteilte Ziehung mit Rejection Sampling.
 *
 * ⚠️ Der naheliegende Weg `zufall % obergrenze` ist VERZERRT: 65536 ist kein
 *    Vielfaches von 7776 (65536 = 8 × 7776 + 3328), also kämen die ersten 3328
 *    Wörter je neun statt acht Mal vor. Das kostet echte Entropie und ist dem
 *    Ergebnis nicht anzusehen.
 *
 *    Deshalb werden Werte ab `GRENZE` verworfen und neu gezogen. Der Test
 *    rechnet alle 65536 möglichen Zwei-Byte-Werte durch und verlangt, dass
 *    JEDER Index exakt gleich oft herauskommt — kein Stichprobenargument,
 *    sondern der vollständige Beweis.
 */
export function zieheIndex(quelle: Zufallsquelle, obergrenze: number = LISTENGROESSE): number {
  if (obergrenze < 1 || obergrenze > 0x10000) {
    throw new RangeError(`Obergrenze ausserhalb des Zwei-Byte-Bereichs: ${String(obergrenze)}`);
  }
  const GRENZE = 0x10000 - (0x10000 % obergrenze);
  for (;;) {
    const bytes = quelle(2);
    const hoch = bytes[0];
    const tief = bytes[1];
    if (hoch === undefined || tief === undefined) {
      throw new Error('Zufallsquelle lieferte zu wenige Bytes.');
    }
    const roh = (hoch << 8) | tief;
    if (roh < GRENZE) return roh % obergrenze;
  }
}

export function ziehePassphrase(
  wortzahl: number = STANDARD_WORTZAHL,
  quelle: Zufallsquelle = browserZufall,
): Passphrase {
  if (!Number.isInteger(wortzahl) || wortzahl < MIN_WORTZAHL || wortzahl > MAX_WORTZAHL) {
    throw new RangeError(`Wortzahl ausserhalb ${String(MIN_WORTZAHL)}–${String(MAX_WORTZAHL)}`);
  }
  const woerter: Wortwahl[] = [];
  for (let i = 0; i < wortzahl; i++) woerter.push(wahlFuer(zieheIndex(quelle)));
  return fasseZusammen(woerter, 'zufall');
}

/** Aus selbst gewürfelten Augen — der einzige Weg, bei dem du dem Zufall zusiehst. */
export function ausWuerfeln(wuerfe: readonly string[]): Passphrase {
  if (wuerfe.length < MIN_WORTZAHL) {
    throw new RangeError(`Mindestens ${String(MIN_WORTZAHL)} Würfelfolgen nötig.`);
  }
  return fasseZusammen(wuerfe.map((w) => wahlFuer(wuerfelZuIndex(w))), 'wuerfel');
}

function fasseZusammen(woerter: readonly Wortwahl[], herkunft: Herkunft): Passphrase {
  return {
    woerter,
    // Bindestriche statt Leerzeichen: sie überleben Kopieren, Zeilenumbruch und
    // Formularfelder, die an Leerzeichen abschneiden.
    text: woerter.map((w) => w.wort).join('-'),
    bits: woerter.length * BITS_PRO_WORT,
    herkunft,
  };
}

// ------------------------------------------------- Passwort für den Export

/**
 * Zeichensatz ohne Verwechslungspaare: kein l/I/1, kein O/0.
 *
 * Das kostet Entropie je Zeichen (6,11 statt 6,55 Bit) und ist es wert — ein
 * Export-Passwort wird abgeschrieben, und ein verwechseltes Zeichen bedeutet
 * eine Datei, die niemand mehr aufbekommt.
 */
export const PASSWORT_ALPHABET =
  'abcdefghijkmnopqrstuvwxyz' + 'ABCDEFGHJKLMNPQRSTUVWXYZ' + '23456789' + '!#$%&*+-=?@_';

export const STANDARD_PASSWORTLAENGE = 24;

export interface ZeichenPasswort {
  readonly text: string;
  readonly bits: number;
  readonly alphabetGroesse: number;
}

export function ziehePasswort(
  laenge: number = STANDARD_PASSWORTLAENGE,
  quelle: Zufallsquelle = browserZufall,
): ZeichenPasswort {
  if (!Number.isInteger(laenge) || laenge < 8 || laenge > 128) {
    throw new RangeError(`Länge ausserhalb 8–128: ${String(laenge)}`);
  }
  const groesse = PASSWORT_ALPHABET.length;
  let text = '';
  for (let i = 0; i < laenge; i++) {
    const zeichen = PASSWORT_ALPHABET[zieheIndex(quelle, groesse)];
    if (zeichen === undefined) throw new Error('Alphabet-Index ausserhalb des Bereichs.');
    text += zeichen;
  }
  return { text, bits: laenge * Math.log2(groesse), alphabetGroesse: groesse };
}

// ------------------------------------------------------------- Einordnung

/**
 * Klartext statt Farbbalken. Die Schwellen sind an dem ausgerichtet, was gegen
 * Argon2id mit 64 MiB tatsächlich durchprobierbar ist — nicht an den üblichen
 * "stark/sehr stark"-Etiketten, die nichts aussagen.
 */
export function einordnung(bits: number): string {
  if (bits < 45) return 'zu wenig — das lässt sich durchprobieren';
  if (bits < 60) return 'für Gelegenheitsangreifer genug, für mehr nicht';
  if (bits < 75) return 'solide';
  if (bits < 100) return 'weit jenseits dessen, was jemand durchprobieren kann';
  return 'mehr als nötig';
}
