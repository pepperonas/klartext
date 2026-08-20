/**
 * Vorstellungen — „Ich habe deine Einladung angenommen, hier ist mein Schlüssel."
 *
 * Der heikle Teil ist nicht das Format, sondern die Grenze: eine Vorstellung
 * darf NIE von selbst zum Kontakt werden. Das Postfach steht jedem offen, der
 * den öffentlichen Schlüssel hat — würde ein eingehender Schlüssel ungefragt
 * eingetragen, könnte jeder eine Kontaktliste mit frei gewählten Namen füllen,
 * und der Fingerprint-Abgleich wäre genau dort ausgehebelt, wo er zählt.
 */

import { describe, expect, it } from 'vitest';

import {
  VORSTELLUNG_MARKE, baueNutzlast, istVorstellung, lese,
} from '../src/worker/vorstellung.ts';
import { lies, meta } from './fixtures.ts';

const OEFFENTLICH = lies('ed25519.pub.asc');
const PRIVAT = lies('ed25519.sec.asc');
const FP = meta.ecc.fingerprint;

describe('Nutzlast', () => {
  it('trägt Marke, Namen und Schlüssel', () => {
    const roh = JSON.parse(baueNutzlast('Rosa', OEFFENTLICH)) as Record<string, unknown>;
    expect(roh['marke']).toBe(VORSTELLUNG_MARKE);
    expect(roh['name']).toBe('Rosa');
    expect(roh['schluessel']).toBe(OEFFENTLICH);
  });

  it('trägt eine Fassungsnummer', () => {
    // Ohne sie liesse sich das Format stillschweigend ändern.
    expect(VORSTELLUNG_MARKE).toMatch(/v\d+/);
  });

  it('wird als Vorstellung erkannt', () => {
    expect(istVorstellung(baueNutzlast('Rosa', OEFFENTLICH))).toBe(true);
  });

  it.each([
    ['gewöhnlicher Text', 'Treffen wir uns um acht?'],
    ['leer', ''],
    ['ein PGP-Block', '-----BEGIN PGP MESSAGE-----\nabc\n-----END PGP MESSAGE-----'],
  ])('hält %s NICHT für eine Vorstellung', (_name, text) => {
    expect(istVorstellung(text)).toBe(false);
  });
});

describe('Lesen', () => {
  it('liest Name und Schlüssel zurück', async () => {
    const v = await lese(baueNutzlast('Rosa', OEFFENTLICH), null);
    expect(v?.name).toBe('Rosa');
    expect(v?.armoredPublic).toContain('BEGIN PGP PUBLIC KEY BLOCK');
  });

  it('rechnet den Fingerprint aus dem SCHLÜSSEL', async () => {
    // ⚠️ Dieselbe Regel wie beim Einladungslink: ein mitgeschickter
    //    Fingerprint wäre eine zweite Wahrheit neben dem Schlüssel, und zwei
    //    Wahrheiten kann jemand auseinanderlaufen lassen.
    const gelogen = JSON.stringify({
      marke: VORSTELLUNG_MARKE, name: 'Rosa', schluessel: OEFFENTLICH,
      fingerprint: 'F'.repeat(40),
    });
    const v = await lese(gelogen, null);
    expect(v?.fingerprint).toBe(FP);
    expect(v?.fingerprint).not.toBe('F'.repeat(40));
  });

  it('nimmt bei fehlendem Namen die User-ID des Schlüssels', async () => {
    const ohneNamen = JSON.stringify({ marke: VORSTELLUNG_MARKE, schluessel: OEFFENTLICH });
    const v = await lese(ohneNamen, null);
    expect(v?.name.length).toBeGreaterThan(0);
    expect(v?.name).not.toBe('undefined');
  });

  it('kürzt einen masslos langen Namen', async () => {
    // Er wird angezeigt und kommt von aussen — ein 10-kB-„Name" zerlegt jede
    // Liste.
    const v = await lese(baueNutzlast('R'.repeat(5000), OEFFENTLICH), null);
    expect(v?.name.length).toBeLessThanOrEqual(120);
  });

  it('gibt null zurück für eine gewöhnliche Nachricht', async () => {
    // Der Normalfall — und ausdrücklich kein Fehler.
    expect(await lese('Treffen wir uns um acht?', null)).toBeNull();
  });

  it.each([
    ['kaputtes JSON', `{"marke":"${VORSTELLUNG_MARKE}",`],
    ['falsche Marke', JSON.stringify({ marke: 'etwas-anderes', schluessel: 'x' })],
    ['Marke ohne Schlüssel', JSON.stringify({ marke: VORSTELLUNG_MARKE, name: 'Rosa' })],
    ['leerer Schlüssel', JSON.stringify({ marke: VORSTELLUNG_MARKE, schluessel: '' })],
  ])('weist %s ab, statt etwas zu erfinden', async (_name, text) => {
    expect(await lese(text, null)).toBeNull();
  });

  it('wirft, wenn die Marke da ist, der Schlüssel aber unbrauchbar', async () => {
    // Unterschied zum Fall oben: hier BEHAUPTET die Nachricht, eine
    // Vorstellung zu sein. Sie stillschweigend als Text durchzureichen wäre
    // irreführend.
    const kaputt = JSON.stringify({ marke: VORSTELLUNG_MARKE, schluessel: 'kein Schlüssel' });
    await expect(lese(kaputt, null)).rejects.toThrow();
  });

  it('weist einen PRIVATEN Schlüssel ab', async () => {
    // ⚠️ Niemand hat einen Grund, seinen privaten Schlüssel zu verschicken.
    //    Ihn anzunehmen hiesse, fremdes Geheimnis zu speichern.
    const privat = JSON.stringify({ marke: VORSTELLUNG_MARKE, schluessel: PRIVAT });
    await expect(lese(privat, null)).rejects.toThrow();
  });
});

describe('Selbstsignierung — was sie beweist und was nicht', () => {
  it('erkennt eine Unterschrift mit genau dem enthaltenen Schlüssel', async () => {
    const v = await lese(baueNutzlast('Rosa', OEFFENTLICH), FP);
    expect(v?.selbstSigniert).toBe(true);
  });

  it('lässt sich von einer anderen Schreibweise nicht täuschen', async () => {
    const v = await lese(baueNutzlast('Rosa', OEFFENTLICH), FP.toLowerCase());
    expect(v?.selbstSigniert).toBe(true);
  });

  it('meldet false bei einer Unterschrift mit einem ANDEREN Schlüssel', async () => {
    const v = await lese(baueNutzlast('Rosa', OEFFENTLICH), meta.rsa.fingerprint);
    expect(v?.selbstSigniert).toBe(false);
  });

  it('meldet false ohne Unterschrift', async () => {
    const v = await lese(baueNutzlast('Rosa', OEFFENTLICH), null);
    expect(v?.selbstSigniert).toBe(false);
  });
});
