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
  /**
   * Verweise mit Vite-Suffix (`?worker&url`, `?url`, `?raw`, `?inline`).
   *
   * ⚠️ Solche Verweise ziehen KEINEN Code herein — `?worker&url` liefert eine
   *    URL-Zeichenkette auf einen eigenstaendigen Chunk. Wer ihnen wie einem
   *    gewoehnlichen Import folgt, meldet faelschlich, der Main-Thread erreiche
   *    die Kryptobibliothek. Sie werden deshalb hier gefuehrt statt verfolgt.
   */
  readonly assets: readonly string[];
}

/**
 * Laeuft den Importgraphen ab einem Einstiegspunkt ab und sammelt, welche
 * externen Pakete von dort erreichbar sind.
 */
export function laufeGraph(einstieg: string): GraphErgebnis {
  const gesehen = new Set<string>();
  const pakete = new Set<string>();
  const assets = new Set<string>();
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

        const [pfad, abfrage] = spezifizierer.split('?');
        if (pfad === undefined) continue;

        // Asset-Verweis statt Code-Import: nicht verfolgen, aber festhalten.
        if (abfrage !== undefined && /\b(worker|url|raw|inline)\b/.test(abfrage)) {
          assets.add(spezifizierer);
          continue;
        }

        if (pfad.startsWith('.')) {
          offen.push(resolve(dirname(datei), pfad));
        } else {
          pakete.add(pfad.split('/')[0] ?? pfad);
        }
      }
    }
  }
  return { dateien: [...gesehen], pakete: [...pakete], assets: [...assets] };
}
