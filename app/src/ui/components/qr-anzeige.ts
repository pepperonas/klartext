/**
 * QR-Code als SVG.
 *
 * Ein einziger Pfad statt tausender Rechtecke — bei Version 25 wären das sonst
 * über 7000 Elemente im DOM.
 *
 * ⚠️ Die ruhige Zone (vier Module Rand) ist keine Zierde: ohne sie findet kein
 *    Scanner das Symbol. Sie steckt hier in der viewBox, damit sie auch dann
 *    erhalten bleibt, wenn das SVG auf einem farbigen Grund liegt.
 */

import { alsSvgPfad, erzeugeQr, type Fehlerkorrektur } from '../../contacts/qr.ts';
import { el } from '../dom.ts';

const RUHEZONE = 4;
const NS = 'http://www.w3.org/2000/svg';

export interface QrOptionen {
  readonly stufe?: Fehlerkorrektur;
  readonly beschriftung: string;
  readonly kantenlaenge?: number;
}

export function qrAnzeige(text: string, optionen: QrOptionen): HTMLElement {
  const qr = erzeugeQr(text, optionen.stufe ?? 'Q');
  const gesamt = qr.groesse + 2 * RUHEZONE;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${String(gesamt)} ${String(gesamt)}`);
  svg.setAttribute('width', String(optionen.kantenlaenge ?? 260));
  svg.setAttribute('height', String(optionen.kantenlaenge ?? 260));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', optionen.beschriftung);
  svg.setAttribute('shape-rendering', 'crispEdges');

  // Heller Grund GEHÖRT dazu: ein QR-Code auf dunklem Grund ist für die
  // meisten Scanner unlesbar, auch im dunklen Thema.
  const grund = document.createElementNS(NS, 'rect');
  grund.setAttribute('width', String(gesamt));
  grund.setAttribute('height', String(gesamt));
  grund.setAttribute('fill', '#ffffff');
  svg.appendChild(grund);

  const pfad = document.createElementNS(NS, 'path');
  pfad.setAttribute('transform', `translate(${String(RUHEZONE)} ${String(RUHEZONE)})`);
  pfad.setAttribute('d', alsSvgPfad(qr));
  pfad.setAttribute('fill', '#000000');
  svg.appendChild(pfad);

  const huelle = el('div', { class: 'qr' });
  huelle.appendChild(svg);
  return huelle;
}
