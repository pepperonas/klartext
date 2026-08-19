/**
 * Die Kennung des ausgelieferten Baus.
 *
 * `tools/build-hash.mjs` schreibt sie beim Bauen als <meta> in die index.html
 * und legt daneben `build.json` mit einem SHA-256 je Datei. Beides zusammen
 * macht Grenze 1 des Threat-Models überhaupt erst überprüfbar: der Quelltext
 * liegt offen, der Bau ist reproduzierbar (`npm run reproduzierbar`), also kann
 * jeder nachrechnen, ob der Server das ausliefert, was im Repo steht.
 *
 * ⚠️ Bewusst KEINE Selbstprüfung im Browser. Die App könnte ihre eigenen
 *    Dateien laden und nachrechnen — das Ergebnis wäre wertlos, weil ein
 *    Server, der falschen Code schickt, auch falsche Dateien zum Nachrechnen
 *    schicken kann. Eine Prüfung, die der Geprüfte selbst durchführt, ist
 *    keine. Der Wert liegt im Vergleich von AUSSEN.
 */

/** Steht nur im gebauten Stand; im Entwicklungsserver gibt es keinen Bau. */
export function buildKennung(): string | null {
  const meta = document.querySelector('meta[name="klartext-build"]');
  const wert = meta?.getAttribute('content')?.trim();
  if (wert === undefined || wert === '') return null;
  // Nur die erwartete Form durchlassen, damit nichts Fremdes in die Anzeige
  // gerät — der Wert stammt aus dem Dokument, und das kommt vom Server.
  return /^sha256-[A-Za-z0-9+/]{43}=$/.test(wert) ? wert : null;
}

/** Die ersten Stellen reichen zum Vergleichen mit blossem Auge. */
export function kurzform(kennung: string): string {
  return kennung.replace(/^sha256-/, '').slice(0, 12);
}
