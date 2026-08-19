/**
 * Das Relay.
 *
 * Der wichtigste Test hier ist der letzte Block: die Zusage, dass der Server
 * ausschliesslich Ciphertext sieht, wird nicht behauptet, sondern nachgemessen
 * — an der Datenbankdatei selbst und am Schema.
 */

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as openpgp from 'openpgp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HERAUSFORDERUNG_TTL_MS, Herausforderungen, tokenHash, tokenStimmt } from '../src/auth.ts';
import { Drossel } from '../src/drossel.ts';
import { herausforderungsText, istKennung, postfachKennung } from '../src/postfach.ts';
import { baueServer } from '../src/server.ts';
import type { Speicher } from '../src/db.ts';

const GEHEIM = 'GEHEIMER-KLARTEXT-MARKER-4f81b3 mit Umlauten: Grüße';

let verzeichnis: string;
let dbPfad: string;
let app: ReturnType<typeof baueServer>;
let uhr = Date.UTC(2026, 7, 19, 12, 0, 0);

let schluessel: { privat: openpgp.PrivateKey; oeffentlich: string; kennung: string };

beforeEach(async () => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'klartext-relay-'));
  dbPfad = join(verzeichnis, 'relay.db');
  uhr = Date.UTC(2026, 7, 19, 12, 0, 0);
  app = baueServer({ datenbank: dbPfad, jetzt: () => uhr });
  await app.ready();

  // Der Schlüssel wird einmal erzeugt und für alle Fälle wiederverwendet —
  // RSA/ECC-Erzeugung je Test wäre reine Wartezeit.
  if ((schluessel as typeof schluessel | undefined) === undefined) {
    const erzeugt = await openpgp.generateKey({
      userIDs: [{ name: 'Relay Probe', email: 'probe@relay.invalid' }],
      type: 'ecc', curve: 'ed25519Legacy', format: 'object',
    });
    schluessel = {
      privat: erzeugt.privateKey,
      oeffentlich: erzeugt.publicKey.armor(),
      kennung: postfachKennung(erzeugt.publicKey.getFingerprint()),
    };
  }
});

afterEach(async () => {
  await app.close();
  rmSync(verzeichnis, { recursive: true, force: true });
});

async function ciphertext(text = GEHEIM): Promise<string> {
  return await openpgp.encrypt({
    message: await openpgp.createMessage({ text }),
    encryptionKeys: await openpgp.readKey({ armoredKey: schluessel.oeffentlich }),
  });
}

/** Richtet das Postfach ein und liefert das Lesetoken. */
async function richteEin(): Promise<string> {
  const heraus = await app.inject({
    method: 'POST', url: '/v1/challenge', payload: { kennung: schluessel.kennung },
  });
  const { nonce } = heraus.json<{ nonce: string }>();
  const signatur = await openpgp.sign({
    message: await openpgp.createMessage({ text: herausforderungsText(schluessel.kennung, nonce) }),
    signingKeys: schluessel.privat, detached: true,
  });
  const antwort = await app.inject({
    method: 'POST', url: '/v1/register',
    payload: { kennung: schluessel.kennung, schluessel: schluessel.oeffentlich, nonce, signatur },
  });
  expect(antwort.statusCode).toBe(200);
  return antwort.json<{ token: string }>().token;
}

async function sende(blob?: string) {
  return await app.inject({
    method: 'POST', url: `/v1/mailbox/${schluessel.kennung}`,
    payload: { blob: blob ?? (await ciphertext()) },
  });
}

// ==================================================================== Absenden

describe('Absenden', () => {
  it('nimmt Ciphertext an — ohne jede Anmeldung', async () => {
    // Wer den öffentlichen Schlüssel hat, darf schreiben. Genau so ist es gemeint.
    expect((await sende()).statusCode).toBe(202);
  });

  it('weist offensichtlichen Klartext ab', async () => {
    const antwort = await sende('Das hier ist einfach nur Text.');
    expect(antwort.statusCode).toBe(400);
    expect(antwort.json<{ fehler: string }>().fehler).toBe('kein-ciphertext');
  });

  it('weist eine unsinnige Kennung ab', async () => {
    const antwort = await app.inject({
      method: 'POST', url: '/v1/mailbox/zu-kurz', payload: { blob: await ciphertext() },
    });
    expect(antwort.statusCode).toBe(400);
  });

  it('weist zu grosse Nachrichten ab', async () => {
    const app2 = baueServer({
      datenbank: join(verzeichnis, 'klein.db'),
      jetzt: () => uhr,
      grenzen: { maxNachricht: 500, maxProPostfach: 100, maxBytesProPostfach: 1_000_000, ttl: 3600 },
    });
    await app2.ready();
    const gross = `-----BEGIN PGP MESSAGE-----\n${'x'.repeat(1000)}`;
    const antwort = await app2.inject({
      method: 'POST', url: `/v1/mailbox/${schluessel.kennung}`, payload: { blob: gross },
    });
    expect(antwort.statusCode).toBe(413);
    await app2.close();
  });

  it('meldet ein volles Postfach, statt unbegrenzt zu wachsen', async () => {
    const app2 = baueServer({
      datenbank: join(verzeichnis, 'voll.db'),
      jetzt: () => uhr,
      grenzen: { maxNachricht: 1_000_000, maxProPostfach: 2, maxBytesProPostfach: 1_000_000, ttl: 3600 },
    });
    await app2.ready();
    const blob = await ciphertext();
    for (let i = 0; i < 2; i++) {
      expect((await app2.inject({
        method: 'POST', url: `/v1/mailbox/${schluessel.kennung}`, payload: { blob },
      })).statusCode).toBe(202);
    }
    const dritte = await app2.inject({
      method: 'POST', url: `/v1/mailbox/${schluessel.kennung}`, payload: { blob },
    });
    expect(dritte.statusCode).toBe(507);
    await app2.close();
  });
});

// ================================================================ Einrichten

describe('Besitznachweis', () => {
  it('richtet ein Postfach gegen eine gültige Signatur ein', async () => {
    const token = await richteEin();
    expect(token.length).toBeGreaterThan(20);
  });

  it('weist eine Kennung ab, die nicht zum Schlüssel gehört', async () => {
    // ⚠️ Der Server GLAUBT die Kennung nicht, er rechnet sie nach.
    const fremd = postfachKennung('A'.repeat(40));
    const heraus = await app.inject({ method: 'POST', url: '/v1/challenge', payload: { kennung: fremd } });
    const { nonce } = heraus.json<{ nonce: string }>();
    const signatur = await openpgp.sign({
      message: await openpgp.createMessage({ text: herausforderungsText(fremd, nonce) }),
      signingKeys: schluessel.privat, detached: true,
    });
    const antwort = await app.inject({
      method: 'POST', url: '/v1/register',
      payload: { kennung: fremd, schluessel: schluessel.oeffentlich, nonce, signatur },
    });
    expect(antwort.statusCode).toBe(401);
    expect(antwort.json<{ fehler: string }>().fehler).toBe('kennung-passt-nicht');
  });

  it('weist eine Signatur über einen ANDEREN Nonce ab', async () => {
    const heraus = await app.inject({
      method: 'POST', url: '/v1/challenge', payload: { kennung: schluessel.kennung },
    });
    const { nonce } = heraus.json<{ nonce: string }>();
    // Über etwas anderes signiert — ein abgefangener Signaturblock nützt nichts.
    const signatur = await openpgp.sign({
      message: await openpgp.createMessage({ text: herausforderungsText(schluessel.kennung, 'anderer-nonce') }),
      signingKeys: schluessel.privat, detached: true,
    });
    const antwort = await app.inject({
      method: 'POST', url: '/v1/register',
      payload: { kennung: schluessel.kennung, schluessel: schluessel.oeffentlich, nonce, signatur },
    });
    expect(antwort.statusCode).toBe(401);
    expect(antwort.json<{ fehler: string }>().fehler).toBe('signatur-ungueltig');
  });

  it('verbraucht einen Nonce genau einmal', async () => {
    const heraus = await app.inject({
      method: 'POST', url: '/v1/challenge', payload: { kennung: schluessel.kennung },
    });
    const { nonce } = heraus.json<{ nonce: string }>();
    const signatur = await openpgp.sign({
      message: await openpgp.createMessage({ text: herausforderungsText(schluessel.kennung, nonce) }),
      signingKeys: schluessel.privat, detached: true,
    });
    const nutzlast = { kennung: schluessel.kennung, schluessel: schluessel.oeffentlich, nonce, signatur };
    expect((await app.inject({ method: 'POST', url: '/v1/register', payload: nutzlast })).statusCode).toBe(200);
    // Wiederholung: derselbe Nonce ist verbraucht.
    expect((await app.inject({ method: 'POST', url: '/v1/register', payload: nutzlast })).statusCode).toBe(401);
  });

  it('lässt eine abgelaufene Herausforderung verfallen', () => {
    const h = new Herausforderungen();
    const { nonce } = h.stelle('k'.repeat(43), 1000);
    expect(h.verbrauche(nonce, 'k'.repeat(43), 1000 + HERAUSFORDERUNG_TTL_MS + 1)).toBe(false);
  });
});

// =================================================================== Abholen

describe('Abholen', () => {
  it('braucht ein Lesetoken', async () => {
    await sende();
    const ohne = await app.inject({ method: 'GET', url: `/v1/mailbox/${schluessel.kennung}/messages` });
    expect(ohne.statusCode).toBe(401);
  });

  it('weist ein falsches Token ab', async () => {
    await richteEin();
    await sende();
    const antwort = await app.inject({
      method: 'GET', url: `/v1/mailbox/${schluessel.kennung}/messages`,
      headers: { authorization: 'Bearer falsch' },
    });
    expect(antwort.statusCode).toBe(401);
  });

  it('liefert die Nachricht unverändert zurück', async () => {
    const token = await richteEin();
    const blob = await ciphertext();
    await sende(blob);
    const antwort = await app.inject({
      method: 'GET', url: `/v1/mailbox/${schluessel.kennung}/messages`,
      headers: { authorization: `Bearer ${token}` },
    });
    const { nachrichten } = antwort.json<{ nachrichten: { blob: string }[] }>();
    expect(nachrichten).toHaveLength(1);
    expect(nachrichten[0]?.blob).toBe(blob);
  });

  it('löscht NICHT beim Lesen — erst auf Bestätigung', async () => {
    // ⚠️ Ein Abbruch im Mobilfunk darf keine Nachricht vernichten.
    const token = await richteEin();
    await sende();
    const kopf = { authorization: `Bearer ${token}` };
    const url = `/v1/mailbox/${schluessel.kennung}/messages`;

    const erste = await app.inject({ method: 'GET', url, headers: kopf });
    const { nachrichten } = erste.json<{ nachrichten: { id: string }[] }>();
    expect(nachrichten).toHaveLength(1);

    const nochmal = await app.inject({ method: 'GET', url, headers: kopf });
    expect(nochmal.json<{ nachrichten: unknown[] }>().nachrichten).toHaveLength(1);

    const weg = await app.inject({
      method: 'DELETE', url, headers: kopf, payload: { ids: [nachrichten[0]?.id] },
    });
    expect(weg.json<{ geloescht: number }>().geloescht).toBe(1);

    const danach = await app.inject({ method: 'GET', url, headers: kopf });
    expect(danach.json<{ nachrichten: unknown[] }>().nachrichten).toHaveLength(0);
  });

  it('liefert abgelaufene Nachrichten nicht mehr aus', async () => {
    const token = await richteEin();
    await sende();
    uhr += 8 * 86_400_000; // eine Woche und ein Tag
    const antwort = await app.inject({
      method: 'GET', url: `/v1/mailbox/${schluessel.kennung}/messages`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(antwort.json<{ nachrichten: unknown[] }>().nachrichten).toHaveLength(0);
  });

  it('eine Langabfrage wird durch ein Absenden sofort geweckt', async () => {
    const token = await richteEin();
    const abfrage = app.inject({
      method: 'GET', url: `/v1/mailbox/${schluessel.kennung}/messages?wait=20`,
      headers: { authorization: `Bearer ${token}` },
    });
    // Kurz warten, damit die Abfrage wirklich hängt, dann senden.
    await new Promise<void>((r) => { setTimeout(() => { r(); }, 50); });
    await sende();
    const antwort = await abfrage;
    expect(antwort.json<{ nachrichten: unknown[] }>().nachrichten).toHaveLength(1);
  }, 30_000);
});

// ============================================================== Drosselung

describe('Drosselung', () => {
  it('lässt die ersten durch und bremst danach', () => {
    const d = new Drossel(3, 60);
    expect(d.erlaubt('a', 0)).toBe(true);
    expect(d.erlaubt('a', 0)).toBe(true);
    expect(d.erlaubt('a', 0)).toBe(true);
    expect(d.erlaubt('a', 0)).toBe(false);
  });

  it('füllt mit der Zeit wieder auf', () => {
    const d = new Drossel(3, 60);
    for (let i = 0; i < 3; i++) d.erlaubt('a', 0);
    expect(d.erlaubt('a', 0)).toBe(false);
    expect(d.erlaubt('a', 21_000)).toBe(true);
  });

  it('trennt die Zähler nach Schlüssel', () => {
    const d = new Drossel(1, 60);
    expect(d.erlaubt('a', 0)).toBe(true);
    expect(d.erlaubt('b', 0)).toBe(true);
    expect(d.erlaubt('a', 0)).toBe(false);
  });

  it('vergisst volle Eimer, statt unbegrenzt zu wachsen', () => {
    const d = new Drossel(2, 10);
    d.erlaubt('a', 0);
    expect(d.groesse).toBe(1);
    d.raeumeAuf(60_000);
    expect(d.groesse).toBe(0);
  });
});

// ================================================================== Tokens

describe('Tokens', () => {
  it('vergleicht in gleichbleibender Zeit und nur bei Übereinstimmung', () => {
    const token = 'ein-token';
    expect(tokenStimmt(token, tokenHash(token))).toBe(true);
    expect(tokenStimmt('anderes', tokenHash(token))).toBe(false);
    expect(tokenStimmt('', tokenHash(token))).toBe(false);
  });
});

describe('Kennungen', () => {
  it('sind der Hash des Fingerprints, nicht der Fingerprint', () => {
    const fp = 'D00C49315DD8C7973BFA283EACCAC682B9FC696E';
    const kennung = postfachKennung(fp);
    expect(kennung).not.toContain(fp);
    expect(kennung).not.toContain(fp.slice(0, 8));
    expect(istKennung(kennung)).toBe(true);
  });

  it('sind stabil und verschieden', () => {
    const a = postfachKennung('D00C49315DD8C7973BFA283EACCAC682B9FC696E');
    const b = postfachKennung('D00C49315DD8C7973BFA283EACCAC682B9FC696F');
    expect(a).toBe(postfachKennung('d00c49315dd8c7973bfa283eaccac682b9fc696e'));
    expect(a).not.toBe(b);
  });

  it('weisen alles zurück, was kein Fingerprint ist', () => {
    for (const murks of ['', 'kurz', 'G'.repeat(40)]) {
      expect(() => postfachKennung(murks)).toThrow(RangeError);
    }
  });
});

// ====================================================== DER wichtigste Test

describe('Der Server sieht nichts', () => {
  it('hat GENAU die Spalten, die im Plan stehen — und keine mehr', () => {
    // Wächst hier eine Spalte hinzu, ist das eine Entscheidung, die jemand
    // bewusst treffen und hier eintragen muss.
    const speicher = (app as unknown as { speicher: Speicher }).speicher;
    expect(speicher.spalten('messages')).toEqual(
      ['blob', 'created_at', 'expires_at', 'id', 'mailbox_id'].sort());
    expect(speicher.spalten('mailboxes')).toEqual(
      ['created_at', 'mailbox_id', 'token_hash'].sort());
  });

  it('die Datenbankdatei enthält keinen Klartext', async () => {
    const token = await richteEin();
    await sende();
    void token;

    const roh = readFileSync(dbPfad, 'latin1');
    // Der Marker aus dem Klartext darf nirgends auftauchen.
    expect(roh).not.toContain('GEHEIMER-KLARTEXT-MARKER');
    expect(roh).not.toContain('Grüße');
  });

  it('die Datenbankdatei enthält keinen öffentlichen Schlüssel', async () => {
    // ⚠️ Er erreicht den Server einmal bei der Einrichtung — gespeichert wird
    //    er NICHT. Nur der Hash eines Zufallstokens bleibt.
    await richteEin();
    const roh = readFileSync(dbPfad, 'latin1');
    expect(roh).not.toContain('BEGIN PGP PUBLIC KEY BLOCK');
    expect(roh).not.toContain('Relay Probe');
    expect(roh).not.toContain('probe@relay.invalid');
  });

  it('das Lesetoken steht nur als Hash in der Datei', async () => {
    const token = await richteEin();
    const roh = readFileSync(dbPfad, 'latin1');
    expect(roh).not.toContain(token);
    expect(roh).toContain(tokenHash(token));
  });

  it('speichert keinen Fingerprint', async () => {
    await richteEin();
    await sende();
    const fingerprint = schluessel.privat.getFingerprint().toUpperCase();
    const roh = readFileSync(dbPfad, 'latin1');
    expect(roh).not.toContain(fingerprint);
    expect(roh).not.toContain(fingerprint.toLowerCase());
  });

  it('räumt Abgelaufenes wirklich aus der Datei', async () => {
    const speicher = (app as unknown as { speicher: Speicher }).speicher;
    await richteEin();
    const besonders = await ciphertext('EINDEUTIGER-INHALT-ZUM-WIEDERFINDEN');
    await sende(besonders);

    const kennzeichen = besonders.slice(60, 120);
    expect(readFileSync(dbPfad, 'latin1')).toContain(kennzeichen);

    uhr += 8 * 86_400_000;
    expect(speicher.raeumeAuf(Math.floor(uhr / 1000))).toBe(1);

    // ⚠️ Ohne `secure_delete` bliebe der Ciphertext als Seitenrest stehen.
    expect(readFileSync(dbPfad, 'latin1')).not.toContain(kennzeichen);
  });
});
