/**
 * Duenner Promise-Mantel um IndexedDB. Bewusst kein `idb`-Paket: 40 Zeilen
 * gegen eine Laufzeit-Abhaengigkeit in einer App, deren Werbeversprechen
 * "eine einzige Abhaengigkeit" ist.
 */

export const DB_NAME = 'klartext';
export const DB_VERSION = 1;

export const STORE_KEYS = 'keys';
export const STORE_SETTINGS = 'settings';

function warte<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB-Fehler')); };
  });
}

/**
 * Migrationen sind additiv und nach Version gestaffelt. Phase 3 und 4 haengen
 * hier ihre Stores an, ohne die bestehenden anzufassen — `oldVersion` faellt
 * absichtlich durch die Faelle durch.
 */
export function oeffne(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      switch (event.oldVersion) {
        case 0:
          db.createObjectStore(STORE_KEYS, { keyPath: 'fingerprint' });
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        // Phase 3 haengt hier `case 1:` fuer 'contacts' an, Phase 4 `case 2:`
        // fuer 'messages'. Das Durchfallen ist gewollt: wer von Version 0
        // kommt, braucht alle Stufen. Sobald ein zweiter Fall dazukommt,
        // braucht dieser Block wieder ein `eslint-disable no-fallthrough`.
      }
    };

    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB nicht verfügbar')); };
    request.onblocked = () => { reject(new Error('IndexedDB blockiert — anderer Tab offen?')); };
  });
}

export async function alle<T>(db: IDBDatabase, store: string): Promise<T[]> {
  const tx = db.transaction(store, 'readonly');
  return await warte(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function lies<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  const tx = db.transaction(store, 'readonly');
  return await warte(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
}

export async function schreibe(db: IDBDatabase, store: string, wert: unknown): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  await warte(tx.objectStore(store).put(wert));
}

export async function loesche(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  await warte(tx.objectStore(store).delete(key));
}
