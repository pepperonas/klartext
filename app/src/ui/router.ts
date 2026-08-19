/**
 * Wegfindung über die History-API.
 *
 * ⚠️ Der Grund ist nicht Eleganz: ohne History tut die Zurück-Geste des
 *    Browsers nichts — und das ist in jedem Unterzustand die naheliegendste
 *    Handbewegung. Wer sie ausführt, verlässt die App. Der Durchgang vom
 *    2026-08-19 hat genau das gezeigt.
 *
 * Pfade statt Rautenzeichen, weil nginx ohnehin auf index.html zurückfällt.
 * Es stehen nur unverfängliche Angaben darin — keine Fingerprints, keine
 * Namen und schon gar keine Geheimnisse (die landeten sonst im Verlauf).
 */

export type Weg =
  | { readonly ziel: 'schluessel' }
  | { readonly ziel: 'neu'; readonly schritt: number }
  | { readonly ziel: 'export'; readonly kurz: string }
  | { readonly ziel: 'werkzeug' }
  | { readonly ziel: 'info' };

export const START: Weg = { ziel: 'schluessel' };

export function alsPfad(weg: Weg): string {
  switch (weg.ziel) {
    case 'schluessel': return '/';
    case 'neu': return `/neu/${String(weg.schritt)}`;
    case 'export': return `/export/${weg.kurz}`;
    case 'werkzeug': return '/werkzeug';
    case 'info': return '/info';
  }
}

export function ausPfad(pfad: string): Weg {
  const teile = pfad.split('/').filter((t) => t.length > 0);
  const [erstes, zweites] = teile;

  if (erstes === 'info') return { ziel: 'info' };
  if (erstes === 'werkzeug') return { ziel: 'werkzeug' };
  if (erstes === 'neu') {
    const schritt = Number(zweites ?? '1');
    return { ziel: 'neu', schritt: Number.isInteger(schritt) && schritt > 0 ? schritt : 1 };
  }
  // Ein Export-Pfad ohne Kennung ist kein Export.
  if (erstes === 'export' && zweites !== undefined) return { ziel: 'export', kurz: zweites };
  return START;
}

export type WegAbnehmer = (weg: Weg) => void;

export class Router {
  #abnehmer: WegAbnehmer | null = null;

  starte(abnehmer: WegAbnehmer): void {
    this.#abnehmer = abnehmer;
    globalThis.addEventListener('popstate', () => { this.#melde(ausPfad(location.pathname)); });
    this.#melde(ausPfad(location.pathname));
  }

  /** Neuer Eintrag im Verlauf — die Zurück-Geste führt danach hierher zurück. */
  gehe(weg: Weg): void {
    const pfad = alsPfad(weg);
    if (pfad !== location.pathname) history.pushState(null, '', pfad);
    this.#melde(weg);
  }

  /** Gleicher Eintrag — für Zustände, die keinen eigenen Schritt zurück verdienen. */
  ersetze(weg: Weg): void {
    history.replaceState(null, '', alsPfad(weg));
    this.#melde(weg);
  }

  zurueck(): void {
    history.back();
  }

  get aktuell(): Weg {
    return ausPfad(location.pathname);
  }

  #melde(weg: Weg): void {
    this.#abnehmer?.(weg);
  }
}
