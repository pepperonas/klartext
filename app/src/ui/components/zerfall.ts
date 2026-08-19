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
 *  2. **Höchstens `MAX_ZEICHEN` Spans.** Ein 40-kB-Text ergäbe sonst 40.000
 *     DOM-Knoten, und aus der Eleganz würde ein Ruckler. Der Rest blendet
 *     als Ganzes über.
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

export const MAX_ZEICHEN = 300;
/** Gesamtdauer bleibt unter dieser Marke — sonst nervt es beim zweiten Mal. */
export const MAX_DAUER_MS = 400;

export type Richtung = 'zerfall' | 'aufbau';

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

  const sichtbar = text.slice(0, MAX_ZEICHEN);
  const rest = text.slice(MAX_ZEICHEN);

  const zeichen: Zeichen[] = [];
  for (let i = 0; i < sichtbar.length; i++) {
    const c = sichtbar[i] ?? '';
    if (c === '\n') { behaelter.appendChild(document.createElement('br')); continue; }
    const knoten = el('span', { class: 'zf' });
    knoten.textContent = c;
    behaelter.appendChild(knoten);
    zeichen.push({
      knoten,
      versatz: (i / Math.max(1, sichtbar.length - 1)) * 0.55,
      // Streuung aus dem Zeichenwert statt aus Zufall: derselbe Text zerfällt
      // immer gleich, das wirkt wie Material und nicht wie Flimmern.
      streuX: ((c.charCodeAt(0) * 37) % 21) - 10,
      streuY: ((c.charCodeAt(0) * 61) % 17) - 8,
      drehung: ((c.charCodeAt(0) * 13) % 15) - 7,
    });
  }
  if (rest.length > 0) {
    const schwanz = el('span', { class: 'zf-rest' });
    schwanz.textContent = rest;
    behaelter.appendChild(schwanz);
  }

  const feder = new Feder(
    (wert) => {
      for (const z of zeichen) {
        const p = klemme((wert - z.versatz) / (1 - 0.55));
        // zerfall: von gestreut nach ruhig. aufbau: dieselbe Bewegung, nur wird
        // dabei zusammengesetzt statt auseinandergenommen.
        const g = richtung === 'zerfall' ? 1 - p : 1 - p;
        z.knoten.style.opacity = String(0.15 + 0.85 * p);
        z.knoten.style.transform =
          `translate(${String(z.streuX * g)}px, ${String(z.streuY * g)}px) ` +
          `rotate(${String(z.drehung * g)}deg) scale(${String(0.86 + 0.14 * p)})`;
      }
    },
    { art: 'knapp', start: 0 },
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
