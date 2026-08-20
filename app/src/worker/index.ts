/// <reference lib="webworker" />
/**
 * Worker-Einstieg: nimmt Nachrichten entgegen, verteilt, antwortet.
 *
 * Hier — und nur hier — wird `openpgp` importiert und liegt Schluesselmaterial.
 * Der Main-Thread bekommt Fingerprints, oeffentliche Schluessel, Ciphertext und
 * Klartext zur Anzeige; nie einen privaten Schluessel und nie die Passphrase.
 */

import { toWire } from '../crypto/errors.ts';
import type { AnyRequest, AnyResponse, Op, WorkerEvent } from '../crypto/protocol.ts';
import { Vault } from './vault.ts';
import {
  entschluessele,
  entschluessleDatei,
  erkenne,
  leseEmpfaenger,
  pruefe,
  signiere,
  verschluessele,
  verschluessleDatei,
} from './werkzeug.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function sende(nachricht: AnyResponse): void {
  ctx.postMessage(nachricht);
}

function melde(event: WorkerEvent): void {
  sende({ type: 'event', event });
}

const vault = new Vault(() => {
  void vault.status().then((status) => { melde({ kind: 'vault.changed', status }); });
});

const bereit: Promise<void> = vault.starte();

/**
 * Ein `switch` ueber alle Operationen. Der Rueckgabetyp ist bewusst `unknown`:
 * die Zuordnung op -> Ergebnis lebt im Vertrag (protocol.ts) und wird auf der
 * Client-Seite typisiert. Hier zaehlt, dass jeder Fall behandelt ist —
 * `noImplicitReturns` und der `never`-Zweig sorgen dafuer.
 */
async function fuehreAus(anfrage: AnyRequest): Promise<unknown> {
  switch (anfrage.op) {
    case 'vault.status':
      return await vault.status();
    case 'vault.unlock':
      return await vault.entsperre(anfrage.passphrase);
    case 'vault.lock':
      vault.sperre(anfrage.reason);
      return await vault.status();
    case 'vault.touch':
      vault.beruehre();
      return await vault.status();

    case 'settings.get':
      return await vault.einstellungen();
    case 'settings.set':
      return await vault.setzeEinstellungen(anfrage.settings);

    case 'keys.list':
      return await vault.liste();
    case 'keys.generate': {
      const { info, revocationCertificate } = await vault.erzeuge(
        anfrage.algorithm,
        anfrage.userId,
        anfrage.passphrase,
      );
      return { info, revocationCertificate };
    }
    case 'keys.import':
      return await vault.importiere(anfrage.armored, anfrage.passphrase);
    case 'keys.export':
      return await vault.exportiere(anfrage.fingerprint, anfrage.secret, anfrage.exportPassphrase);
    case 'keys.delete':
      return await vault.loesche(anfrage.fingerprint);
    case 'keys.setDefault':
      return await vault.setzeStandard(anfrage.fingerprint);
    case 'sicherung.erzeuge':
      return await vault.sicherungErzeuge(anfrage.fingerprint);
    case 'sicherung.spieleEin':
      return await vault.sicherungSpieleEin(anfrage.armored);
    case 'keys.beschrifte':
      return await vault.beschrifte(anfrage.fingerprint, anfrage.label);
    case 'keys.revocationCertificate':
      return { armored: await vault.widerrufszertifikat(anfrage.fingerprint) };
    case 'keys.applyRevocation':
      return await vault.wendeWiderrufAn(anfrage.armored);

    // ------------------------------------------------------------- Werkzeug

    case 'tool.erkenne':
      return await erkenne(anfrage.eingabe, await vault.oeffentliche());

    case 'tool.verschluessele': {
      const empfaenger = [
        ...(await vault.oeffentlicheZu(anfrage.anFingerprints)),
        ...(await leseEmpfaenger(anfrage.anArmored)),
      ];
      const signierer = anfrage.signiereMit === null ? null : vault.zumSignieren(anfrage.signiereMit);
      return { armored: await verschluessele(anfrage.klartext, empfaenger, signierer) };
    }

    case 'tool.entschluessele':
      return await entschluessele(
        anfrage.armored,
        vault.entsperrteSchluessel(),
        await vault.pruefSchluessel(anfrage.pruefeMit),
      );

    case 'tool.signiere':
      return {
        armored: await signiere(anfrage.text, vault.zumSignieren(anfrage.fingerprint), anfrage.abgetrennt),
      };

    case 'tool.pruefe':
      return await pruefe(anfrage.text, anfrage.signatur, await vault.pruefSchluessel(anfrage.schluessel));

    case 'datei.verschluessele': {
      const empfaenger = [
        ...(await vault.oeffentlicheZu(anfrage.anFingerprints)),
        ...(await leseEmpfaenger(anfrage.anArmored)),
      ];
      const signierer = anfrage.signiereMit === null ? null : vault.zumSignieren(anfrage.signiereMit);
      return await verschluessleDatei(anfrage.datei, empfaenger, signierer);
    }

    case 'datei.entschluessele':
      return await entschluessleDatei(
        anfrage.datei,
        vault.entsperrteSchluessel(),
        await vault.pruefSchluessel(anfrage.pruefeMit),
      );

    // ------------------------------------------------------------- Kontakte

    case 'kontakte.liste':
      return await vault.kontakte.liste();
    case 'kontakte.pruefe':
      return await vault.kontakte.pruefe(anfrage.armored, anfrage.binaer, anfrage.name);
    case 'kontakte.uebernimm':
      return await vault.kontakte.uebernimm(anfrage.armored, anfrage.binaer, anfrage.name);
    case 'kontakte.verifiziere':
      return await vault.kontakte.verifiziere(anfrage.fingerprint, anfrage.bestaetigt);
    case 'kontakte.umbenennen':
      return await vault.kontakte.umbenennen(anfrage.fingerprint, anfrage.name);
    case 'kontakte.loesche':
      return await vault.kontakte.loesche(anfrage.fingerprint);
    case 'kontakte.schluessel':
      return { armored: await vault.kontakte.armored(anfrage.fingerprint) };
    case 'keys.exportBinaer':
      return { daten: await vault.binaerOeffentlich(anfrage.fingerprint) };

    // ---------------------------------------------------- Relay + Verlauf

    case 'relay.signiere':
      return await vault.signiereFuerRelay(anfrage.fingerprint, anfrage.text);

    case 'verlauf.liste':
      return await vault.verlauf.liste(
        anfrage.kontaktFp, vault.entsperrteSchluessel(), await vault.pruefSchluessel([]));

    case 'verlauf.lege': {
      await vault.verlauf.lege(anfrage.eintrag);
      return await vault.verlauf.liste(
        anfrage.eintrag.kontaktFp, vault.entsperrteSchluessel(), await vault.pruefSchluessel([]));
    }

    case 'verlauf.loesche': {
      await vault.verlauf.loesche(anfrage.kontaktFp);
      return await vault.verlauf.liste(
        anfrage.kontaktFp, vault.entsperrteSchluessel(), await vault.pruefSchluessel([]));
    }

    case 'verlauf.zaehler':
      return await vault.verlauf.zaehler();

    default: {
      const unerreichbar: never = anfrage;
      throw new Error(`unbekannte Operation: ${JSON.stringify(unerreichbar)}`);
    }
  }
}

ctx.addEventListener('message', (event: MessageEvent<AnyRequest>) => {
  const anfrage = event.data;
  void (async () => {
    try {
      await bereit;
      const result = await fuehreAus(anfrage);
      sende({ type: 'reply', id: anfrage.id, ok: true, result });
    } catch (fehler) {
      // ⚠️ Nur Code und deutsche Meldung gehen ueber die Grenze. Der Originaltext
      // der Bibliothek bleibt hier — er verraet Paketstruktur und Algorithmen.
      sende({ type: 'reply', id: anfrage.id, ok: false, error: toWire(fehler) });
    }
  })();
});

void bereit.then(() => { sende({ type: 'ready' }); });

// Ein Typ-Anker: was hier fehlt, faellt beim Bauen auf.
export type BedienteOperationen = Op;
