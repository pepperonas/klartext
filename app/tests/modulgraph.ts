import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Zeilenweise Import-Erkennung. Kommentare fliegen vorher raus — ein Kommentar,
 *  der `import ... from 'openpgp'` zitiert (und die gibt es in diesem Projekt),
 *  darf die Pruefung nicht ausloesen. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const IMPORT = /(?:^|\n)\s*(?:import|export)\b[^\n;]*?from\s*['"]([^'"]+)['"]/g;
const DYNAMISCH = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export interface GraphErgebnis {
  /** Alle erreichten eigenen Dateien (absolute Pfade). */
  readonly dateien: readonly string[];
  /** Alle Paketnamen, die von dort aus erreichbar sind. */
  readonly pakete: readonly string[];
}

/**
 * Laeuft den Importgraphen ab einem Einstiegspunkt ab und sammelt, welche
 * externen Pakete von dort erreichbar sind.
 */
export function laufeGraph(einstieg: string): GraphErgebnis {
  const gesehen = new Set<string>();
  const pakete = new Set<string>();
  const offen = [resolve(einstieg)];

  while (offen.length > 0) {
    const datei = offen.pop();
    if (datei === undefined || gesehen.has(datei)) continue;
    gesehen.add(datei);

    const quelle = ohneKommentare(readFileSync(datei, 'utf8'));
    for (const regex of [IMPORT, DYNAMISCH]) {
      regex.lastIndex = 0;
      let treffer: RegExpExecArray | null;
      while ((treffer = regex.exec(quelle)) !== null) {
        const spezifizierer = treffer[1];
        if (spezifizierer === undefined) continue;
        if (spezifizierer.startsWith('.')) {
          offen.push(resolve(dirname(datei), spezifizierer));
        } else {
          pakete.add(spezifizierer.split('/')[0] ?? spezifizierer);
        }
      }
    }
  }
  return { dateien: [...gesehen], pakete: [...pakete] };
}
