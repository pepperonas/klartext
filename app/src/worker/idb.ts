/**
 * Duenner Promise-Mantel um IndexedDB. Bewusst kein `idb`-Paket: 40 Zeilen
 * gegen eine Laufzeit-Abhaengigkeit in einer App, deren Werbeversprechen
 * "eine einzige Abhaengigkeit" ist.
 */

export const DB_NAME = 'klartext';
export const DB_VERSION = 3;

export const STORE_KEYS = 'keys';
export const STORE_SETTINGS = 'settings';
export const STORE_CONTACTS = 'contacts';
export const STORE_MESSAGES = 'messages';

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
      /* eslint-disable no-fallthrough */
      // ⚠️ Das Durchfallen ist GEWOLLT — deshalb ist auch
      //    `noFallthroughCasesInSwitch` in tsconfig.base.json abgeschaltet: wer von Version 0 kommt, muss alle
      //    Stufen durchlaufen. Wer von 1 kommt, nur die ab 1. Ein `break` hier
      //    liesse Bestandsnutzer ohne die neuen Stores zurück.
      switch (event.oldVersion) {
        case 0:
          db.createObjectStore(STORE_KEYS, { keyPath: 'fingerprint' });
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        case 1:
          db.createObjectStore(STORE_CONTACTS, { keyPath: 'fingerprint' });
        case 2: {
          const nachrichten = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
          // Nach Gesprächspartner und Zeit — so wird die Ansicht gelesen.
          nachrichten.createIndex('kontakt', ['kontaktFp', 'zeit']);
        }
      }
      /* eslint-enable no-fallthrough */
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
