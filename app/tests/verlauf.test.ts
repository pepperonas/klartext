/**
 * Der lokale Gesprächsverlauf.
 *
 * Zwei Eigenschaften tragen ihn, und beide sind leicht zu verlieren:
 *
 *  1. **Gespeichert wird Ciphertext.** Damit ist der Verlauf im Ruhezustand
 *     verschlüsselt, ohne dass eigene Kryptografie dazukäme.
 *  2. **Ein kaputter Eintrag darf nicht den ganzen Verlauf töten.** Ein
 *     Gespräch, das wegen einer einzigen unlesbaren Zeile leer bleibt, wäre
 *     die schlechtere Antwort — der Rest ist ja da.
 *
 * ⚠️ Kein `vi.useFakeTimers()` ohne `toFake`: fake-indexeddb braucht echte
 *    Timer für seine Transaktionsschleife, sonst hängt die Suite ohne Meldung.
 */

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VerlaufsEintrag } from '../src/crypto/protocol.ts';
import { DB_NAME, STORE_MESSAGES, oeffne, alle } from '../src/worker/idb.ts';
import { Verlauf } from '../src/worker/verlauf.ts';

/**
 * Die Entschlüsselung wird ausgetauscht: hier geht es um die Verlaufslogik,
 * nicht um OpenPGP — das prüfen gpg-interop und werkzeug.
 *
 * ⚠️ Der Ersatz-Ciphertext enthält den Klartext BEWUSST nicht. Mein erster
 *    Anlauf schrieb `GEHEIM:<klartext>` und wollte danach prüfen, dass der
 *    Klartext nicht auf der Platte steht — er stand natürlich drin, weil ich
 *    ihn selbst hineingeschrieben hatte. Eine Attrappe, die die geprüfte
 *    Eigenschaft verletzt, macht den Test unmöglich statt streng.
 */
const KLARTEXTE: Record<string, string> = {
  'C-eins': 'eins',
  'C-drei': 'drei',
  'C-vorher': 'vorher',
  'C-nachher': 'nachher',
  'C-hallo': 'hallo',
  'C-spaet': 'bis später',
  'C-treff': 'Treffpunkt um acht',
};

vi.mock('../src/worker/werkzeug.ts', () => ({
  entschluessele: (ciphertext: string) => {
    const klartext = KLARTEXTE[ciphertext];
    if (klartext === undefined) throw new Error('nicht entschlüsselbar');
    return Promise.resolve({ klartext, signaturen: [] });
  },
}));

let db: IDBDatabase;
let verlauf: Verlauf;

/**
 * ⚠️ Die id enthält BEWUSST nicht die Zeit.
 *
 * Der erste Anlauf vergab `id-<zeit>-…`, und IndexedDB liefert nach
 * Schlüsselreihenfolge — die stimmte damit zufällig mit der Zeitreihenfolge
 * überein. Die Mutationsprobe (Sortierung entfernt) blieb folgerichtig grün:
 * geprüft wurde die Reihenfolge der Datenbank, nicht die des Verlaufs. Jetzt
 * läuft die Schlüsselreihenfolge der Zeit ENTGEGEN, also kann nur eine echte
 * Sortierung die Erwartung erfüllen.
 */
let laufendeNummer = 0;
function eintrag(teil: Partial<VerlaufsEintrag> = {}): VerlaufsEintrag {
  return {
    id: teil.id ?? `id-${String(laufendeNummer++).padStart(3, '0')}-${teil.kontaktFp ?? 'A'}`,
    kontaktFp: 'A'.repeat(40),
    richtung: 'ein',
    ciphertext: 'C-hallo',
    zeit: 1,
    zugestellt: true,
    ...teil,
  };
}

beforeEach(async () => {
  laufendeNummer = 0;
  await new Promise((fertig) => {
    const anfrage = indexedDB.deleteDatabase(DB_NAME);
    anfrage.onsuccess = fertig; anfrage.onerror = fertig; anfrage.onblocked = fertig;
  });
  db = await oeffne();
  verlauf = new Verlauf(db);
});

afterEach(() => { db.close(); });

describe('Ablegen', () => {
  it('legt ab und findet wieder', async () => {
    // ⚠️ Denselben Eintrag festhalten, nicht zweimal erzeugen: `eintrag()`
    //    vergibt fortlaufende ids (damit die Schlüsselreihenfolge der Zeit
    //    entgegenläuft, siehe oben) — zwei Aufrufe sind zwei Nachrichten.
    const e = eintrag();
    await verlauf.lege(e);
    expect(await verlauf.kennt(e.id)).toBe(true);
  });

  it('kennt nichts, was nie abgelegt wurde', async () => {
    expect(await verlauf.kennt('gibt-es-nicht')).toBe(false);
  });

  it('speichert den CIPHERTEXT, nicht den Klartext', async () => {
    // ⚠️ Der Kern der Sache: was auf der Platte liegt, muss verschlüsselt
    //    sein. Läge hier Klartext, wäre der Verlauf im Ruhezustand offen —
    //    und niemand sähe es der App an.
    await verlauf.lege(eintrag({ ciphertext: 'C-treff' }));
    const roh = await alle<VerlaufsEintrag>(db, STORE_MESSAGES);
    expect(roh[0]?.ciphertext).toBe('C-treff');
    // Der Klartext („Treffpunkt um acht") existiert NUR in der Entschlüsselung.
    // Auf der Platte darf er nirgends auftauchen — auch nicht in einem Feld,
    // das jemand später „zum Suchen" hinzufügt.
    expect(JSON.stringify(roh)).not.toContain('Treffpunkt');
  });

  it('normalisiert den Fingerprint beim Ablegen', async () => {
    // Sonst landet dieselbe Person je nach Schreibweise in zwei Gesprächen.
    await verlauf.lege(eintrag({ kontaktFp: 'a'.repeat(40) }));
    const roh = await alle<VerlaufsEintrag>(db, STORE_MESSAGES);
    expect(roh[0]?.kontaktFp).toBe('A'.repeat(40));
  });

  it('legt denselben Eintrag nicht doppelt ab', async () => {
    // Kommt vor: die Langabfrage liefert eine Nachricht erneut aus, wenn die
    // Bestätigung unterwegs verlorenging.
    const e = eintrag();
    await verlauf.lege(e);
    await verlauf.lege(e);
    expect((await alle(db, STORE_MESSAGES)).length).toBe(1);
  });
});

describe('Auflisten', () => {
  it('gibt die Einträge zeitlich geordnet zurück', async () => {
    // Sie kommen nicht zwingend in der Reihenfolge an, in der sie geschrieben
    // wurden — eine Langabfrage kann mehrere auf einmal liefern.
    // Schlüssel aufsteigend (id-000, id-001, id-002), Zeiten absteigend —
    // nur eine echte Sortierung dreht das um.
    for (const zeit of [30, 20, 10]) await verlauf.lege(eintrag({ zeit }));
    const liste = await verlauf.liste('A'.repeat(40), [], []);
    expect(liste.map((g) => g.eintrag.zeit)).toEqual([10, 20, 30]);
  });

  it('trennt die Gespräche nach Kontakt', async () => {
    await verlauf.lege(eintrag({ kontaktFp: 'A'.repeat(40), zeit: 1 }));
    await verlauf.lege(eintrag({ kontaktFp: 'B'.repeat(40), zeit: 2 }));
    expect((await verlauf.liste('A'.repeat(40), [], [])).length).toBe(1);
    expect((await verlauf.liste('B'.repeat(40), [], [])).length).toBe(1);
  });

  it('findet das Gespräch auch bei anderer Schreibweise des Fingerprints', async () => {
    await verlauf.lege(eintrag({ kontaktFp: 'A'.repeat(40) }));
    expect((await verlauf.liste('a'.repeat(40), [], [])).length).toBe(1);
  });

  it('liefert für einen unbekannten Kontakt eine leere Liste, keinen Fehler', async () => {
    expect(await verlauf.liste('F'.repeat(40), [], [])).toEqual([]);
  });

  it('entschlüsselt beim Anzeigen', async () => {
    await verlauf.lege(eintrag({ ciphertext: 'C-spaet' }));
    const [erster] = await verlauf.liste('A'.repeat(40), [], []);
    expect(erster?.klartext).toBe('bis später');
    expect(erster?.fehler).toBeNull();
  });
});

describe('Ein kaputter Eintrag tötet nicht den Verlauf', () => {
  it('zeigt die anderen trotzdem', async () => {
    await verlauf.lege(eintrag({ zeit: 3, ciphertext: 'C-drei' }));
    await verlauf.lege(eintrag({ zeit: 2, ciphertext: 'KAPUTT' }));
    await verlauf.lege(eintrag({ zeit: 1, ciphertext: 'C-eins' }));

    const liste = await verlauf.liste('A'.repeat(40), [], []);
    expect(liste).toHaveLength(3);
    expect(liste.map((g) => g.klartext)).toEqual(['eins', null, 'drei']);
    expect(liste.map((g) => g.eintrag.zeit)).toEqual([1, 2, 3]);
  });

  it('sagt beim kaputten Eintrag, was los ist — statt ihn zu verschweigen', async () => {
    await verlauf.lege(eintrag({ ciphertext: 'KAPUTT' }));
    const [einziger] = await verlauf.liste('A'.repeat(40), [], []);
    expect(einziger?.klartext).toBeNull();
    expect(einziger?.fehler).toBeTruthy();
    expect(einziger?.fehler).toMatch(/nicht mehr entschlüsseln|nicht entschlüsselbar/i);
  });

  it('behält auch beim kaputten Eintrag seinen Platz in der Reihenfolge', async () => {
    // Ihn ans Ende zu schieben oder wegzulassen verfälschte das Gespräch.
    await verlauf.lege(eintrag({ zeit: 3, ciphertext: 'C-nachher' }));
    await verlauf.lege(eintrag({ zeit: 2, ciphertext: 'KAPUTT' }));
    await verlauf.lege(eintrag({ zeit: 1, ciphertext: 'C-vorher' }));
    const liste = await verlauf.liste('A'.repeat(40), [], []);
    expect(liste.map((g) => g.eintrag.zeit)).toEqual([1, 2, 3]);
    expect(liste[1]?.fehler).toBeTruthy();
  });
});

describe('Löschen', () => {
  it('löscht nur das eine Gespräch', async () => {
    await verlauf.lege(eintrag({ kontaktFp: 'A'.repeat(40), zeit: 1 }));
    await verlauf.lege(eintrag({ kontaktFp: 'B'.repeat(40), zeit: 2 }));
    await verlauf.loesche('A'.repeat(40));
    expect((await verlauf.liste('A'.repeat(40), [], [])).length).toBe(0);
    expect((await verlauf.liste('B'.repeat(40), [], [])).length).toBe(1);
  });

  it('kommt mit einem leeren Gespräch klar', async () => {
    await expect(verlauf.loesche('C'.repeat(40))).resolves.toBeUndefined();
  });

  it('löscht auch bei anderer Schreibweise des Fingerprints', async () => {
    await verlauf.lege(eintrag({ kontaktFp: 'A'.repeat(40) }));
    await verlauf.loesche('a'.repeat(40));
    expect((await alle(db, STORE_MESSAGES)).length).toBe(0);
  });
});

describe('Zähler', () => {
  it('zählt je Kontakt', async () => {
    await verlauf.lege(eintrag({ kontaktFp: 'A'.repeat(40), zeit: 1 }));
    await verlauf.lege(eintrag({ kontaktFp: 'A'.repeat(40), zeit: 2 }));
    await verlauf.lege(eintrag({ kontaktFp: 'B'.repeat(40), zeit: 3 }));
    expect(await verlauf.zaehler()).toEqual({ ['A'.repeat(40)]: 2, ['B'.repeat(40)]: 1 });
  });

  it('ist bei leerem Verlauf leer, nicht undefined', async () => {
    expect(await verlauf.zaehler()).toEqual({});
  });

  it('entschlüsselt zum Zählen nichts', async () => {
    // Der Zähler läuft in der Kontaktliste, also oft und auch bei gesperrtem
    // Bund. Müsste er entschlüsseln, wäre er dort nicht zu gebrauchen.
    await verlauf.lege(eintrag({ ciphertext: 'KAPUTT' }));
    expect(await verlauf.zaehler()).toEqual({ ['A'.repeat(40)]: 1 });
  });
});
