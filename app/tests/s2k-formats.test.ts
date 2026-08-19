/**
 * Pinnt den Kern-Kompromiss aus PLAN.md §3.2: zwei S2K-Profile, ein Schluessel.
 *
 * Diese Datei ist der Grund, warum die App ueberhaupt zwei Formate hat. Wenn
 * hier etwas rot wird, ist entweder der Vault schwaecher geworden oder der
 * Export nicht mehr GnuPG-lesbar — beides muss weh tun.
 */

import * as openpgp from 'openpgp';
import { describe, expect, it } from 'vitest';

import { EXPORT_CONFIG, VAULT_CONFIG } from '../src/worker/openpgp-config.ts';
import { erzeugeSchluessel, schuetzeFuerExport } from '../src/worker/keys.ts';

const NUTZER = { name: 'S2K Test', email: 's2k@klartext.invalid' };

/**
 * `s2k` und `aead` sind Laufzeitfelder des Secret-Key-Pakets — die
 * veroeffentlichten Typen von OpenPGP.js fuehren sie nicht. Sie werden hier
 * bewusst ueber eine enge Struktur gelesen.
 *
 * ⚠️ Massgeblich ist nicht dieser Test, sondern `gpg-interop.test.ts`: dort
 *    entscheidet echtes GnuPG darueber, ob ein Format lesbar ist. Diese Datei
 *    ist die schnelle Gegenprobe auf Unit-Ebene.
 */
interface SecretKeyLaufzeit {
  readonly s2k?: { readonly type?: string };
  readonly aead?: unknown;
  readonly version?: number;
}

function paket(key: { keyPacket: unknown }): SecretKeyLaufzeit {
  return key.keyPacket as SecretKeyLaufzeit;
}

describe('Vault-Format', () => {
  it('ist Argon2id mit AEAD', async () => {
    const { armoredSecret } = await erzeugeSchluessel('curve25519', NUTZER, 'vault-pw');
    const key = await openpgp.readPrivateKey({ armoredKey: armoredSecret });
    expect(paket(key).s2k?.type).toBe('argon2');
    expect(paket(key).aead).toBeTruthy();
    expect(key.isDecrypted()).toBe(false);
  });

  it('benutzt mindestens 64 MiB Speicher und 3 Durchgaenge', () => {
    // Die Zahlen selbst sind die Zusicherung: wer sie senkt, senkt den Schutz
    // gegen Offline-Rateangriffe und muss diesen Test bewusst anfassen.
    expect(VAULT_CONFIG.s2kArgon2Params).toEqual({ passes: 3, parallelism: 4, memoryExponent: 16 });
  });

  it('laesst sich nur mit der richtigen Passphrase oeffnen', async () => {
    const { armoredSecret } = await erzeugeSchluessel('curve25519', NUTZER, 'vault-pw');
    const key = await openpgp.readPrivateKey({ armoredKey: armoredSecret });
    await expect(openpgp.decryptKey({ privateKey: key, passphrase: 'falsch' })).rejects.toThrow();
    await expect(openpgp.decryptKey({ privateKey: key, passphrase: 'vault-pw' })).resolves.toBeDefined();
  });
});

describe('Export-Format', () => {
  it('ist iterated+salted OHNE AEAD — genau das, was GnuPG annimmt', async () => {
    const erzeugt = await erzeugeSchluessel('curve25519', NUTZER, 'vault-pw');
    const exportiert = await schuetzeFuerExport(erzeugt.privateKey, 'export-pw');
    const key = await openpgp.readPrivateKey({ armoredKey: exportiert });
    expect(paket(key).s2k?.type).toBe('iterated');
    expect(paket(key).aead).toBeFalsy();
  });

  it('nutzt den hoechsten Iterationszaehler', () => {
    expect(EXPORT_CONFIG.s2kIterationCountByte).toBe(255);
  });

  it('bleibt derselbe Schluessel — der Fingerprint aendert sich nicht', async () => {
    const erzeugt = await erzeugeSchluessel('curve25519', NUTZER, 'vault-pw');
    const exportiert = await schuetzeFuerExport(erzeugt.privateKey, 'export-pw');
    const key = await openpgp.readPrivateKey({ armoredKey: exportiert });
    expect(key.getFingerprint()).toBe(erzeugt.privateKey.getFingerprint());
  });
});

describe('Armor-Header', () => {
  it('verraet weder Bibliotheksversion noch Kommentar', async () => {
    const { armoredPublic, armoredSecret } = await erzeugeSchluessel('curve25519', NUTZER, 'pw');
    for (const armor of [armoredPublic, armoredSecret]) {
      expect(armor).not.toMatch(/^Version:/m);
      expect(armor).not.toMatch(/^Comment:/m);
      expect(armor).not.toMatch(/OpenPGP\.js/i);
    }
  });
});

describe('Schluesselerzeugung', () => {
  it('erzeugt v4-Schluessel — v6 koennte GnuPG 2.4 nicht lesen', async () => {
    const { privateKey } = await erzeugeSchluessel('curve25519', NUTZER, 'pw');
    expect(paket(privateKey).version).toBe(4);
  });

  it('legt ein Widerrufszertifikat gleich mit bei', async () => {
    const { revocationCertificate } = await erzeugeSchluessel('curve25519', NUTZER, 'pw');
    expect(revocationCertificate).toContain('BEGIN PGP PUBLIC KEY BLOCK');
  });

  it('erzeugt RSA-4096, wenn RSA verlangt wird', async () => {
    const { privateKey } = await erzeugeSchluessel('rsa4096', NUTZER, 'pw');
    expect(privateKey.getAlgorithmInfo().bits).toBe(4096);
  }, 180_000);
});
