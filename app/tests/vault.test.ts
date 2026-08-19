import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DB_NAME } from '../src/worker/idb.ts';
import { Vault } from '../src/worker/vault.ts';
import { lies, meta } from './fixtures.ts';

const NUTZER = { name: 'Testerin', email: 'test@klartext.invalid' };
const PW = 'eine-sehr-lange-vault-passphrase';

async function frischerVault(): Promise<{ vault: Vault; aenderungen: () => number }> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => { resolve(); };
    req.onerror = () => { reject(req.error ?? new Error('delete fehlgeschlagen')); };
    req.onblocked = () => { resolve(); };
  });
  let zaehler = 0;
  const vault = new Vault(() => { zaehler += 1; });
  await vault.starte();
  return { vault, aenderungen: () => zaehler };
}

let vault: Vault;
let aenderungen: () => number;

async function ersterFingerprint(): Promise<string> {
  const [key] = await vault.liste();
  if (key === undefined) throw new Error('Testaufbau: kein Schluessel im Vault');
  return key.fingerprint;
}

beforeEach(async () => {
  ({ vault, aenderungen } = await frischerVault());
});

// ⚠️ Ohne das Schliessen haelt jeder Vault seine IndexedDB-Verbindung offen und
//    das deleteDatabase() des naechsten Tests laeuft in onblocked — die Suite
//    haengt dann ohne Fehlermeldung.
afterEach(() => {
  vault.schliesse();
});

describe('Zustand', () => {
  it('ist leer, solange kein Schluessel da ist', async () => {
    const status = await vault.status();
    expect(status.state).toBe('empty');
    expect(status.keyCount).toBe(0);
    expect(status.lockAt).toBeNull();
  });

  it('der erste Schluessel legt die Passphrase fest und oeffnet den Vault', async () => {
    const { info } = await vault.erzeuge('curve25519', NUTZER, PW);
    expect(info.isDefault).toBe(true);
    expect(info.fingerprint).toMatch(/^[0-9A-F]{40}$/);

    const status = await vault.status();
    expect(status.state).toBe('unlocked');
    expect(status.keyCount).toBe(1);
    expect(status.lockAt).toBeGreaterThan(Date.now());
  });

  it('ohne Passphrase gibt es keinen ersten Schluessel', async () => {
    await expect(vault.erzeuge('curve25519', NUTZER, null)).rejects.toMatchObject({
      code: 'PASSPHRASE_REQUIRED',
    });
    await expect(vault.erzeuge('curve25519', NUTZER, '')).rejects.toMatchObject({
      code: 'PASSPHRASE_REQUIRED',
    });
  });

  it('sperrt und entsperrt', async () => {
    await vault.erzeuge('curve25519', NUTZER, PW);
    vault.sperre('manual');

    const gesperrt = await vault.status();
    expect(gesperrt.state).toBe('locked');
    expect(gesperrt.lockAt).toBeNull();
    expect(gesperrt.lastLockReason).toBe('manual');

    const offen = await vault.entsperre(PW);
    expect(offen.state).toBe('unlocked');
    expect(offen.lastLockReason).toBeNull();
  });

  it('weist die falsche Passphrase zurueck und bleibt gesperrt', async () => {
    await vault.erzeuge('curve25519', NUTZER, PW);
    vault.sperre('manual');
    await expect(vault.entsperre('falsch')).rejects.toMatchObject({ code: 'WRONG_PASSPHRASE' });
    expect((await vault.status()).state).toBe('locked');
  });

  it('meldet jede Zustandsaenderung nach draussen', async () => {
    const vorher = aenderungen();
    await vault.erzeuge('curve25519', NUTZER, PW);
    vault.sperre('manual');
    expect(aenderungen()).toBeGreaterThan(vorher + 1);
  });
});

describe('gesperrter Vault verweigert die Arbeit', () => {
  beforeEach(async () => {
    await vault.erzeuge('curve25519', NUTZER, PW);
    vault.sperre('manual');
  });

  it('kein Export des privaten Schluessels', async () => {
    const fingerprint = await ersterFingerprint();
    await expect(vault.exportiere(fingerprint, true, 'export-pw')).rejects.toMatchObject({
      code: 'VAULT_LOCKED',
    });
  });

  it('kein zweiter Schluessel', async () => {
    await expect(vault.erzeuge('curve25519', NUTZER, PW)).rejects.toMatchObject({
      code: 'VAULT_LOCKED',
    });
  });

  it('kein Import', async () => {
    await expect(vault.importiere(lies('ed25519.sec.asc'), meta.passphrase)).rejects.toMatchObject({
      code: 'VAULT_LOCKED',
    });
  });

  it('kein Widerrufszertifikat', async () => {
    const fingerprint = await ersterFingerprint();
    await expect(vault.widerrufszertifikat(fingerprint)).rejects.toMatchObject({
      code: 'VAULT_LOCKED',
    });
  });

  it('der oeffentliche Schluessel bleibt trotzdem lesbar — er ist nicht geheim', async () => {
    const ergebnis = await vault.exportiere(await ersterFingerprint(), false, null);
    expect(ergebnis.armored).toContain('BEGIN PGP PUBLIC KEY BLOCK');
  });
});

describe('Import aus gpg', () => {
  beforeEach(async () => {
    await vault.erzeuge('curve25519', NUTZER, PW);
  });

  it('uebernimmt einen gpg-Schluessel und schuetzt ihn danach mit der Vault-Passphrase', async () => {
    const info = await vault.importiere(lies('ed25519.sec.asc'), meta.passphrase);
    expect(info.fingerprint).toBe(meta.ecc.fingerprint);
    expect((await vault.status()).keyCount).toBe(2);

    // Entscheidend: nach dem Import gilt die VAULT-Passphrase, nicht mehr die
    // des Herkunftsschluessels. Sonst waere der Sperr-Indikator eine Halbwahrheit.
    vault.sperre('manual');
    await expect(vault.entsperre(meta.passphrase)).rejects.toMatchObject({ code: 'WRONG_PASSPHRASE' });
    await expect(vault.entsperre(PW)).resolves.toMatchObject({ state: 'unlocked' });
  });

  it('lehnt denselben Schluessel ein zweites Mal ab', async () => {
    await vault.importiere(lies('ed25519.sec.asc'), meta.passphrase);
    await expect(vault.importiere(lies('ed25519.sec.asc'), meta.passphrase)).rejects.toMatchObject({
      code: 'KEY_EXISTS',
    });
  });

  it('verlangt die Passphrase des Herkunftsschluessels', async () => {
    await expect(vault.importiere(lies('ed25519.sec.asc'), null)).rejects.toMatchObject({
      code: 'PASSPHRASE_REQUIRED',
    });
  });
});

describe('Verwaltung', () => {
  it('der Standardschluessel rueckt nach, wenn der bisherige geloescht wird', async () => {
    const { info: erster } = await vault.erzeuge('curve25519', NUTZER, PW);
    const { info: zweiter } = await vault.erzeuge('curve25519', { ...NUTZER, email: 'zwei@x.invalid' }, null);
    expect(erster.isDefault).toBe(true);
    expect(zweiter.isDefault).toBe(false);

    const rest = await vault.loesche(erster.fingerprint);
    expect(rest).toHaveLength(1);
    expect(rest[0]?.isDefault).toBe(true);
  });

  it('der letzte geloeschte Schluessel sperrt den Vault', async () => {
    const { info } = await vault.erzeuge('curve25519', NUTZER, PW);
    await vault.loesche(info.fingerprint);
    expect((await vault.status()).state).toBe('empty');
  });

  it('setzt den Standardschluessel um', async () => {
    await vault.erzeuge('curve25519', NUTZER, PW);
    const { info: zweiter } = await vault.erzeuge('curve25519', { ...NUTZER, email: 'zwei@x.invalid' }, null);
    const liste = await vault.setzeStandard(zweiter.fingerprint);
    expect(liste.filter((k) => k.isDefault)).toHaveLength(1);
    expect(liste.find((k) => k.isDefault)?.fingerprint).toBe(zweiter.fingerprint);
  });

  it('erzeugt ein Widerrufszertifikat und wendet es an', async () => {
    const { info } = await vault.erzeuge('curve25519', NUTZER, PW);
    const zertifikat = await vault.widerrufszertifikat(info.fingerprint);
    expect(zertifikat).toContain('BEGIN PGP PUBLIC KEY BLOCK');

    const widerrufen = await vault.wendeWiderrufAn(zertifikat);
    expect(widerrufen.fingerprint).toBe(info.fingerprint);
    expect(widerrufen.isRevoked).toBe(true);

    // und der Zustand ueberlebt einen Neustart des Vaults
    const nachher = await vault.liste();
    expect(nachher[0]?.isRevoked).toBe(true);
  });
});

describe('Einstellungen', () => {
  it('haelt Werte fest und stellt den Auto-Lock nach', async () => {
    await vault.erzeuge('curve25519', NUTZER, PW);
    const gesetzt = await vault.setzeEinstellungen({ autoLockMinutes: 1 });
    expect(gesetzt.autoLockMinutes).toBe(1);

    const status = await vault.status();
    expect(status.lockAt).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it('autoLockMinutes 0 heisst: nie automatisch sperren', async () => {
    await vault.erzeuge('curve25519', NUTZER, PW);
    await vault.setzeEinstellungen({ autoLockMinutes: 0 });
    expect((await vault.status()).lockAt).toBeNull();
  });

  it('sperrt nach Ablauf der Leerlauffrist wirklich', async () => {
    // ⚠️ NUR setTimeout/clearTimeout faelschen. Ein pauschales useFakeTimers()
    //    legt fake-indexeddb still: dessen Transaktionsschleife braucht echte
    //    Timer, jede DB-Operation wartet dann fuer immer.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await vault.erzeuge('curve25519', NUTZER, PW);
      await vault.setzeEinstellungen({ autoLockMinutes: 15 });
      expect((await vault.status()).state).toBe('unlocked');
      vi.advanceTimersByTime(15 * 60_000 + 1000);
      expect((await vault.status()).state).toBe('locked');
      expect((await vault.status()).lastLockReason).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });
});
