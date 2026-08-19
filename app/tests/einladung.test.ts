/**
 * Einladungslinks.
 *
 * Der wichtigste Test hier ist der unscheinbarste: die Nutzlast MUSS im
 * Fragment stehen. Steht sie in der Abfrage, liegt der Schlüssel in jedem
 * Zugriffsprotokoll zwischen Absender und Empfänger.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  EINLADUNG_PFAD,
  FASSUNG,
  ausBase64Url,
  baueEinladung,
  leseEinladung,
  nachBase64Url,
  passtInQr,
  restlaufzeit,
} from '../src/contacts/einladung.ts';
import { lies } from './fixtures.ts';

const HERKUNFT = 'https://klartext.celox.io';

/** Armor -> Bytes. So bekommt der Worker die Schlüssel auch heraus. */
function binaer(datei: string): Uint8Array {
  const armor = lies(datei);
  const zeilen = armor.split(/\r?\n/);
  const start = zeilen.findIndex((z) => z.startsWith('-----BEGIN'));
  const ende = zeilen.findIndex((z) => z.startsWith('-----END'));
  const nutz = zeilen.slice(start + 1, ende)
    .filter((z) => z.length > 0 && !z.includes(':') && !z.startsWith('='));
  return Uint8Array.from(Buffer.from(nutz.join(''), 'base64'));
}

const RSA = binaer('rsa4096.pub.asc');
const ECC = binaer('ed25519.pub.asc');

function bauen(extra: Partial<Parameters<typeof baueEinladung>[0]> = {}) {
  return baueEinladung({ name: 'Martin', schluessel: RSA, herkunft: HERKUNFT, ...extra });
}

describe('base64url', () => {
  it('ist umkehrbar', () => {
    for (const laenge of [0, 1, 2, 3, 17, 256, 1000]) {
      const bytes = new Uint8Array(laenge).map((_, i) => (i * 37) % 256);
      expect([...ausBase64Url(nachBase64Url(bytes))]).toEqual([...bytes]);
    }
  });

  it('benutzt keine Zeichen, die eine URL zerlegen', () => {
    const bytes = new Uint8Array(300).map((_, i) => i % 256);
    expect(nachBase64Url(bytes)).toMatch(/^[A-Za-z0-9_-]*$/);
  });
});

describe('Bauen', () => {
  it('legt die Nutzlast ins FRAGMENT, nicht in die Abfrage', () => {
    // ⚠️ Der ganze Punkt: Fragmente schickt der Browser nie an einen Server.
    const { url } = bauen();
    expect(url.startsWith(`${HERKUNFT}${EINLADUNG_PFAD}#`)).toBe(true);
    expect(url).not.toContain('?');
    const [vorRaute] = url.split('#');
    expect(vorRaute).toBe(`${HERKUNFT}${EINLADUNG_PFAD}`);
  });

  it('trägt nichts Geheimes', () => {
    const { url, einladung } = bauen();
    expect(url).not.toContain('PRIVATE KEY');
    expect(einladung.schluessel.length).toBeGreaterThan(100);
  });

  it('schickt KEINEN Fingerprint mit', () => {
    // ⚠️ Ein mitgeschickter Fingerprint wäre eine zweite Wahrheit neben dem
    //    Schlüssel — und zwei Wahrheiten kann jemand auseinanderlaufen lassen.
    //    Er wird beim Empfänger aus dem Schlüssel gerechnet.
    const { einladung } = bauen();
    expect(Object.keys(einladung).sort()).toEqual(['fassung', 'id', 'laeuftAb', 'name', 'schluessel']);
  });

  it('vergibt jedes Mal eine andere Kennung', () => {
    const ids = new Set(Array.from({ length: 50 }, () => bauen().einladung.id));
    expect(ids.size).toBe(50);
  });

  it('setzt den Ablauf auf die gewünschte Frist', () => {
    const jetzt = Date.UTC(2026, 7, 19, 12, 0, 0);
    const { einladung } = bauen({ jetzt, gueltigTage: 3 });
    expect(einladung.laeuftAb).toBe(Math.floor(jetzt / 1000) + 3 * 86_400);
  });

  it('trägt den Namen unverändert, auch mit Umlauten', () => {
    const { url } = bauen({ name: 'Käthe Größlein 🔐' });
    const ergebnis = leseEinladung(url.slice(url.indexOf('#')));
    expect(ergebnis.ok).toBe(true);
    if (ergebnis.ok) expect(ergebnis.einladung.name).toBe('Käthe Größlein 🔐');
  });
});

describe('Lesen', () => {
  it('liest zurück, was gebaut wurde — Byte für Byte', () => {
    for (const schluessel of [RSA, ECC]) {
      const { url, einladung } = bauen({ schluessel });
      const ergebnis = leseEinladung(url.slice(url.indexOf('#')));
      expect(ergebnis.ok).toBe(true);
      if (!ergebnis.ok) continue;
      expect(ergebnis.einladung.id).toBe(einladung.id);
      expect(ergebnis.einladung.name).toBe(einladung.name);
      expect(ergebnis.einladung.laeuftAb).toBe(einladung.laeuftAb);
      expect([...ergebnis.einladung.schluessel]).toEqual([...schluessel]);
    }
  });

  it('kommt mit und ohne führende Raute zurecht', () => {
    const { url } = bauen();
    const nutzlast = url.slice(url.indexOf('#') + 1);
    expect(leseEinladung(nutzlast).ok).toBe(true);
    expect(leseEinladung(`#${nutzlast}`).ok).toBe(true);
  });

  it('weist eine abgelaufene Einladung ab', () => {
    const jetzt = Date.UTC(2026, 7, 19);
    const { url } = bauen({ jetzt, gueltigTage: 1 });
    const fragment = url.slice(url.indexOf('#'));
    const spaeter = jetzt + 2 * 86_400_000;
    const ergebnis = leseEinladung(fragment, spaeter);
    expect(ergebnis.ok).toBe(false);
    if (!ergebnis.ok) {
      expect(ergebnis.fehler).toBe('abgelaufen');
      expect(ergebnis.meldung).toMatch(/abgelaufen/i);
    }
  });

  it('nimmt sie eine Sekunde vor Ablauf noch an', () => {
    const jetzt = Date.UTC(2026, 7, 19);
    const { url, einladung } = bauen({ jetzt, gueltigTage: 1 });
    const knapp = einladung.laeuftAb * 1000;
    expect(leseEinladung(url.slice(url.indexOf('#')), knapp).ok).toBe(true);
  });

  it.each([
    ['leeres Fragment', '#', 'keine-einladung'],
    ['kein base64url', '#nicht base64!!!', 'unlesbar'],
    ['zu kurz für den Kopf', `#${nachBase64Url(new Uint8Array(8))}`, 'unlesbar'],
  ])('weist %s ab', (_name, fragment, erwartet) => {
    const ergebnis = leseEinladung(fragment);
    expect(ergebnis.ok).toBe(false);
    if (!ergebnis.ok) expect(ergebnis.fehler).toBe(erwartet);
  });

  it('weist eine unbekannte Fassung ab, statt zu raten', () => {
    const { url } = bauen();
    const bytes = ausBase64Url(url.slice(url.indexOf('#') + 1));
    bytes[0] = FASSUNG + 1;
    const ergebnis = leseEinladung(`#${nachBase64Url(bytes)}`);
    expect(ergebnis.ok).toBe(false);
    if (!ergebnis.ok) expect(ergebnis.fehler).toBe('falsche-fassung');
  });

  it('weist eine Nutzlast ohne Schlüssel ab', () => {
    // Kopf vorhanden, Name leer, danach nichts mehr.
    const bytes = new Uint8Array(17);
    bytes[0] = FASSUNG;
    expect(leseEinladung(`#${nachBase64Url(bytes.slice(0, 16))}`).ok).toBe(false);
  });

  it('weist eine unmögliche Namenslänge ab, statt am Puffer vorbeizulesen', () => {
    // ⚠️ Eine Längenangabe aus fremder Hand ist eine Einladung zum
    //    Vorbeilesen. Sie wird gegen die tatsächliche Grösse geprüft.
    const { url } = bauen();
    const bytes = ausBase64Url(url.slice(url.indexOf('#') + 1));
    new DataView(bytes.buffer).setUint16(14, 65_000, false);
    const ergebnis = leseEinladung(`#${nachBase64Url(bytes)}`);
    expect(ergebnis.ok).toBe(false);
    if (!ergebnis.ok) expect(ergebnis.fehler).toBe('unvollstaendig');
  });

  it('weist einen Namen ab, der kein gültiges UTF-8 ist', () => {
    const { url } = bauen({ name: 'ab' });
    const bytes = ausBase64Url(url.slice(url.indexOf('#') + 1));
    bytes[16] = 0xff; // ungültige UTF-8-Folge
    bytes[17] = 0xfe;
    const ergebnis = leseEinladung(`#${nachBase64Url(bytes)}`);
    expect(ergebnis.ok).toBe(false);
    if (!ergebnis.ok) expect(ergebnis.fehler).toBe('unlesbar');
  });
});

describe('Restlaufzeit', () => {
  it('nennt Tage, Stunden und Minuten im Klartext', () => {
    const jetzt = Date.UTC(2026, 7, 19);
    const { einladung } = bauen({ jetzt, gueltigTage: 7 });
    expect(restlaufzeit(einladung, jetzt)).toMatch(/noch 7 Tage/);
    expect(restlaufzeit(einladung, jetzt + 6 * 86_400_000)).toMatch(/Stunden|Tag/);
    expect(restlaufzeit(einladung, jetzt + 7 * 86_400_000 + 1000)).toBe('abgelaufen');
  });
});

describe('Grösse', () => {
  it('das Binärformat halbiert den Link gegenüber dem ersten Anlauf', () => {
    // ⚠️ Der erste Anlauf lag bei 4606 Zeichen: der ASCII-armored Schlüssel
    //    steckte in JSON, und das Ganze wurde noch einmal base64 kodiert. Jetzt
    //    reist der Schlüssel binär und wird genau einmal kodiert.
    const { url } = bauen();
    expect(url.length).toBeLessThan(3300);
    expect(url.length).toBeGreaterThan(2000); // RSA-4096 ist nun einmal gross
  });

  it('sagt ehrlich, dass ein RSA-4096-Link nicht in einen QR-Code passt', () => {
    // Gemessen: 2330 Byte Zertifikat, ~3140 Zeichen Link. Der grösste QR-Code
    // überhaupt fasst 2953 Byte — das geht in KEINER Stufe.
    expect(passtInQr(bauen().url)).toBe(false);
  });

  it('ein Curve25519-Link passt bequem in einen QR-Code', () => {
    const { url } = bauen({ schluessel: ECC });
    expect(passtInQr(url)).toBe(true);
    expect(url.length).toBeLessThan(900);
  });

  it('ein Curve25519-Link ist deutlich kürzer', () => {
    expect(bauen({ schluessel: ECC }).url.length).toBeLessThan(bauen().url.length / 2);
  });

  it('das Binärformat verschwendet höchstens ein Drittel gegenüber dem rohen Schlüssel', () => {
    // Einmal base64 kostet 4/3. Mehr darf der Umschlag nicht ausmachen.
    const { url } = bauen();
    const nutzlast = url.slice(url.indexOf('#') + 1);
    expect(nutzlast.length).toBeLessThan(RSA.length * 4 / 3 + 60);
  });
});

describe('Zeit', () => {
  it('nimmt die einspeisbare Uhr, nicht die Systemuhr', () => {
    // Sonst liesse sich der Ablauf nicht prüfen, ohne an der Uhr zu drehen.
    const spion = vi.spyOn(Date, 'now');
    bauen({ jetzt: 1_000_000 });
    leseEinladung('#x', 1_000_000);
    expect(spion).not.toHaveBeenCalled();
    spion.mockRestore();
  });
});
