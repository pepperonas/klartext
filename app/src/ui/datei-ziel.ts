/**
 * Wohin das Ergebnis geschrieben wird.
 *
 * Ohne die File System Access API führt der Weg über einen Blob und einen
 * Objekt-URL: das Ergebnis liegt dann ZWEIMAL im Arbeitsspeicher — einmal als
 * Uint8Array aus dem Worker, einmal als Blob. Bei einer halben Gigabyte-Datei
 * ist das der Unterschied zwischen „geht" und „der Tab stirbt".
 *
 * ⚠️ Was das NICHT ist: strömende Verarbeitung. Die Verschlüsselung selbst
 *    reicht das ganze Ergebnis als Uint8Array über die Worker-Grenze, hier wird
 *    also weiterhin die vollständige Datei im Speicher gehalten. Gespart wird
 *    die zweite Kopie, nicht die erste. Echtes Streaming hiesse, den Datenstrom
 *    durch den Worker zu führen; das steht nicht an, und die Oberfläche
 *    behauptet es auch nicht.
 *
 * ⚠️ Die eigentliche Falle: `showSaveFilePicker()` verlangt eine FRISCHE
 *    Nutzergeste. Sie hält nur wenige Sekunden. Wer den Dialog erst NACH dem
 *    Verschlüsseln öffnet, bekommt bei genau den grossen Dateien, um die es
 *    geht, einen `SecurityError` — die Geste ist dann längst verfallen. Deshalb
 *    wird das Ziel VORHER erfragt, solange der Klick noch zählt. Das liest sich
 *    obendrein besser: erst sagen wohin, dann arbeiten.
 */

interface SchreibStrom {
  write(daten: BufferSource): Promise<void>;
  close(): Promise<void>;
}
export interface DateiZiel {
  createWritable(): Promise<SchreibStrom>;
}
interface Auswahl {
  showSaveFilePicker?: (optionen: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<DateiZiel>;
}

/** Ab hier lohnt der Umweg über die Platte. Darunter ist der Blob unbedenklich. */
export const GROSS_AB_BYTES = 64 * 1024 * 1024;

export function kannAufPlatteSchreiben(): boolean {
  return typeof (globalThis as Auswahl).showSaveFilePicker === 'function';
}

/**
 * Fragt nach dem Ziel. Gibt `null` zurück, wenn abgebrochen wurde ODER wenn es
 * nicht geht — beides führt zum Blob-Rückfall, der immer funktioniert.
 */
export async function frageZiel(vorschlag: string): Promise<DateiZiel | null> {
  const auswahl = (globalThis as Auswahl).showSaveFilePicker;
  if (auswahl === undefined) return null;
  try {
    return await auswahl({
      suggestedName: vorschlag,
      types: [{ description: 'Datei', accept: { 'application/octet-stream': ['.gpg', '.bin'] } }],
    });
  } catch {
    // AbortError (abgebrochen), SecurityError (Geste verfallen), NotAllowedError
    // — für den Ablauf ist all das dasselbe: es gibt kein Ziel, also Rückfall.
    return null;
  }
}

/** Schreibt und meldet, ob es geklappt hat. Wirft nicht. */
export async function schreibe(ziel: DateiZiel, daten: Uint8Array): Promise<boolean> {
  try {
    const strom = await ziel.createWritable();
    await strom.write(daten as BufferSource);
    await strom.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Legt das Ergebnis ab und meldet, wohin.
 *
 * ⚠️ Der Rückfall greift auch, wenn ein Ziel bereitstand, das Schreiben aber
 *    scheiterte — Platte voll, Ort inzwischen weg, Rechte geändert. Eine
 *    fertig entschlüsselte Datei darf daran nicht verlorengehen. Genau dieser
 *    Zweig lässt sich mit einem Textvergleich nicht festhalten (nach einer
 *    Mutation stand der Rückfall immer noch daneben, nur unerreichbar), also
 *    steht die Logik hier und wird im Verhalten geprüft.
 */
export async function legeAb(
  ziel: DateiZiel | null,
  daten: Uint8Array,
  rueckfall: () => void,
): Promise<string> {
  if (ziel !== null && (await schreibe(ziel, daten))) return ' — auf die Platte geschrieben';
  rueckfall();
  return '';
}
