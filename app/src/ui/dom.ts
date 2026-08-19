/**
 * Winziger DOM-Helfer.
 *
 * ⚠️ `innerHTML` kommt in dieser App nicht vor — die CSP verlangt Trusted Types
 *    (`require-trusted-types-for 'script'`), und in einer Krypto-App ist die
 *    Fessel richtig. Alles wird gebaut, nichts geparst; Text landet immer ueber
 *    `textContent` im Dokument. Eine ESLint-Regel haelt das fest.
 */

type Attribute = Readonly<Record<string, string | number | boolean | undefined>>;
export type Kind = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attribute: Attribute = {},
  ...kinder: Kind[]
): HTMLElementTagNameMap[K] {
  const knoten = document.createElement(tag);
  for (const [name, wert] of Object.entries(attribute)) {
    if (wert === undefined || wert === false) continue;
    if (name === 'class') knoten.className = String(wert);
    else if (name === 'text') knoten.textContent = String(wert);
    else knoten.setAttribute(name, wert === true ? '' : String(wert));
  }
  fuelle(knoten, kinder);
  return knoten;
}

export function fuelle(ziel: HTMLElement, kinder: Kind[]): void {
  for (const kind of kinder) {
    if (kind === null || kind === undefined || kind === false) continue;
    ziel.appendChild(typeof kind === 'string' ? document.createTextNode(kind) : kind);
  }
}

export function leere(ziel: HTMLElement): void {
  while (ziel.firstChild !== null) ziel.removeChild(ziel.firstChild);
}

export function ersetze(ziel: HTMLElement, ...kinder: Kind[]): void {
  leere(ziel);
  fuelle(ziel, kinder);
}

export function suche(auswahl: string): HTMLElement {
  const knoten = document.querySelector<HTMLElement>(auswahl);
  if (knoten === null) throw new Error(`Element fehlt: ${auswahl}`);
  return knoten;
}
