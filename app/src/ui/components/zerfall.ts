/**
 * Das Namensmotiv: der Übergang zwischen Klartext und Ciphertext.
 *
 * Beim Verschlüsseln zerfallen die Zeichen sichtbar in den Armored-Block, beim
 * Entschlüsseln setzen sie sich wieder zusammen.
 *
 * Drei Regeln, die nicht verhandelbar sind:
 *
 *  1. **Die Krypto wartet nie auf die Bewegung.** Der Worker rechnet, das
 *     Ergebnis steht sofort im DOM; die Bewegung läuft darüber und ist rein
 *     kosmetisch. Ein Test hält fest, dass der Text auch ohne Animation
 *     vollständig da ist.
 *  2. **Höchstens `MAX_KNOTEN` bewegte Elemente.** Ein 40-kB-Text ergäbe sonst
 *     40.000 DOM-Knoten, und aus der Eleganz würde ein Ruckler.
 *
 *     ⚠️ Früher hiess das: nur die ersten 300 Zeichen bewegten sich, der Rest
 *        blendete als Klotz über. Bei einem PGP-Block sind 300 Zeichen die
 *        ersten drei Zeilen — es sah aus, als sei die Animation kaputt.
 *        Jetzt bewegt sich der GANZE Text: bis zum Knotenbudget Zeichen für
 *        Zeichen, darüber in Stücken, die als Einheit fliegen. Ein 40-kB-Text
 *        bekommt so rund 1200 Stücke statt 40.000 Zeichen — und bewegt sich
 *        vollständig.
 *  3. **`prefers-reduced-motion` schaltet sie vollständig ab** — nicht nur die
 *     auffälligen Teile.
 *
 * Physik statt Beschleunigungskurve: EINE Feder treibt einen Wert von 0 nach 1,
 * jedes Zeichen liest daraus seinen eigenen, versetzten Fortschritt. So bleibt
 * es eine Federbewegung und trotzdem bei einer rAF-Schleife, gleich wie viele
 * Zeichen es sind.
 */

import { Feder, ruhigeDarstellung } from '../../motion/spring.ts';
import { el } from '../dom.ts';

/**
 * Wie viele Elemente höchstens bewegt werden.
 *
 * Nicht die Textlänge — die ist unbegrenzt. Bei mehr Zeichen als Knoten fasst
 * ein Knoten mehrere Zeichen zusammen und fliegt als Einheit.
 */
export const MAX_KNOTEN = 1200;

/**
 * Gesamtdauer.
 *
 * ⚠️ Waren 400 ms — für einen Block über viele Zeilen zu kurz, um überhaupt
 *    als Bewegung wahrgenommen zu werden. Länger darf es sein, weil man das
 *    Ergebnis ohnehin liest; nur nicht so lang, dass man wartet.
 */
export const MAX_DAUER_MS = 1400;

/** Ab wann ein Zeichen ein eigener Knoten bleibt (darunter reicht es immer). */
export const MAX_ZEICHEN = MAX_KNOTEN;

export type Richtung = 'zerfall' | 'aufbau';

/**
 * Wie viel der Gesamtdauer auf den Versatz entfällt.
 *
 * Bei 0 bewegte sich alles gleichzeitig, bei 1 wäre das letzte Stück erst am
 * Ende überhaupt in Bewegung. 0,72 gibt eine deutlich sichtbare Welle durch
 * den ganzen Block (vorher 0,55, was bei drei Zeilen kaum auffiel).
 */
const WELLE = 0.72;

interface Zeichen {
  readonly knoten: HTMLElement;
  /** Wann dieses Zeichen dran ist, 0..1 der Gesamtdauer. */
  readonly versatz: number;
  readonly streuX: number;
  readonly streuY: number;
  readonly drehung: number;
}

/**
 * Zeigt `text` im Behälter und spielt dabei den Übergang.
 *
 * Der Text steht nach dem Aufruf SOFORT vollständig im DOM — auch wenn die
 * Bewegung noch läuft oder gar nicht startet.
 */
export function zeigeMitZerfall(behaelter: HTMLElement, text: string, richtung: Richtung): void {
  while (behaelter.firstChild !== null) behaelter.removeChild(behaelter.firstChild);

  if (text.length === 0) return;

  if (ruhigeDarstellung()) {
    behaelter.appendChild(document.createTextNode(text));
    return;
  }

  // Wie viele Zeichen fasst ein bewegtes Stück? Bei kurzem Text: eines.
  const proStueck = Math.max(1, Math.ceil(text.length / MAX_KNOTEN));

  const zeichen: Zeichen[] = [];
  // Zeilenweise, damit die Umbrüche <br> bleiben und ein Stück nie über eine
  // Zeilengrenze hinweg fliegt — das sähe aus wie ein Textfehler.
  const zeilen = text.split('\n');
  let gesehen = 0;
  for (let z = 0; z < zeilen.length; z++) {
    const zeile = zeilen[z] ?? '';
    for (let i = 0; i < zeile.length; i += proStueck) {
      const stueck = zeile.slice(i, i + proStueck);
      const knoten = el('span', { class: 'zf' });
      knoten.textContent = stueck;
      behaelter.appendChild(knoten);
      const c = stueck.charCodeAt(0);
      zeichen.push({
        knoten,
        // Der Versatz folgt der Stelle im GESAMTEN Text, nicht der Stückzahl —
        // so läuft die Welle gleichmässig durch den Block.
        // ⚠️ Die Richtung tat vorher NICHTS: dort stand
        //    `richtung === 'zerfall' ? 1 - p : 1 - p` — zwei identische
        //    Zweige. Zerfall und Aufbau sahen gleich aus, obwohl die Doku
        //    seit Phase 2 einen Unterschied verspricht. Jetzt läuft die Welle
        //    beim Verschlüsseln von oben nach unten (der Klartext zerfällt in
        //    den Block) und beim Entschlüsseln von unten nach oben (der Text
        //    setzt sich zusammen).
        versatz: (richtung === 'zerfall'
          ? gesehen / Math.max(1, text.length)
          : 1 - gesehen / Math.max(1, text.length)) * WELLE,
        // Streuung aus dem Zeichenwert statt aus Zufall: derselbe Text zerfällt
        // immer gleich, das wirkt wie Material und nicht wie Flimmern.
        streuX: ((c * 37) % 53) - 26,
        streuY: ((c * 61) % 37) - 18,
        // Zerfall ist unordentlich, Aufbau ordentlich: beim Zusammensetzen
        // drehen sich die Stücke kaum, sie rasten ein.
        drehung: (((c * 13) % 29) - 14) * (richtung === 'zerfall' ? 1 : 0.35),
      });
      gesehen += stueck.length;
    }
    if (z < zeilen.length - 1) {
      behaelter.appendChild(document.createElement('br'));
      gesehen += 1;
    }
  }

  const feder = new Feder(
    (wert) => {
      for (const z of zeichen) {
        const p = klemme((wert - z.versatz) / (1 - WELLE));
        // zerfall: von gestreut nach ruhig. aufbau: dieselbe Bewegung, nur wird
        // dabei zusammengesetzt statt auseinandergenommen.
        const g = 1 - p;
        // Von 0 statt von 0,15: das Stück kommt aus dem Nichts, statt schon
        // blass dazustehen — der Unterschied zwischen „bewegt sich" und
        // „erscheint".
        z.knoten.style.opacity = String(p);
        z.knoten.style.transform =
          `translate(${String(z.streuX * g)}px, ${String(z.streuY * g)}px) ` +
          `rotate(${String(z.drehung * g)}deg) scale(${String(0.62 + 0.38 * p)})`;
      }
    },
    // `weich` statt `knapp`: die Bewegung soll tragen, nicht zucken.
    { art: 'weich', start: 0 },
  );
  feder.ziel(1);

  // Sicherheitsnetz UND Aufräumen: nach MAX_DAUER_MS ist Schluss, egal was die
  // Feder macht — und der Behälter enthält danach schlichten Text.
  //
  // ⚠️ Das Beruhigen ist nicht nur Kosmetik: während der Bewegung stehen die
  //    Zeilenumbrüche als <br> im DOM, `textContent` liefert sie also nicht.
  //    Wer den Text markiert, kopiert oder ausliest, bekäme eine andere
  //    Zeichenfolge als die, die verschlüsselt bzw. entschlüsselt wurde. Der
  //    Endzustand muss dem Inhalt entsprechen.
  setTimeout(() => {
    feder.stoppe();
    while (behaelter.firstChild !== null) behaelter.removeChild(behaelter.firstChild);
    behaelter.appendChild(document.createTextNode(text));
  }, MAX_DAUER_MS);
}

function klemme(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
