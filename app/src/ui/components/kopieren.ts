/**
 * Kopierknopf mit ehrlichem Hinweis und automatischem Leeren.
 *
 * Die Zwischenablage ist kein sicherer Ort: andere Programme lesen sie mit,
 * Verwaltungswerkzeuge führen Verlauf, und auf Apple-Geräten wandert sie über
 * Universal Clipboard auf andere Geräte. Trotzdem gibt es den Knopf — wer ihn
 * weglässt, treibt die Leute zu Bildschirmfotos und Notizzetteln in der Cloud,
 * und das ist schlechter.
 *
 * ⚠️ Das Leeren nach 60 s ist eine Verkleinerung des Zeitfensters, keine
 *    Löschung: wer bereits eingefügt hat, hat den Text woanders, und ein
 *    Verwaltungswerkzeug mit Verlauf hat ihn ohnehin. Genau so steht es auch
 *    im Hinweistext — kein Versprechen, das die Technik nicht hält.
 */

import { el } from '../dom.ts';

export const LEEREN_NACH_MS = 60_000;

export interface KopierKnopfOptionen {
  readonly text: () => string;
  readonly beschriftung?: string;
  /** Wird nach dem Kopieren angezeigt; hier steht der ehrliche Hinweis. */
  readonly meldung?: HTMLElement;
}

export function kopierKnopf(optionen: KopierKnopfOptionen): HTMLElement {
  const knopf = el('button', {
    class: 'knopf klein',
    type: 'button',
    text: optionen.beschriftung ?? 'Kopieren',
  });

  let ruecksetzer: ReturnType<typeof setTimeout> | null = null;
  let leerer: ReturnType<typeof setTimeout> | null = null;

  knopf.addEventListener('click', () => {
    void (async () => {
      const inhalt = optionen.text();
      try {
        await navigator.clipboard.writeText(inhalt);
      } catch {
        setzeMeldung(optionen.meldung, 'Der Browser hat das Kopieren abgelehnt — bitte von Hand markieren.', 'gefahr');
        return;
      }

      knopf.textContent = 'Kopiert';
      setzeMeldung(
        optionen.meldung,
        'In der Zwischenablage. Die lesen andere Programme mit, und auf Apple-Geräten ' +
        'wandert sie auf deine anderen Geräte. In 60 Sekunden wird sie geleert — was du ' +
        'bis dahin eingefügt hast, bleibt natürlich dort, wo du es eingefügt hast.',
        'warnung',
      );

      if (ruecksetzer !== null) clearTimeout(ruecksetzer);
      ruecksetzer = setTimeout(() => { knopf.textContent = optionen.beschriftung ?? 'Kopieren'; }, 2500);

      if (leerer !== null) clearTimeout(leerer);
      leerer = setTimeout(() => {
        void (async () => {
          try {
            // Nur leeren, wenn wirklich noch unser Text drinsteht — sonst
            // reissen wir dem Nutzer weg, was er inzwischen kopiert hat.
            const jetzt = await navigator.clipboard.readText();
            if (jetzt === inhalt) await navigator.clipboard.writeText('');
            setzeMeldung(optionen.meldung, 'Zwischenablage geleert.', 'neutral');
          } catch {
            // Lesen der Zwischenablage darf der Browser verweigern. Dann bleibt
            // der Inhalt stehen — und wir behaupten nichts anderes.
            setzeMeldung(
              optionen.meldung,
              'Der Browser lässt die Zwischenablage nicht prüfen — sie wurde nicht geleert.',
              'warnung',
            );
          }
        })();
      }, LEEREN_NACH_MS);
    })();
  });

  return knopf;
}

function setzeMeldung(ziel: HTMLElement | undefined, text: string, art: string): void {
  if (ziel === undefined) return;
  ziel.textContent = text;
  ziel.dataset['art'] = art;
}

/**
 * Öffnet ein Druckblatt für die Passphrase.
 *
 * Papier ist für dieses Geheimnis das ehrlichste Medium: es synchronisiert sich
 * nicht, wird nicht durchsucht und überlebt einen kaputten Rechner.
 *
 * Bewusst über `document.write` in einem neuen Fenster — das Blatt ist ein
 * eigenes Dokument ohne unsere CSP und ohne Zugriff auf den Schlüsselbund.
 * (Deshalb steht diese Datei auch auf der Ausnahmeliste der ESLint-Regel.)
 */
export interface DruckblattDaten {
  readonly woerter: readonly { readonly wort: string; readonly wuerfel: string }[];
  readonly bezeichnung: string;
  readonly datum: string;
}

export function druckblatt(daten: DruckblattDaten): boolean {
  const fenster = globalThis.open('', '_blank', 'width=800,height=900');
  if (fenster === null) return false;

  const doc = fenster.document;
  doc.title = 'klartext — Passphrase sichern';

  const stil = doc.createElement('style');
  stil.textContent = `
    body { font-family: system-ui, sans-serif; margin: 40px; color: #111; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .sub { color: #555; font-size: 13px; margin: 0 0 28px; }
    ol { font-family: ui-monospace, Menlo, monospace; font-size: 20px; line-height: 2.1; padding-left: 28px; }
    .w { color: #777; font-size: 13px; margin-left: 12px; }
    .kasten { border: 1px solid #bbb; border-radius: 8px; padding: 16px 20px; margin: 24px 0; }
    .warn { font-size: 13px; line-height: 1.6; }
    .feld { margin-top: 28px; font-size: 13px; color: #555; }
    @media print { body { margin: 20mm; } }
  `;
  doc.head.appendChild(stil);

  const h1 = doc.createElement('h1');
  h1.textContent = 'klartext — Passphrase';
  doc.body.appendChild(h1);

  const sub = doc.createElement('p');
  sub.className = 'sub';
  sub.textContent = `${daten.bezeichnung} · angelegt ${daten.datum}`;
  doc.body.appendChild(sub);

  const kasten = doc.createElement('div');
  kasten.className = 'kasten';
  const ol = doc.createElement('ol');
  for (const w of daten.woerter) {
    const li = doc.createElement('li');
    li.textContent = w.wort;
    const span = doc.createElement('span');
    span.className = 'w';
    span.textContent = w.wuerfel;
    li.appendChild(span);
    ol.appendChild(li);
  }
  kasten.appendChild(ol);
  doc.body.appendChild(kasten);

  const warn = doc.createElement('p');
  warn.className = 'warn';
  warn.textContent =
    'Diese Wörter entsperren deinen Schlüsselbund in dem Browser, in dem du ihn angelegt hast. ' +
    'Sie stellen den Schlüssel NICHT wieder her: sind die Browserdaten gelöscht, hilft dieser ' +
    'Zettel nicht mehr. Das eigentliche Backup ist die exportierte Schlüsseldatei — bewahre ' +
    'beides getrennt auf.';
  doc.body.appendChild(warn);

  const feld = doc.createElement('p');
  feld.className = 'feld';
  feld.textContent = 'Aufbewahrungsort: ______________________________';
  doc.body.appendChild(feld);

  fenster.focus();
  fenster.print();
  return true;
}
