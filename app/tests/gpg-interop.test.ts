/**
 * Die Tests, wegen derer Phase 1 existiert: was gpg erzeugt, muss klartext
 * lesen — und umgekehrt.
 *
 * Die Fixtures stammen aus echtem GnuPG (siehe fixtures/gpg/meta.json), nicht
 * aus OpenPGP.js. Ein Interop-Test gegen die eigene Bibliothek beweist nichts.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as openpgp from 'openpgp';
import { describe, expect, it } from 'vitest';

import { READ_CONFIG } from '../src/worker/openpgp-config.ts';
import {
  entpackeArmorBlock,
  erzeugeSchluessel,
  leseOeffentlich,
  leseUndEntsperre,
  normalisiereFingerprint,
  schuetzeFuerExport,
  schuetzeFuerVault,
} from '../src/worker/keys.ts';
import { KLARTEXT, lies, meta } from './fixtures.ts';

// ------------------------------------------------------------ gpg vorhanden?

function gpgVorhanden(): boolean {
  try {
    execFileSync('gpg', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAT_GPG = gpgVorhanden();
const GPG_ERZWUNGEN = process.env['KLARTEXT_GPG'] === '1';

// In CI wird KLARTEXT_GPG=1 gesetzt. Dann darf ein fehlendes gpg NICHT still
// zum Ueberspringen fuehren — sonst waere die Suite gruen-blind.
if (GPG_ERZWUNGEN && !HAT_GPG) {
  throw new Error('KLARTEXT_GPG=1 gesetzt, aber gpg fehlt. Interop-Tests wuerden still uebersprungen.');
}

/**
 * Fuehrt gpg in einem Wegwerf-Keyring aus. Fasst den echten Keyring nie an.
 *
 * ⚠️ gpg schreibt sein Ergebnis ("secret key imported", "Good signature") nach
 *    STDERR, nicht nach stdout — stdout traegt nur die Nutzdaten. Wer nur
 *    stdout prueft, bekommt einen leeren String und haelt jeden Erfolg fuer
 *    einen Fehlschlag. Deshalb spawnSync und beide Stroeme zusammen.
 */
interface GpgLauf {
  /** Nutzdaten (entschluesselter Text, Armor, …). */
  readonly stdout: string;
  /** Statusmeldungen ("secret key imported", "Good signature", Fehler). */
  readonly stderr: string;
}

function mitGpg<T>(fn: (g: (args: string[], eingabe?: string) => GpgLauf) => T): T {
  const home = mkdtempSync(join(tmpdir(), 'klartext-gpg-'));
  try {
    const g = (args: string[], eingabe?: string): GpgLauf => {
      const ergebnis = spawnSync('gpg', ['--batch', '--yes', '--pinentry-mode', 'loopback', ...args], {
        env: { ...process.env, GNUPGHOME: home },
        input: eingabe,
        encoding: 'utf8',
      });
      return { stdout: ergebnis.stdout, stderr: ergebnis.stderr };
    };
    return fn(g);
  } finally {
    try {
      execFileSync('gpgconf', ['--kill', 'gpg-agent'], { env: { ...process.env, GNUPGHOME: home }, stdio: 'ignore' });
    } catch { /* Agent lief nicht — egal */ }
    rmSync(home, { recursive: true, force: true });
  }
}

// ============================================================ gpg -> klartext

describe('gpg -> klartext', () => {
  it('liest den oeffentlichen RSA-4096-Schluessel mit dem richtigen Fingerprint', async () => {
    const key = await leseOeffentlich(lies('rsa4096.pub.asc'));
    expect(normalisiereFingerprint(key.getFingerprint())).toBe(meta.rsa.fingerprint);
    expect(key.getUserIDs()).toContain(meta.rsa.userId);
    expect(key.getAlgorithmInfo().bits).toBe(4096);
  });

  it('liest den oeffentlichen Ed25519-Schluessel', async () => {
    const key = await leseOeffentlich(lies('ed25519.pub.asc'));
    expect(normalisiereFingerprint(key.getFingerprint())).toBe(meta.ecc.fingerprint);
    expect(key.getAlgorithmInfo().algorithm).toMatch(/ed(dsa|25519)/i);
  });

  it('entsperrt den privaten RSA-Schluessel aus gpg (iterated+salted)', async () => {
    const key = await leseUndEntsperre(lies('rsa4096.sec.asc'), meta.passphrase);
    expect(key.isDecrypted()).toBe(true);
    expect(normalisiereFingerprint(key.getFingerprint())).toBe(meta.rsa.fingerprint);
  });

  it('entsperrt den privaten Ed25519-Schluessel aus gpg', async () => {
    const key = await leseUndEntsperre(lies('ed25519.sec.asc'), meta.passphrase);
    expect(key.isDecrypted()).toBe(true);
  });

  it('weist die falsche Passphrase mit unserem Code zurueck, nicht mit der Bibliotheksmeldung', async () => {
    await expect(leseUndEntsperre(lies('rsa4096.sec.asc'), 'falsch')).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
  });

  it('erkennt einen oeffentlichen Schluessel als solchen, wenn ein privater erwartet wird', async () => {
    await expect(leseUndEntsperre(lies('rsa4096.pub.asc'), meta.passphrase)).rejects.toMatchObject({
      code: 'NOT_A_SECRET_KEY',
    });
  });

  it.each([
    ['msg.rsa.enc.asc', 'rsa4096.sec.asc'],
    ['msg.ecc.enc.asc', 'ed25519.sec.asc'],
  ])('entschluesselt %s, das gpg verschluesselt hat', async (nachricht, schluessel) => {
    const key = await leseUndEntsperre(lies(schluessel), meta.passphrase);
    const message = await openpgp.readMessage({ armoredMessage: lies(nachricht) });
    const { data } = await openpgp.decrypt({ message, decryptionKeys: key, config: READ_CONFIG });
    expect(data).toBe(KLARTEXT);
  });

  it('entschluesselt und prueft eine von gpg signierte + verschluesselte Nachricht', async () => {
    const key = await leseUndEntsperre(lies('rsa4096.sec.asc'), meta.passphrase);
    const pub = await leseOeffentlich(lies('rsa4096.pub.asc'));
    const message = await openpgp.readMessage({ armoredMessage: lies('msg.rsa.signed-enc.asc') });
    const { data, signatures } = await openpgp.decrypt({
      message,
      decryptionKeys: key,
      verificationKeys: pub,
      config: READ_CONFIG,
    });
    expect(data).toBe(KLARTEXT);
    expect(signatures).toHaveLength(1);
    await expect(signatures[0]?.verified).resolves.toBe(true);
  });

  it('entschluesselt eine Nachricht an ZWEI Empfaenger mit jedem der beiden Schluessel', async () => {
    for (const datei of ['rsa4096.sec.asc', 'ed25519.sec.asc']) {
      const key = await leseUndEntsperre(lies(datei), meta.passphrase);
      const message = await openpgp.readMessage({ armoredMessage: lies('msg.both.enc.asc') });
      const { data } = await openpgp.decrypt({ message, decryptionKeys: key, config: READ_CONFIG });
      expect(data).toBe(KLARTEXT);
    }
  });

  it.each([
    ['sig.rsa.detached.asc', 'rsa4096.pub.asc'],
    ['sig.ecc.detached.asc', 'ed25519.pub.asc'],
  ])('prueft die abgetrennte Signatur %s', async (sigDatei, pubDatei) => {
    const pub = await leseOeffentlich(lies(pubDatei));
    const signature = await openpgp.readSignature({ armoredSignature: lies(sigDatei) });
    const message = await openpgp.createMessage({ text: KLARTEXT });
    const { signatures } = await openpgp.verify({
      message,
      signature,
      verificationKeys: pub,
      config: READ_CONFIG,
    });
    await expect(signatures[0]?.verified).resolves.toBe(true);
  });

  it('prueft eine Klartext-Signatur (clearsign)', async () => {
    const pub = await leseOeffentlich(lies('rsa4096.pub.asc'));
    const message = await openpgp.readCleartextMessage({ cleartextMessage: lies('sig.rsa.clear.asc') });
    const { signatures } = await openpgp.verify({ message, verificationKeys: pub, config: READ_CONFIG });
    await expect(signatures[0]?.verified).resolves.toBe(true);
  });

  it('erkennt eine verfaelschte Signatur als ungueltig', async () => {
    const pub = await leseOeffentlich(lies('rsa4096.pub.asc'));
    const signature = await openpgp.readSignature({ armoredSignature: lies('sig.rsa.detached.asc') });
    const message = await openpgp.createMessage({ text: `${KLARTEXT}manipuliert` });
    const { signatures } = await openpgp.verify({
      message,
      signature,
      verificationKeys: pub,
      config: READ_CONFIG,
    });
    await expect(signatures[0]?.verified).rejects.toThrow();
  });

  it('liest das von gpg erzeugte Widerrufszertifikat samt Vorspann und Schutz-Doppelpunkt', async () => {
    // gpg legt ein .rev mit erklaerendem Vorspann UND einem Doppelpunkt vor der
    // BEGIN-Zeile ab. Beides muss die App wegstecken, sonst scheitert der
    // Nutzer an einer Datei, die gpg voellig regelkonform erzeugt hat.
    const roh = lies('rsa4096.revoke.asc');
    expect(roh).toMatch(/^:-----BEGIN PGP PUBLIC KEY BLOCK-----$/m);
    expect(entpackeArmorBlock(roh)).toMatch(/^-----BEGIN PGP PUBLIC KEY BLOCK-----/);

    const pub = await leseOeffentlich(lies('rsa4096.pub.asc'));
    expect(await pub.isRevoked()).toBe(false);
    const { publicKey } = await openpgp.revokeKey({
      key: pub,
      revocationCertificate: entpackeArmorBlock(lies('rsa4096.revoke.asc')),
      format: 'object',
      config: READ_CONFIG,
    });
    expect(await publicKey.isRevoked()).toBe(true);
  });
});

// ============================================================ klartext -> gpg

describe.runIf(HAT_GPG)('klartext -> gpg', () => {
  it('gpg importiert einen hier erzeugten Ed25519-Schluessel im Export-Format', async () => {
    const erzeugt = await erzeugeSchluessel(
      'curve25519',
      { name: 'Export Test', email: 'export@test.invalid' },
      'vault-pw',
    );
    const exportiert = await schuetzeFuerExport(erzeugt.privateKey, 'export-pw');

    const ausgabe = mitGpg((g) => g(['--import'], exportiert).stderr);
    expect(ausgabe).toMatch(/secret key|geheime Schlüssel/i);

    // Gegenprobe: derselbe Schluessel im VAULT-Format wird von gpg abgelehnt.
    // Genau das ist der Grund fuer die zwei Formate (PLAN.md §3.2).
    const vaultFormat = await schuetzeFuerVault(erzeugt.privateKey, 'vault-pw');
    const vaultAusgabe = mitGpg((g) => g(['--import'], vaultFormat).stderr);
    expect(vaultAusgabe).not.toMatch(/secret key(s)? imported|geheime Schlüssel importiert/i);
  });

  it('gpg entschluesselt eine hier verschluesselte Nachricht', async () => {
    const geheim = 'Nachricht aus klartext an gpg. Umlaute: Grueezi, Aepfel.';
    const pub = await leseOeffentlich(lies('rsa4096.pub.asc'));
    const verschluesselt = await openpgp.encrypt({
      message: await openpgp.createMessage({ text: geheim }),
      encryptionKeys: pub,
      config: READ_CONFIG,
    });

    const entschluesselt = mitGpg((g) => {
      g(['--import'], lies('rsa4096.sec.asc'));
      return g(['--passphrase', meta.passphrase, '--decrypt'], verschluesselt).stdout;
    });
    expect(entschluesselt).toBe(geheim);
  });

  it('gpg prueft eine hier erzeugte abgetrennte Signatur', async () => {
    const text = 'Von klartext signiert.';
    const key = await leseUndEntsperre(lies('ed25519.sec.asc'), meta.passphrase);
    const signatur = await openpgp.sign({
      message: await openpgp.createMessage({ text }),
      signingKeys: key,
      detached: true,
      config: READ_CONFIG,
    });

    const ausgabe = mitGpg((g) => {
      g(['--import'], lies('ed25519.pub.asc'));
      const dir = mkdtempSync(join(tmpdir(), 'klartext-sig-'));
      const textDatei = join(dir, 'text.txt');
      const sigDatei = join(dir, 'text.sig');
      writeFileSync(textDatei, text);
      writeFileSync(sigDatei, signatur);
      try {
        return g(['--verify', sigDatei, textDatei]).stderr;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
    expect(ausgabe).toMatch(/Good signature|Korrekte Signatur/i);
  });
});
