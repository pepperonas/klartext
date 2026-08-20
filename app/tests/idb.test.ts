/**
 * Der IndexedDB-Mantel — inklusive Migrationspfad.
 *
 * Migrationen sind die Stelle, an der man Nutzerdaten verliert, ohne es zu
 * merken: Phase 3 und 4 hängen hier Stores an, und wenn `oldVersion` falsch
 * behandelt wird, steht ein Bestandsnutzer plötzlich ohne Schlüssel da.
 */

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DB_NAME, DB_VERSION, STORE_CONTACTS, STORE_INTROS, STORE_KEYS, STORE_MESSAGES, STORE_SETTINGS, alle, lies, loesche, oeffne, schreibe } from '../src/worker/idb.ts';

let db: IDBDatabase | null = null;

async function frisch(): Promise<IDBDatabase> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => { resolve(); };
    req.onerror = () => { resolve(); };
    req.onblocked = () => { resolve(); };
  });
  return await oeffne();
}

beforeEach(async () => { db = await frisch(); });
afterEach(() => { db?.close(); db = null; });

describe('Anlegen', () => {
  it('legt alle Stores an', () => {
    expect([...(db?.objectStoreNames ?? [])].sort())
      .toEqual([STORE_KEYS, STORE_SETTINGS, STORE_CONTACTS, STORE_MESSAGES, STORE_INTROS].sort());
  });

  it('führt die erwartete Version', () => {
    expect(db?.version).toBe(DB_VERSION);
  });

  it('nutzt den Fingerprint als Schlüssel', async () => {
    if (db === null) throw new Error('keine DB');
    await schreibe(db, STORE_KEYS, { fingerprint: 'ABC', label: 'eins' });
    await schreibe(db, STORE_KEYS, { fingerprint: 'ABC', label: 'zwei' });
    const zeilen = await alle<{ label: string }>(db, STORE_KEYS);
    // Zweimal derselbe Fingerprint muss ERSETZEN, nicht verdoppeln.
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.label).toBe('zwei');
  });
});

describe('Lesen und Schreiben', () => {
  it('gibt zurück, was hineingeschrieben wurde', async () => {
    if (db === null) throw new Error('keine DB');
    const zeile = { fingerprint: 'FF00', label: 'Test', tief: { a: [1, 2, 3] } };
    await schreibe(db, STORE_KEYS, zeile);
    expect(await lies(db, STORE_KEYS, 'FF00')).toEqual(zeile);
  });

  it('liefert undefined für Unbekanntes, statt zu werfen', async () => {
    if (db === null) throw new Error('keine DB');
    expect(await lies(db, STORE_KEYS, 'gibtsnicht')).toBeUndefined();
  });

  it('löscht', async () => {
    if (db === null) throw new Error('keine DB');
    await schreibe(db, STORE_KEYS, { fingerprint: 'X' });
    await loesche(db, STORE_KEYS, 'X');
    expect(await lies(db, STORE_KEYS, 'X')).toBeUndefined();
  });

  it('liefert eine leere Liste, keinen Fehler, wenn nichts da ist', async () => {
    if (db === null) throw new Error('keine DB');
    expect(await alle(db, STORE_KEYS)).toEqual([]);
  });

  it('hält Einstellungen unter ihrem eigenen Schlüssel', async () => {
    if (db === null) throw new Error('keine DB');
    await schreibe(db, STORE_SETTINGS, { key: 'vault', value: { autoLockMinutes: 5 } });
    const zeile = await lies<{ value: { autoLockMinutes: number } }>(db, STORE_SETTINGS, 'vault');
    expect(zeile?.value.autoLockMinutes).toBe(5);
  });
});

describe('Migration', () => {
  it('lässt vorhandene Daten beim Wiederöffnen unangetastet', async () => {
    if (db === null) throw new Error('keine DB');
    await schreibe(db, STORE_KEYS, { fingerprint: 'BLEIBT', label: 'Bestand' });
    db.close();

    const zweite = await oeffne();
    try {
      const zeile = await lies<{ label: string }>(zweite, STORE_KEYS, 'BLEIBT');
      expect(zeile?.label).toBe('Bestand');
    } finally { zweite.close(); }
    db = null;
  });

  it('legt beim Aufstieg von Version 0 alles an — der Pfad für Neuinstallationen', async () => {
    // Der Fall, den Phase 3 und 4 nicht kaputt machen dürfen: wer von 0 kommt,
    // muss ALLE Stufen durchlaufen.
    db?.close();
    db = await frisch();
    expect([...db.objectStoreNames]).toContain(STORE_KEYS);
    expect([...db.objectStoreNames]).toContain(STORE_SETTINGS);
    expect([...db.objectStoreNames]).toContain(STORE_CONTACTS);
    expect([...db.objectStoreNames]).toContain(STORE_MESSAGES);
  });

  it('rüstet einen Bestand von Version 1 auf 2 nach — ohne Datenverlust', async () => {
    // ⚠️ Genau hier verliert man Nutzerdaten, ohne es zu merken. Wer schon
    //    Schlüssel hat, darf beim Aufstieg weder sie noch die neuen Stores
    //    einbüssen. Das Durchfallen im switch ist dafür da.
    db?.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => { resolve(); };
      req.onerror = () => { resolve(); };
      req.onblocked = () => { resolve(); };
    });

    // Eine alte Datenbank von Hand aufbauen — so sah Phase 1 aus.
    const alt = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_KEYS, { keyPath: 'fingerprint' });
        req.result.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      };
      req.onsuccess = () => { resolve(req.result); };
      req.onerror = () => { reject(req.error ?? new Error('offen fehlgeschlagen')); };
    });
    await schreibe(alt, STORE_KEYS, { fingerprint: 'ALT', label: 'Bestandsschlüssel' });
    alt.close();

    db = await oeffne();
    expect(db.version).toBe(DB_VERSION);
    // Beide später hinzugekommenen Stores müssen da sein — das Durchfallen im
    // switch ist genau dafür da.
    expect([...db.objectStoreNames]).toContain(STORE_CONTACTS);
    expect([...db.objectStoreNames]).toContain(STORE_MESSAGES);
    expect([...db.objectStoreNames]).toContain(STORE_INTROS);
    const zeile = await lies<{ label: string }>(db, STORE_KEYS, 'ALT');
    expect(zeile?.label).toBe('Bestandsschlüssel');
  });

  it('rüstet auch von Version 2 nach — der Zwischenstand aus Phase 3', async () => {
    db?.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => { resolve(); };
      req.onerror = () => { resolve(); };
      req.onblocked = () => { resolve(); };
    });
    const alt = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_KEYS, { keyPath: 'fingerprint' });
        req.result.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        req.result.createObjectStore(STORE_CONTACTS, { keyPath: 'fingerprint' });
      };
      req.onsuccess = () => { resolve(req.result); };
      req.onerror = () => { reject(req.error ?? new Error('offen fehlgeschlagen')); };
    });
    await schreibe(alt, STORE_CONTACTS, { fingerprint: 'KONTAKT', name: 'Rosa' });
    alt.close();

    db = await oeffne();
    expect([...db.objectStoreNames]).toContain(STORE_MESSAGES);
    expect((await lies<{ name: string }>(db, STORE_CONTACTS, 'KONTAKT'))?.name).toBe('Rosa');
  });
});
