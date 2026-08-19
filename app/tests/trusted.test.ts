/**
 * Die Trusted-Types-Richtlinie.
 *
 * Sie ist der einzige Weg, auf dem in dieser App eine Skript-Adresse geladen
 * wird. Wäre sie nachgiebig, wäre die ganze Direktive Zierde.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let erlaube: (u: string) => string;
let vertraue: (u: string) => string;
let angelegteNamen: string[];

beforeEach(async () => {
  vi.resetModules();
  angelegteNamen = [];
  vi.stubGlobal('location', { href: 'https://klartext.celox.io/' });
  const modul = await import('../src/trusted.ts');
  erlaube = modul.erlaube;
  vertraue = modul.vertraue;
});

afterEach(() => { vi.unstubAllGlobals(); });

function mitTrustedTypes(): void {
  vi.stubGlobal('trustedTypes', {
    createPolicy: (name: string, regeln: { createScriptURL: (e: string) => string }) => {
      angelegteNamen.push(name);
      return { createScriptURL: (e: string) => regeln.createScriptURL(e) };
    },
  });
}

describe('ohne Trusted Types im Browser', () => {
  it('lässt freigegebene Adressen durch', () => {
    erlaube('/sw.js');
    expect(vertraue('/sw.js')).toBe('/sw.js');
  });

  it('weist nicht freigegebene Adressen AUCH DANN ab', () => {
    // Die Prüfung darf nicht davon abhängen, ob der Browser mitspielt.
    erlaube('/sw.js');
    expect(() => vertraue('/fremd.js')).toThrow(/Nicht freigegebene/);
  });

  it('weist fremde Herkunft ab', () => {
    erlaube('/sw.js');
    expect(() => vertraue('https://boeswillig.example/sw.js')).toThrow();
  });
});

describe('mit Trusted Types', () => {
  beforeEach(() => { mitTrustedTypes(); });

  it('legt genau eine Richtlinie mit dem in der CSP genannten Namen an', async () => {
    const { POLICY_NAME } = await import('../src/trusted.ts');
    erlaube('/sw.js');
    erlaube('/assets/worker.js');
    vertraue('/sw.js');
    vertraue('/assets/worker.js');
    // ⚠️ createPolicy wirft beim zweiten Mal mit demselben Namen — die
    //    Richtlinie MUSS zwischengespeichert werden.
    expect(angelegteNamen).toEqual([POLICY_NAME]);
  });

  it('prüft auch innerhalb der Richtlinie noch einmal', () => {
    erlaube('/sw.js');
    vertraue('/sw.js');
    expect(() => vertraue('/etwas-anderes.js')).toThrow();
  });

  it('erkennt dieselbe Adresse in verschiedenen Schreibweisen', () => {
    erlaube('/sw.js');
    expect(() => vertraue('https://klartext.celox.io/sw.js')).not.toThrow();
  });

  it('lässt sich nicht durch einen Pfad-Trick umgehen', () => {
    erlaube('/sw.js');
    for (const versuch of ['/../sw.js.evil', '/sw.js/../fremd.js', '//boeswillig.example/sw.js']) {
      expect(() => vertraue(versuch)).toThrow();
    }
  });
});
