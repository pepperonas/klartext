/**
 * Die Fortschrittsanzeige des geführten Ablaufs.
 *
 * Sie nennt die Schritte beim Namen statt „3 von 6" zu zählen — wer weiss, was
 * noch kommt, klickt nicht in der Annahme weiter, gleich fertig zu sein.
 *
 * ⚠️ Ihr Gehalt steckt fast vollständig in Zuständen und ARIA. Wer nur „sieht
 *    gut aus" prüft, prüft das Belanglose: für jemanden mit Screenreader IST
 *    das `aria-label` die Anzeige.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mitKlasse, stubDokument, texte, type StubKnoten } from './domstub.ts';

const SCHRITTE = [
  { titel: 'Wer bist du' },
  { titel: 'Verfahren' },
  { titel: 'Passphrase' },
  { titel: 'Sichern' },
];

beforeEach(() => { vi.resetModules(); vi.stubGlobal('document', stubDokument()); });
afterEach(() => { vi.unstubAllGlobals(); });

async function leiste(schritte = SCHRITTE) {
  const { Schrittleiste } = await import('../src/ui/components/schritte.ts');
  return new Schrittleiste(schritte);
}

const alsStub = (w: unknown): StubKnoten => w as StubKnoten;

describe('Aufbau', () => {
  it('zeigt jeden Schritt mit seinem Namen', async () => {
    const l = await leiste();
    const wurzel = alsStub(l.zeige(1));
    expect(texte(wurzel)).toEqual(['1', 'Wer bist du', '2', 'Verfahren', '3', 'Passphrase', '4', 'Sichern']);
  });

  it('ist eine geordnete Liste, keine lose Reihe von Kästchen', async () => {
    const l = await leiste();
    expect(alsStub(l.zeige(1)).tagName).toBe('OL');
  });

  it('hat genau so viele Einträge wie Schritte', async () => {
    const l = await leiste();
    expect(mitKlasse(alsStub(l.zeige(2)), 'schritt')).toHaveLength(4);
  });
});

describe('Zustände', () => {
  it('teilt in erledigt · aktuell · offen', async () => {
    const l = await leiste();
    const wurzel = alsStub(l.zeige(3));
    expect(mitKlasse(wurzel, 'erledigt')).toHaveLength(2);
    expect(mitKlasse(wurzel, 'aktuell')).toHaveLength(1);
    expect(mitKlasse(wurzel, 'offen')).toHaveLength(1);
  });

  it('setzt beim ersten Schritt nichts auf erledigt', async () => {
    const l = await leiste();
    expect(mitKlasse(alsStub(l.zeige(1)), 'erledigt')).toHaveLength(0);
  });

  it('hat am Ende nichts Offenes mehr', async () => {
    const l = await leiste();
    expect(mitKlasse(alsStub(l.zeige(4)), 'offen')).toHaveLength(0);
  });

  it('markiert erledigte Schritte mit einem Haken statt mit ihrer Nummer', async () => {
    const l = await leiste();
    expect(texte(alsStub(l.zeige(3)))).toEqual(
      ['✓', 'Wer bist du', '✓', 'Verfahren', '3', 'Passphrase', '4', 'Sichern']);
  });

  it('genau ein Schritt ist gleichzeitig der aktuelle', async () => {
    const l = await leiste();
    for (const n of [1, 2, 3, 4]) {
      expect(mitKlasse(alsStub(l.zeige(n)), 'aktuell'), `Schritt ${String(n)}`).toHaveLength(1);
    }
  });
});

describe('Für Hilfsmittel', () => {
  it('nennt Stand und Namen im Label der Liste', async () => {
    // Ohne den Namen bliebe „Schritt 3 von 4" — die Auskunft, die niemandem
    // sagt, was jetzt zu tun ist.
    const l = await leiste();
    expect(alsStub(l.zeige(3)).attribute['aria-label']).toBe('Schritt 3 von 4: Passphrase');
  });

  it('markiert den aktuellen Schritt als solchen', async () => {
    const l = await leiste();
    const aktuell = mitKlasse(alsStub(l.zeige(2)), 'aktuell')[0];
    expect(aktuell?.attribute['aria-current']).toBe('step');
  });

  it('markiert NUR den aktuellen — nicht die anderen', async () => {
    const l = await leiste();
    const wurzel = alsStub(l.zeige(2));
    const markiert = mitKlasse(wurzel, 'schritt').filter((s) => s.attribute['aria-current'] !== undefined);
    expect(markiert).toHaveLength(1);
  });

  it('versteckt die Nummer vor Hilfsmitteln — sie ist Zierde neben dem Namen', async () => {
    const l = await leiste();
    const nummern = mitKlasse(alsStub(l.zeige(1)), 'schritt-nr');
    expect(nummern.length).toBeGreaterThan(0);
    for (const n of nummern) expect(n.attribute['aria-hidden']).toBe('true');
  });
});

describe('Wiederholtes Zeichnen', () => {
  it('räumt beim erneuten Zeichnen auf, statt anzuhängen', async () => {
    // ⚠️ Der Ablauf zeichnet bei jedem Schritt neu. Ohne Aufräumen wüchse die
    //    Leiste mit jedem Klick — und der Fehler fiele erst nach dem dritten
    //    Schritt auf.
    const l = await leiste();
    l.zeige(1); l.zeige(2);
    const wurzel = alsStub(l.zeige(3));
    expect(mitKlasse(wurzel, 'schritt')).toHaveLength(4);
  });

  it('gibt bei jedem Aufruf dieselbe Wurzel zurück', async () => {
    const l = await leiste();
    expect(l.zeige(1)).toBe(l.zeige(2));
  });
});

describe('Randfälle', () => {
  it('kommt mit einem Stand ausserhalb der Schritte zurecht', async () => {
    // Kann durch eine Adresse von Hand entstehen (/neu/9).
    const l = await leiste();
    const wurzel = alsStub(l.zeige(99));
    expect(mitKlasse(wurzel, 'erledigt')).toHaveLength(4);
    expect(alsStub(wurzel).attribute['aria-label']).toBe('Schritt 99 von 4: ');
  });

  it('kommt mit einer leeren Schrittliste zurecht, statt zu werfen', async () => {
    const l = await leiste([]);
    expect(mitKlasse(alsStub(l.zeige(1)), 'schritt')).toHaveLength(0);
  });
});
