/**
 * Die Werkzeug-Operationen: verschlüsseln, entschlüsseln, signieren, prüfen.
 *
 * Reine Funktionen über OpenPGP.js, ohne Worker- oder DOM-Bezug — damit sie in
 * Node gegen die echten gpg-Fixtures laufen können.
 */

import * as openpgp from 'openpgp';
import type { Key, PrivateKey, PublicKey, WebStream } from 'openpgp';

import { KlartextError, uebersetze } from '../crypto/errors.ts';
import type {
  DateiErgebnis,
  EntschluesseltesErgebnis,
  Erkennung,
  SignaturBefund,
} from '../crypto/protocol.ts';
import { entpackeArmorBlock, normalisiereFingerprint } from './keys.ts';
import { READ_CONFIG } from './openpgp-config.ts';

// ------------------------------------------------------------------ Erkennen

const KOEPFE: readonly (readonly [RegExp, Erkennung['art'], string])[] = [
  [/-----BEGIN PGP SIGNED MESSAGE-----/, 'signierter-text',
    'Ein Text mit angehängter Signatur. klartext kann prüfen, ob sie stimmt.'],
  [/-----BEGIN PGP MESSAGE-----/, 'nachricht',
    'Eine verschlüsselte Nachricht.'],
  [/-----BEGIN PGP SIGNATURE-----/, 'signatur',
    'Eine abgetrennte Signatur. Sie gehört zu einem Text oder einer Datei, die du zusätzlich brauchst.'],
  [/-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'oeffentlicher-key',
    'Ein öffentlicher Schlüssel. Damit kannst du an jemanden verschlüsseln oder dessen Signaturen prüfen.'],
  [/-----BEGIN PGP PRIVATE KEY BLOCK-----/, 'privater-key',
    'Ein privater Schlüssel. Der gehört in deinen Schlüsselbund — und sonst nirgendwohin.'],
];

/**
 * Erkennt, was in einem eingefügten Block steckt.
 *
 * Damit muss die Oberfläche nicht raten und der Nutzer nicht vorher wissen,
 * welchen Knopf er drücken will: er fügt etwas ein, und die App sagt, was es
 * ist und was sich damit tun lässt.
 */
export async function erkenne(eingabe: string, eigene: readonly PublicKey[]): Promise<Erkennung> {
  const block = entpackeArmorBlock(eingabe);
  const leer: Erkennung = {
    art: 'klartext',
    beschreibung: 'Gewöhnlicher Text. Du kannst ihn verschlüsseln oder signieren.',
    fingerprint: null, userIds: [], empfaenger: [], fuerUns: false,
  };
  if (eingabe.trim().length === 0) {
    return { ...leer, beschreibung: 'Noch nichts eingegeben.' };
  }

  const treffer = KOEPFE.find(([muster]) => muster.test(block));
  if (treffer === undefined) return leer;
  const [, art, beschreibung] = treffer;

  if (art === 'oeffentlicher-key' || art === 'privater-key') {
    try {
      const key = await openpgp.readKey({ armoredKey: block, config: READ_CONFIG });
      return {
        art, beschreibung,
        fingerprint: normalisiereFingerprint(key.getFingerprint()),
        userIds: key.getUserIDs(), empfaenger: [], fuerUns: false,
      };
    } catch {
      return { ...leer, art, beschreibung: `${beschreibung} (Er lässt sich allerdings nicht lesen — beschädigt?)` };
    }
  }

  if (art === 'nachricht') {
    try {
      const nachricht = await openpgp.readMessage({ armoredMessage: block, config: READ_CONFIG });
      const empfaenger = nachricht.getEncryptionKeyIDs().map((k) => k.toHex().toUpperCase());
      const meine = new Set(eigene.flatMap((k) => k.getKeyIDs().map((id) => id.toHex().toUpperCase())));
      const fuerUns = empfaenger.some((id) => meine.has(id));
      return {
        art,
        beschreibung: fuerUns
          ? 'Eine verschlüsselte Nachricht an dich.'
          : empfaenger.length === 0
            ? 'Eine verschlüsselte Nachricht — vermutlich mit einem Passwort statt einem Schlüssel.'
            : 'Eine verschlüsselte Nachricht, aber nicht an einen deiner Schlüssel.',
        fingerprint: null, userIds: [], empfaenger, fuerUns,
      };
    } catch {
      return { ...leer, art, beschreibung: 'Sieht aus wie eine Nachricht, lässt sich aber nicht lesen — beschädigt?' };
    }
  }

  return { ...leer, art, beschreibung };
}

// ------------------------------------------------------------ Verschlüsseln

export async function leseEmpfaenger(armoredListe: readonly string[]): Promise<PublicKey[]> {
  const keys: PublicKey[] = [];
  for (const armored of armoredListe) {
    try {
      keys.push(await openpgp.readKey({ armoredKey: entpackeArmorBlock(armored), config: READ_CONFIG }));
    } catch (fehler) {
      throw uebersetze(fehler, 'NOT_A_KEY');
    }
  }
  return keys;
}

export async function verschluessele(
  klartext: string,
  empfaenger: readonly PublicKey[],
  signiereMit: PrivateKey | null,
): Promise<string> {
  if (empfaenger.length === 0) throw new KlartextError('NO_MATCHING_KEY');
  try {
    const ergebnis = await openpgp.encrypt({
      message: await openpgp.createMessage({ text: klartext }),
      encryptionKeys: [...empfaenger],
      ...(signiereMit === null ? {} : { signingKeys: signiereMit }),
      config: READ_CONFIG,
    });
    return ergebnis;
  } catch (fehler) {
    throw uebersetze(fehler);
  }
}

// ---------------------------------------------------------- Entschlüsseln

/**
 * Wertet die Signaturen aus.
 *
 * ⚠️ `signature.verified` ist ein Promise, das WIRFT, wenn die Signatur nicht
 *    stimmt — es liefert nicht `false`. Wer nur auf den Wert schaut, hält jede
 *    kaputte Signatur für gültig, sobald er den Fehler verschluckt.
 *
 * Drei Fälle werden unterschieden, weil sie drei verschiedene Dinge bedeuten:
 * gültig · ungültig (jemand hat manipuliert) · unbekannter Schlüssel (wir
 * können es schlicht nicht beurteilen). Das dritte als „ungültig" darzustellen
 * wäre eine Falschaussage.
 */
async function werteSignaturen(
  signaturen: readonly {
    keyID: { toHex: () => string };
    verified: Promise<boolean>;
    signature: Promise<{ packets: readonly { created?: Date | null }[] }>;
  }[],
  bekannte: readonly Key[],
): Promise<SignaturBefund[]> {
  const befunde: SignaturBefund[] = [];

  for (const s of signaturen) {
    const keyId = s.keyID.toHex().toUpperCase();
    const passend = bekannte.find((k) =>
      k.getKeyIDs().some((id) => id.toHex().toUpperCase() === keyId));

    let zeitpunkt: string | null = null;
    try {
      const paket = (await s.signature).packets[0];
      zeitpunkt = paket?.created instanceof Date ? paket.created.toISOString() : null;
    } catch { /* Zeitstempel ist Beiwerk */ }

    if (passend === undefined) {
      befunde.push({ keyId, zustand: 'unbekannter-schluessel', wer: null, fingerprint: null, zeitpunkt });
      continue;
    }

    let zustand: SignaturBefund['zustand'];
    try {
      zustand = (await s.verified) ? 'gueltig' : 'ungueltig';
    } catch {
      zustand = 'ungueltig';
    }
    befunde.push({
      keyId, zustand,
      wer: passend.getUserIDs()[0] ?? null,
      fingerprint: normalisiereFingerprint(passend.getFingerprint()),
      zeitpunkt,
    });
  }
  return befunde;
}

export async function entschluessele(
  armored: string,
  meine: readonly PrivateKey[],
  pruefeMit: readonly Key[],
): Promise<EntschluesseltesErgebnis> {
  const block = entpackeArmorBlock(armored);
  let nachricht;
  try {
    nachricht = await openpgp.readMessage({ armoredMessage: block, config: READ_CONFIG });
  } catch (fehler) {
    throw uebersetze(fehler, 'NOT_A_MESSAGE');
  }
  if (meine.length === 0) throw new KlartextError('VAULT_EMPTY');

  try {
    const ergebnis = await openpgp.decrypt({
      message: nachricht,
      decryptionKeys: [...meine],
      // exactOptionalPropertyTypes: `verificationKeys: undefined` ist kein
      // gültiges Argument — die Eigenschaft muss ganz fehlen.
      ...(pruefeMit.length > 0 ? { verificationKeys: [...pruefeMit] } : {}),
      config: READ_CONFIG,
    });
    return {
      klartext: ergebnis.data,
      signaturen: await werteSignaturen(ergebnis.signatures, pruefeMit),
      // ⚠️ `filename` ist NICHT immer eine Zeichenkette: bei Nachrichten ohne
      //    Literal-Dateinamen — also bei allem, was klartext selbst erzeugt —
      //    kommt null. Ein `.length` darauf lässt jede eigene Nachricht beim
      //    Entschlüsseln platzen. Vom Rundlauf-Test gefunden.
      dateiname: typeof ergebnis.filename === 'string' && ergebnis.filename.length > 0
        ? ergebnis.filename
        : null,
    };
  } catch (fehler) {
    throw uebersetze(fehler, 'DECRYPT_FAILED');
  }
}

// ------------------------------------------------------- Signieren / Prüfen

export async function signiere(text: string, key: PrivateKey, abgetrennt: boolean): Promise<string> {
  try {
    const nachricht = await openpgp.createMessage({ text });
    if (abgetrennt) {
      return await openpgp.sign({ message: nachricht, signingKeys: key, detached: true, config: READ_CONFIG });
    }
    // Klartext-Signatur: der Text bleibt lesbar, die Signatur hängt darunter.
    return await openpgp.sign({
      message: await openpgp.createCleartextMessage({ text }),
      signingKeys: key,
      config: READ_CONFIG,
    });
  } catch (fehler) {
    throw uebersetze(fehler);
  }
}

export async function pruefe(
  text: string,
  signatur: string | null,
  schluessel: readonly Key[],
): Promise<{ signaturen: SignaturBefund[]; klartext: string | null }> {
  try {
    if (signatur === null) {
      // Klartext-Signatur: Text und Signatur stecken im selben Block.
      const nachricht = await openpgp.readCleartextMessage({
        cleartextMessage: entpackeArmorBlock(text), config: READ_CONFIG,
      });
      const ergebnis = await openpgp.verify({
        message: nachricht, verificationKeys: [...schluessel], config: READ_CONFIG,
      });
      return {
        signaturen: await werteSignaturen(ergebnis.signatures, schluessel),
        klartext: nachricht.getText(),
      };
    }

    const sig = await openpgp.readSignature({
      armoredSignature: entpackeArmorBlock(signatur), config: READ_CONFIG,
    });
    const ergebnis = await openpgp.verify({
      message: await openpgp.createMessage({ text }),
      signature: sig,
      verificationKeys: [...schluessel],
      config: READ_CONFIG,
    });
    return { signaturen: await werteSignaturen(ergebnis.signatures, schluessel), klartext: null };
  } catch (fehler) {
    throw uebersetze(fehler, 'NOT_A_SIGNATURE');
  }
}

// -------------------------------------------------------------------- Dateien

/** Über dieser Größe warnt die Oberfläche vor dem Speicherbedarf. */
export const GROSSE_DATEI = 100 * 1024 * 1024;

/**
 * ⚠️ openpgp bringt eigene Stream-Typen mit (`@openpgp/web-stream-tools`).
 *    Strukturell sind es dieselben ReadableStreams; die aktuelle DOM-Bibliothek
 *    führt nur zusätzlich `Symbol.asyncDispose`. Hineingeben lässt sich der
 *    DOM-Stream unverändert; nur beim HERAUSLESEN braucht es eine Umtypung —
 *    an genau dieser einen Stelle und nirgends sonst.
 */
async function sammle(strom: WebStream<Uint8Array>): Promise<Uint8Array> {
  const teile: Uint8Array[] = [];
  let laenge = 0;
  const leser = (strom as unknown as ReadableStream<Uint8Array>).getReader();
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    teile.push(value);
    laenge += value.length;
  }
  const raus = new Uint8Array(laenge);
  let versatz = 0;
  for (const t of teile) { raus.set(t, versatz); versatz += t.length; }
  return raus;
}

export async function verschluessleDatei(
  datei: File,
  empfaenger: readonly PublicKey[],
  signiereMit: PrivateKey | null,
): Promise<{ daten: Uint8Array; dateiname: string }> {
  if (empfaenger.length === 0) throw new KlartextError('NO_MATCHING_KEY');
  try {
    const nachricht = await openpgp.createMessage({
      binary: datei.stream(),
      filename: datei.name,
    });
    const strom = await openpgp.encrypt({
      message: nachricht,
      encryptionKeys: [...empfaenger],
      ...(signiereMit === null ? {} : { signingKeys: signiereMit }),
      format: 'binary',
      config: READ_CONFIG,
    });
    return { daten: await sammle(strom), dateiname: `${datei.name}.gpg` };
  } catch (fehler) {
    throw uebersetze(fehler);
  }
}

export async function entschluessleDatei(
  datei: File,
  meine: readonly PrivateKey[],
  pruefeMit: readonly Key[],
): Promise<DateiErgebnis> {
  if (meine.length === 0) throw new KlartextError('VAULT_EMPTY');
  try {
    const roh = new Uint8Array(await datei.arrayBuffer());
    // Sowohl .gpg (binär) als auch .asc (armored) sollen funktionieren. Die
    // beiden Wege bleiben getrennt, weil eine Union aus Message<string> und
    // Message<Uint8Array> keine der Überladungen von decrypt() trifft.
    const anfang = new TextDecoder().decode(roh.subarray(0, 200));
    const gemeinsam = {
      decryptionKeys: [...meine],
      ...(pruefeMit.length > 0 ? { verificationKeys: [...pruefeMit] } : {}),
      format: 'binary' as const,
      config: READ_CONFIG,
    };
    const ergebnis = anfang.includes('-----BEGIN PGP')
      ? await openpgp.decrypt({
          message: await openpgp.readMessage({
            armoredMessage: new TextDecoder().decode(roh), config: READ_CONFIG,
          }),
          ...gemeinsam,
        })
      : await openpgp.decrypt({
          message: await openpgp.readMessage({ binaryMessage: roh, config: READ_CONFIG }),
          ...gemeinsam,
        });

    const name = typeof ergebnis.filename === 'string' && ergebnis.filename.length > 0
      ? ergebnis.filename
      : datei.name.replace(/\.(gpg|pgp|asc)$/i, '') || 'entschluesselt';

    return {
      daten: ergebnis.data,
      dateiname: name,
      signaturen: await werteSignaturen(ergebnis.signatures, pruefeMit),
    };
  } catch (fehler) {
    throw uebersetze(fehler, 'DECRYPT_FAILED');
  }
}
