/**
 * QR-Codes scannen — zur Fingerprint-Verifikation, wenn man sich sieht.
 *
 * Der stärkste Weg des Abgleichs: die eine Seite zeigt ihren Code, die andere
 * scannt ihn. Kein Vorlesen, kein Verhören, kein „ja, passt schon".
 *
 * ⚠️ **Fortschrittliche Verbesserung, kein Muss.** `BarcodeDetector` gibt es in
 *    Chrome und auf Android, in Safari nicht. Wo er fehlt, bleibt der Weg über
 *    die dreizehn Wörter — der funktioniert überall und ist ohnehin der, den
 *    man am Telefon braucht. Die Oberfläche bietet das Scannen deshalb nur an,
 *    wo es wirklich geht, statt einen Knopf zu zeigen, der nichts tut.
 *
 * ⚠️ Das Bild verlässt das Gerät nicht und wird nirgends gespeichert. Die
 *    Kamera läuft nur, solange dieser Bereich offen ist, und wird beim
 *    Schliessen ausdrücklich abgeschaltet — ein weiterlaufender Kamerastrom
 *    hinter einer geschlossenen Ansicht wäre unentschuldbar.
 */

import { el } from '../dom.ts';

interface Erkenner {
  detect: (quelle: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}
interface ErkennerBauer {
  new (optionen: { formats: string[] }): Erkenner;
  getSupportedFormats: () => Promise<string[]>;
}

function bauer(): ErkennerBauer | null {
  const g = globalThis as { BarcodeDetector?: ErkennerBauer };
  return g.BarcodeDetector ?? null;
}

export async function scannenMoeglich(): Promise<boolean> {
  const b = bauer();
  if (b === null) return false;
  if (!('mediaDevices' in navigator)) return false;
  try {
    return (await b.getSupportedFormats()).includes('qr_code');
  } catch {
    return false;
  }
}

export interface ScannerOptionen {
  /** Wird bei jedem gelesenen Code aufgerufen. `true` beendet den Scan. */
  readonly beiFund: (text: string) => boolean;
  readonly beiFehler: (meldung: string) => void;
}

export class Scanner {
  readonly wurzel: HTMLElement;
  readonly #video: HTMLVideoElement;
  readonly #optionen: ScannerOptionen;
  #strom: MediaStream | null = null;
  #laeuft = false;

  constructor(optionen: ScannerOptionen) {
    this.#optionen = optionen;
    this.#video = el('video', {
      class: 'scanner-bild', playsinline: true, muted: true,
      'aria-label': 'Kamerabild zum Abscannen eines QR-Codes',
    });
    this.wurzel = el('div', { class: 'scanner' }, this.#video);
  }

  async starte(): Promise<void> {
    if (this.#laeuft) return;
    const b = bauer();
    if (b === null) { this.#optionen.beiFehler('Dieser Browser kann keine QR-Codes lesen.'); return; }

    try {
      this.#strom = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, audio: false,
      });
    } catch {
      this.#optionen.beiFehler(
        'Kein Zugriff auf die Kamera. Erlaube ihn in den Browsereinstellungen — oder gleicht ' +
        'die dreizehn Wörter ab, das geht immer.');
      return;
    }

    this.#video.srcObject = this.#strom;
    await this.#video.play().catch(() => { /* Autoplay-Ablehnung ist kein Beinbruch */ });
    this.#laeuft = true;

    const erkenner = new b({ formats: ['qr_code'] });
    const naechsterRahmen = (): Promise<void> =>
      new Promise((weiter) => { requestAnimationFrame(() => { weiter(); }); });

    // Als Schleife statt als Rekursion: `stoppe()` kann jederzeit während eines
    // `await` dazwischenkommen, und so ist das an einer Stelle nachlesbar.
    void (async () => {
      while (this.laeuft) {
        try {
          const treffer = await erkenner.detect(this.#video);
          const wert = treffer[0]?.rawValue;
          if (wert !== undefined && this.#optionen.beiFund(wert)) { this.stoppe(); return; }
        } catch {
          // Ein einzelner misslungener Durchgang ist normal (unscharfes Bild).
        }
        await naechsterRahmen();
      }
    })();
  }

  /** Schaltet die Kamera ab. MUSS beim Verlassen der Ansicht gerufen werden. */
  stoppe(): void {
    this.#laeuft = false;
    for (const spur of this.#strom?.getTracks() ?? []) spur.stop();
    this.#strom = null;
    this.#video.srcObject = null;
  }

  get laeuft(): boolean { return this.#laeuft; }
}
