/**
 * Postfach-Kennungen — der Vertrag zwischen App und Relay.
 *
 * Die Ableitung steht ZWEIMAL im Repo: einmal in `app/src/relay/kennung.ts`
 * (Web-Crypto, läuft im Browser) und einmal in `relay/src/postfach.ts`
 * (node:crypto, läuft auf dem Server). Beide müssen Zeichen für Zeichen
 * dasselbe ergeben.
 *
 * ⚠️ Weichen sie ab, gibt es **keine Fehlermeldung**: der Absender legt seinen
 *    Ciphertext in ein Postfach, das der Empfänger nie abfragt. Die App meldet
 *    „zugestellt", der Empfänger wartet für immer. Genau diese Sorte Fehler
 *    findet man nicht im Betrieb, sondern nur mit einem Test, der beide Seiten
 *    gegeneinander rechnet — und den gab es bisher nicht: die Relay-Seite war
 *    für sich geprüft, die App-Seite gar nicht, der Vertrag zwischen ihnen
 *    nirgends.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  AUTH_PRAEFIX,
  KENNUNG_PRAEFIX,
  herausforderungsText,
  postfachKennung,
} from '../src/relay/kennung.ts';
// ⚠️ Die ECHTE Relay-Umsetzung, nicht eine nachgebaute. Mein erster Anlauf
//    rechnete die „Relay-Seite" mit dem aus dem APP-Modul importierten Präfix
//    nach — beide Seiten bewegten sich damit gemeinsam, und die Mutationsprobe
//    (Präfix in der App auf v2 geändert) liess die Rechen-Tests folgerichtig
//    grün. Ein Vertrag zwischen zwei Seiten lässt sich nur prüfen, wenn beide
//    Seiten wirklich beide Seiten sind.
import {
  AUTH_PRAEFIX as RELAY_AUTH_PRAEFIX,
  KENNUNG_PRAEFIX as RELAY_KENNUNG_PRAEFIX,
  herausforderungsText as relayHerausforderungsText,
  postfachKennung as relayKennung,
} from '../../relay/src/postfach.ts';

/** Die Ableitung des Relays — die echte Funktion, aus dessen Quelltext. */
const relaySeite = relayKennung;

const FP = 'C669A5B0078E577AF1F2D6BB91D5C9D319201E38';

describe('App und Relay leiten identisch ab', () => {
  it('ergibt für denselben Fingerprint dieselbe Kennung', async () => {
    expect(await postfachKennung(FP)).toBe(relaySeite(FP));
  });

  it('stimmt über viele verschiedene Fingerprints überein', async () => {
    // Ein einzelner Vergleich könnte zufällig passen (etwa wenn beide Seiten
    // denselben Fehler machen); über eine Reihe wird das unwahrscheinlich.
    for (let i = 0; i < 64; i++) {
      const fp = createHash('sha1').update(`probe-${String(i)}`).digest('hex').toUpperCase();
      expect(await postfachKennung(fp), fp).toBe(relaySeite(fp));
    }
  });

  it('benutzt auf beiden Seiten denselben Präfix', () => {
    expect(KENNUNG_PRAEFIX).toBe(RELAY_KENNUNG_PRAEFIX);
    expect(AUTH_PRAEFIX).toBe(RELAY_AUTH_PRAEFIX);
  });

  it('der Herausforderungstext ist auf beiden Seiten derselbe', () => {
    // Er wird SIGNIERT. Weicht er ab, prüft der Server eine Unterschrift über
    // einen anderen Text und weist jeden ehrlichen Besitznachweis zurück.
    for (const [k, n] of [['KENNUNG', 'NONCE'], ['a-b_c', '0123'], ['', '']]) {
      expect(herausforderungsText(k ?? '', n ?? ''))
        .toBe(relayHerausforderungsText(k ?? '', n ?? ''));
    }
    expect(herausforderungsText('K', 'N')).toBe(`${AUTH_PRAEFIX}K:N`);
  });

  it('trägt eine Fassungsnummer, damit ein Wechsel auffällt', () => {
    // Ohne „v1" liesse sich die Ableitung stillschweigend ändern und alte
    // Postfächer würden unauffindbar.
    expect(KENNUNG_PRAEFIX).toMatch(/v\d+/);
    expect(AUTH_PRAEFIX).toMatch(/v\d+/);
  });
});

describe('Form der Kennung', () => {
  it('ist base64url, 43 Zeichen, ohne Polsterung', async () => {
    const k = await postfachKennung(FP);
    expect(k).toHaveLength(43);
    expect(k).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(k).not.toContain('=');
  });

  it('verrät den Fingerprint nicht', async () => {
    // ⚠️ Wer die Kennung sieht, darf daraus nicht auf den Schlüssel schliessen
    //    können. Umgekehrt geht es sehr wohl — das steht so im Threat-Model.
    const k = await postfachKennung(FP);
    expect(k).not.toContain(FP);
    expect(k.toUpperCase()).not.toContain(FP.slice(0, 16));
  });

  it('ist über Aufrufe hinweg stabil', async () => {
    const a = await postfachKennung(FP);
    const b = await postfachKennung(FP);
    expect(a).toBe(b);
  });

  it('unterscheidet sich schon bei einem einzigen Bit Unterschied', async () => {
    const nachbar = `${FP.slice(0, 39)}9`;
    expect(await postfachKennung(nachbar)).not.toBe(await postfachKennung(FP));
  });
});

describe('Normalisierung', () => {
  it.each([
    ['gruppiert, wie gpg ihn zeigt', 'C669 A5B0 078E 577A F1F2  D6BB 91D5 C9D3 1920 1E38'],
    ['kleingeschrieben', 'c669a5b0078e577af1f2d6bb91d5c9d319201e38'],
    ['mit Zeilenumbruch', 'C669A5B0078E577AF1F2\nD6BB91D5C9D319201E38'],
    ['mit Tabulator', 'C669A5B0078E577AF1F2\tD6BB91D5C9D319201E38'],
  ])('behandelt %s wie die reine Form', async (_name, eingabe) => {
    // Menschen kopieren Fingerprints aus gpg-Ausgaben, mit Leerraum und in
    // beliebiger Schreibung. Landete das ungefiltert im Hash, entstünde je
    // Schreibweise ein anderes Postfach.
    expect(await postfachKennung(eingabe)).toBe(await postfachKennung(FP));
  });
});

describe('Was keine Kennung ergibt', () => {
  it.each([
    ['leer', ''],
    ['zu kurz', 'C669A5B0078E577AF1F2D6BB91D5C9D319201E3'],
    ['zu lang', `${FP}0`],
    ['kein Hex', 'G669A5B0078E577AF1F2D6BB91D5C9D319201E38'],
    ['ein Key-Id statt Fingerprint', '91D5C9D319201E38'],
    ['nur Leerraum', '                                        '],
  ])('weist %s ab, statt etwas zu erfinden', async (_name, eingabe) => {
    // ⚠️ Wichtig, dass es WIRFT statt irgendetwas zu hashen: eine Kennung aus
    //    Unsinn wäre ein gültig aussehendes Postfach, das nie jemand liest.
    await expect(postfachKennung(eingabe)).rejects.toThrow(RangeError);
  });
});
