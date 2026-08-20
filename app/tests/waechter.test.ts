/**
 * Der Postfachwächter.
 *
 * Er ist der Grund, warum eine Vorstellung überhaupt ankommt — und zugleich
 * die Stelle mit den heikelsten Regeln:
 *
 *  · Er darf **nur bei entsperrtem Bund** laufen. Gesperrt könnte er nichts
 *    entschlüsseln (alles landete als „unbekannt"), und eine offene
 *    Langabfrage verriete dem Server Anwesenheit, die ihn nichts angeht.
 *  · Es darf **nur einen** geben. Zwei Abholer am selben Postfach teilen sich
 *    die Nachrichten zufällig auf.
 *  · Er richtet das Postfach ein, sobald Modus B an ist — sonst kann nie etwas
 *    ankommen, solange man noch keinen Kontakt hat.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Postfachwaechter } from '../src/relay/waechter.ts';

interface Aufruf { art: string; }

function bauen(optionen: {
  zustand?: 'unlocked' | 'locked' | 'empty';
  aktiv?: boolean;
  eingerichtet?: boolean;
  holen?: () => { ok: true; wert: { neue: number; vorstellungen: number } } | { ok: false; fehler: { art: string; meldung: string } };
  offeneVorstellungen?: readonly string[];
  vorstellungGeht?: boolean;
} = {}) {
  const aufrufe: Aufruf[] = [];
  const status = { state: optionen.zustand ?? 'unlocked' };
  let eingerichtet = optionen.eingerichtet ?? true;

  // ⚠️ `einstellungen` gehört dazu: der Wächter liest daraus die vorgemerkten
  //    Vorstellungen. Ohne das Feld warf die Schleife beim ersten Durchlauf —
  //    und die Tests liefen in ihre Zeitschranke, statt den Fehler zu zeigen.
  //    Eine unvollständige Attrappe prüft nicht weniger, sie prüft falsch.
  const einstellungen = { offeneVorstellungen: [...(optionen.offeneVorstellungen ?? [])] };

  const client = {
    get status() { return status; },
    get einstellungen() { return einstellungen; },
    setzeEinstellungen: (teil: { offeneVorstellungen?: string[] }) => {
      aufrufe.push({ art: 'setzeEinstellungen' });
      if (teil.offeneVorstellungen !== undefined) {
        einstellungen.offeneVorstellungen = teil.offeneVorstellungen;
      }
      return Promise.resolve(einstellungen);
    },
    ruf: (art: string) => {
      aufrufe.push({ art });
      if (art === 'keys.list') {
        return Promise.resolve([{ fingerprint: 'A'.repeat(40), isDefault: true }]);
      }
      return Promise.resolve(undefined);
    },
  };

  const postfach = {
    lage: () => {
      aufrufe.push({ art: 'lage' });
      return Promise.resolve({ aktiv: optionen.aktiv ?? true, eingerichtet, url: '/relay', kennung: 'k' });
    },
    richteEin: () => {
      aufrufe.push({ art: 'richteEin' });
      eingerichtet = true;
      return Promise.resolve({ ok: true as const, wert: { kennung: 'k' } });
    },
    stelleDichVor: (_e: string, an: string) => {
      aufrufe.push({ art: `stelleDichVor:${an}` });
      return Promise.resolve(
        optionen.vorstellungGeht === false
          ? { ok: false as const, fehler: { art: 'netz', meldung: 'weg' } }
          : { ok: true as const, wert: { id: 'x' } },
      );
    },
    holeNeues: () => {
      aufrufe.push({ art: 'holeNeues' });
      // Nach dem ersten Abholen anhalten, sonst läuft die Schleife ewig.
      status.state = 'locked';
      return Promise.resolve(
        optionen.holen?.() ?? { ok: true as const, wert: { neue: 0, vorstellungen: 0 } },
      );
    },
  };

  const gemeldet: { neue: number; vorstellungen: number }[] = [];
  const waechter = new Postfachwaechter({
    client: client as never,
    postfach: postfach as never,
    beiNeuem: (neue, vorstellungen) => { gemeldet.push({ neue, vorstellungen }); },
  });
  return { waechter, aufrufe, gemeldet, status };
}

/**
 * Wartet, bis eine Bedingung eintritt — statt eine feste Zeit zu verstreichen.
 *
 * ⚠️ Erst standen hier 20 ms. Allein liefen die Tests damit grün, im
 *    Gesamtlauf kippten vier von ihnen: unter Last kommt die Schleife später
 *    dran. Eine feste Wartezeit ist keine Zusicherung, sondern eine Wette —
 *    und im Zweifel scheitert sie auf einem langsameren Rechner, nicht hier.
 */
async function bis(bedingung: () => boolean, was: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (bedingung()) return;
    await new Promise((f) => setTimeout(f, 5));
  }
  throw new Error(`nicht eingetreten: ${was}`);
}

/** Lässt die Schleife ein paar Runden laufen — für Fälle, in denen NICHTS passieren soll. */
const kurzWarten = () => new Promise((f) => setTimeout(f, 60));

beforeEach(() => { vi.useRealTimers(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('Nur bei entsperrtem Bund', () => {
  it('holt bei gesperrtem Bund gar nicht erst ab', async () => {
    const { waechter, aufrufe } = bauen({ zustand: 'locked' });
    waechter.starte();
    await kurzWarten();
    expect(aufrufe.map((a) => a.art)).not.toContain('holeNeues');
  });

  it('holt bei leerem Schlüsselbund nicht ab', async () => {
    const { waechter, aufrufe } = bauen({ zustand: 'empty' });
    waechter.starte();
    await kurzWarten();
    expect(aufrufe.map((a) => a.art)).not.toContain('holeNeues');
  });

  it('hört auf, sobald gesperrt wird', async () => {
    // ⚠️ Eine weiterlaufende Langabfrage hinter einem gesperrten Bund hielte
    //    die Verbindung offen — der Server sähe Anwesenheit, die ihn nichts
    //    angeht.
    const { waechter, aufrufe, status } = bauen();
    const geholt = () => aufrufe.filter((a) => a.art === 'holeNeues').length;
    waechter.starte();
    await bis(() => geholt() >= 1, 'einmal abgeholt');
    status.state = 'locked';
    const bisher = geholt();
    await kurzWarten();
    expect(geholt()).toBe(bisher);
  });

  it('lässt sich nach dem Stoppen wieder starten', async () => {
    const { waechter, aufrufe, status } = bauen();
    const geholt = () => aufrufe.filter((a) => a.art === 'holeNeues').length;
    waechter.starte();
    await bis(() => geholt() >= 1, 'erstes Abholen');
    waechter.stoppe();
    status.state = 'unlocked';
    waechter.starte();
    await bis(() => geholt() >= 2, 'zweites Abholen');
    expect(geholt()).toBeGreaterThanOrEqual(2);
  });
});

describe('Es gibt nur einen', () => {
  it('startet nicht zweimal', async () => {
    // ⚠️ Zwei Abholer am selben Postfach teilen sich die Nachrichten zufällig
    //    auf: einer bekommt sie, der andere sieht nichts.
    const { waechter, aufrufe } = bauen();
    waechter.starte();
    waechter.starte();
    waechter.starte();
    await bis(() => aufrufe.some((a) => a.art === 'holeNeues'), 'abgeholt');
    await kurzWarten();
    expect(aufrufe.filter((a) => a.art === 'holeNeues').length).toBe(1);
  });
});

describe('Postfach einrichten', () => {
  it('richtet ein, sobald Modus B an ist', async () => {
    // ⚠️ Genau hier lag der gemeldete Fall: eingerichtet wurde erst beim
    //    Öffnen eines Gesprächs. Wer noch keinen Kontakt hat, öffnet keines —
    //    und konnte darum NIE erfahren, dass jemand seine Einladung
    //    angenommen hat.
    const { waechter, aufrufe } = bauen({ eingerichtet: false });
    waechter.starte();
    await bis(() => aufrufe.some((a) => a.art === 'holeNeues'), 'abgeholt');
    expect(aufrufe.map((a) => a.art)).toContain('richteEin');
    expect(aufrufe.map((a) => a.art)).toContain('holeNeues');
  });

  it('richtet nicht ein, wenn Modus B aus ist', async () => {
    // Ohne Modus B gibt es keinen Server, den man fragen dürfte.
    const { waechter, aufrufe } = bauen({ aktiv: false, eingerichtet: false });
    waechter.starte();
    await kurzWarten();
    expect(aufrufe.map((a) => a.art)).not.toContain('richteEin');
    expect(aufrufe.map((a) => a.art)).not.toContain('holeNeues');
  });

  it('richtet nicht noch einmal ein, wenn es schon steht', async () => {
    const { waechter, aufrufe } = bauen({ eingerichtet: true });
    waechter.starte();
    await bis(() => aufrufe.some((a) => a.art === 'holeNeues'), 'abgeholt');
    expect(aufrufe.map((a) => a.art)).not.toContain('richteEin');
  });
});

describe('Melden', () => {
  it('meldet nur, wenn wirklich etwas angekommen ist', async () => {
    const { waechter, gemeldet } = bauen({
      holen: () => ({ ok: true, wert: { neue: 0, vorstellungen: 0 } }),
    });
    waechter.starte();
    await kurzWarten();
    expect(gemeldet).toHaveLength(0);
  });

  it('reicht die Zahl der Vorstellungen durch', async () => {
    const { waechter, gemeldet } = bauen({
      holen: () => ({ ok: true, wert: { neue: 3, vorstellungen: 2 } }),
    });
    waechter.starte();
    await bis(() => gemeldet.length > 0, 'gemeldet');
    expect(gemeldet).toEqual([{ neue: 3, vorstellungen: 2 }]);
  });

  it('meldet bei einem Fehlschlag nichts — und stürzt nicht ab', async () => {
    const { waechter, gemeldet } = bauen({
      holen: () => ({ ok: false, fehler: { art: 'netz', meldung: 'weg' } }),
    });
    waechter.starte();
    await kurzWarten();
    expect(gemeldet).toHaveLength(0);
  });
});

describe('Vorgemerkte Vorstellungen nachholen', () => {
  it('verschickt, was vorgemerkt ist — vor dem Abholen', async () => {
    // ⚠️ Der Grund für die Warteschlange: eine Einladung nimmt man fast immer
    //    bei GESPERRTEM Bund an (der Link lädt die Seite neu), und eine
    //    Vorstellung muss signiert werden. Hier ist der erste Moment, in dem
    //    sie überhaupt gehen kann.
    const { waechter, aufrufe } = bauen({ offeneVorstellungen: ['B'.repeat(40)] });
    waechter.starte();
    await bis(() => aufrufe.some((a) => a.art === 'holeNeues'), 'abgeholt');
    const reihenfolge = aufrufe.map((a) => a.art);
    expect(reihenfolge).toContain(`stelleDichVor:${'B'.repeat(40)}`);
    expect(reihenfolge.indexOf(`stelleDichVor:${'B'.repeat(40)}`))
      .toBeLessThan(reihenfolge.indexOf('holeNeues'));
  });

  it('streicht sie danach von der Liste', async () => {
    const { waechter, aufrufe } = bauen({ offeneVorstellungen: ['B'.repeat(40)] });
    waechter.starte();
    await bis(() => aufrufe.some((a) => a.art === 'setzeEinstellungen'), 'gestrichen');
    expect(aufrufe.map((a) => a.art)).toContain('setzeEinstellungen');
  });

  it('behält sie, wenn das Verschicken scheitert', async () => {
    // Der Empfänger könnte Modus B erst später einschalten — dann soll es
    // beim nächsten Mal wieder versucht werden.
    const { waechter, aufrufe } = bauen({
      offeneVorstellungen: ['B'.repeat(40)], vorstellungGeht: false,
    });
    waechter.starte();
    await bis(() => aufrufe.some((a) => a.art === 'holeNeues'), 'abgeholt');
    expect(aufrufe.map((a) => a.art)).not.toContain('setzeEinstellungen');
  });

  it('macht ohne Vorgemerktes gar nichts', async () => {
    const { waechter, aufrufe } = bauen();
    waechter.starte();
    await bis(() => aufrufe.some((a) => a.art === 'holeNeues'), 'abgeholt');
    expect(aufrufe.some((a) => a.art.startsWith('stelleDichVor'))).toBe(false);
  });
});
