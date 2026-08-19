/**
 * Der Speicher — bewusst arm.
 *
 * Zwei Tabellen, und das ist die vollständige Liste. Kein Klarname, keine
 * Absender-Spalte, keine Empfangsbestätigung an Dritte, keine IP. Was nicht
 * gespeichert wird, kann auch nicht beschlagnahmt, geleakt oder ausgewertet
 * werden.
 *
 * ⚠️ `secure_delete` ist eingeschaltet: ohne das bliebe der Ciphertext
 *    gelöschter Nachrichten als Seitenrest in der Datei stehen. Bei einem
 *    Dienst, dessen ganzer Zweck das Vergessen ist, wäre das absurd.
 *
 * ⚠️ SQLite als WASM (`node-sqlite3-wasm`), nicht als native Erweiterung.
 *    `better-sqlite3` braucht einen Compiler — auf dem Entwicklungsrechner und
 *    beim Ausrollen auf dem Server. Hier scheiterte der Bau schon lokal
 *    (Version 13 verlangt Node ≥22, Version 12 liess sich mit dieser
 *    node-gyp-Fassung nicht übersetzen). Für zwei winzige Tabellen ist eine
 *    Abhängigkeit, die überall einen Compiler voraussetzt, der falsche Preis.
 *    Die WASM-Fassung ist dasselbe SQLite, beherrscht dieselben Pragmas und
 *    läuft ohne Bauschritt auf jedem Node.
 */

// ⚠️ `node-sqlite3-wasm` ist ein CommonJS-Modul. Ein benannter Import
//    (`import { Database } from …`) funktioniert im Testlauf, weil Vitest das
//    Modul bündelt — im ausgelieferten ESM aber NICHT: Node wirft dort
//    „Named export 'Database' not found". Ein Unterschied zwischen Test und
//    Betrieb, den nur das Starten des gebauten Servers zeigt.
import sqlite from 'node-sqlite3-wasm';

const { Database } = sqlite;
type Database = InstanceType<typeof sqlite.Database>;

export interface Nachricht {
  readonly id: string;
  readonly mailbox_id: string;
  readonly blob: string;
  readonly created_at: number;
  readonly expires_at: number;
}

export interface Postfach {
  readonly mailbox_id: string;
  readonly token_hash: string;
  readonly created_at: number;
}

export interface Grenzen {
  /** Höchstgrösse einer Nachricht in Bytes. */
  readonly maxNachricht: number;
  /** Höchstzahl Nachrichten je Postfach. */
  readonly maxProPostfach: number;
  /** Höchstsumme Bytes je Postfach. */
  readonly maxBytesProPostfach: number;
  /** Aufbewahrung in Sekunden. */
  readonly ttl: number;
}

export const STANDARD_GRENZEN: Grenzen = {
  maxNachricht: 2 * 1024 * 1024,
  maxProPostfach: 100,
  maxBytesProPostfach: 32 * 1024 * 1024,
  ttl: 7 * 86_400,
};

export class Speicher {
  readonly #db: Database;
  readonly grenzen: Grenzen;

  constructor(pfad: string, grenzen: Grenzen = STANDARD_GRENZEN) {
    this.grenzen = grenzen;
    this.#db = new Database(pfad);
    this.#db.run('PRAGMA journal_mode = WAL');
    // Gelöschte Blobs sollen wirklich weg sein, nicht nur unverkettet.
    this.#db.run('PRAGMA secure_delete = ON');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id         TEXT PRIMARY KEY,
        mailbox_id TEXT NOT NULL,
        blob       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_mailbox ON messages(mailbox_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_expiry  ON messages(expires_at);

      CREATE TABLE IF NOT EXISTS mailboxes (
        mailbox_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  /** Die Spalten, die es tatsächlich gibt — für den Schema-Test. */
  spalten(tabelle: string): string[] {
    const zeilen = this.#db.all(`PRAGMA table_info(${tabelle})`) as unknown as { name: string }[];
    return zeilen.map((z) => z.name).sort();
  }

  // ------------------------------------------------------------- Postfächer

  postfach(kennung: string): Postfach | undefined {
    const zeile = this.#db.get('SELECT * FROM mailboxes WHERE mailbox_id = ?', [kennung]);
    return (zeile ?? undefined) as Postfach | undefined;
  }

  legePostfachAn(kennung: string, tokenHash: string, jetzt: number): void {
    this.#db.run(
      `INSERT INTO mailboxes (mailbox_id, token_hash, created_at) VALUES (?, ?, ?)
       ON CONFLICT(mailbox_id) DO UPDATE SET token_hash = excluded.token_hash`,
      [kennung, tokenHash, jetzt],
    );
  }

  // ------------------------------------------------------------ Nachrichten

  /** Wie viele Nachrichten und wie viele Bytes liegen in diesem Postfach? */
  belegung(kennung: string): { anzahl: number; bytes: number } {
    return this.#db.get(
      'SELECT COUNT(*) AS anzahl, COALESCE(SUM(LENGTH(blob)), 0) AS bytes FROM messages WHERE mailbox_id = ?',
      [kennung],
    ) as unknown as { anzahl: number; bytes: number };
  }

  lege(nachricht: Nachricht): void {
    this.#db.run(
      'INSERT INTO messages (id, mailbox_id, blob, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      [nachricht.id, nachricht.mailbox_id, nachricht.blob, nachricht.created_at, nachricht.expires_at],
    );
  }

  hole(kennung: string, jetzt: number): Nachricht[] {
    return this.#db.all(
      'SELECT * FROM messages WHERE mailbox_id = ? AND expires_at > ? ORDER BY created_at ASC',
      [kennung, jetzt],
    ) as unknown as Nachricht[];
  }

  /**
   * Löscht nach ausdrücklicher Bestätigung.
   *
   * ⚠️ NICHT beim Lesen. Ein Abbruch im Mobilfunk darf keine Nachricht
   *    vernichten — der Empfänger bestätigt, wenn er sie sicher hat.
   */
  loesche(kennung: string, ids: readonly string[]): number {
    if (ids.length === 0) return 0;
    const platzhalter = ids.map(() => '?').join(',');
    const ergebnis = this.#db.run(
      `DELETE FROM messages WHERE mailbox_id = ? AND id IN (${platzhalter})`,
      [kennung, ...ids],
    );
    return ergebnis.changes;
  }

  /** Aufräumen: alles, was seine Zeit hinter sich hat. */
  raeumeAuf(jetzt: number): number {
    return this.#db.run('DELETE FROM messages WHERE expires_at <= ?', [jetzt]).changes;
  }

  schliesse(): void {
    this.#db.close();
  }
}
