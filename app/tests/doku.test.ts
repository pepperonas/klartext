/**
 * Die Dokumentation gegen den Quelltext.
 *
 * ⚠️ Eine getippte Zahl in einer README veraltet **still**. Niemand merkt es,
 *    weil nichts kaputtgeht — das Repo behauptet dann nur etwas, das nicht mehr
 *    stimmt. Dieselbe Falle steckte schon einmal im Info-Screen („kommt in
 *    Phase 4", als Phase 4 lief), und dort war die Lehre dieselbe: die
 *    Erwartung aus der Wirklichkeit ableiten, nicht danebenschreiben.
 *
 * Also: jede Zahl und jeder Verweis in der README wird hier gegen das geprüft,
 * was tatsächlich im Repo steht.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const README = readFileSync(join(WURZEL, 'README.md'), 'utf8');

/** Zählt `it(...)`-Aufrufe, inklusive `it.each` — ohne sie auszuführen. */
function zaehleTests(verzeichnis: string): number {
  let summe = 0;
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) { summe += zaehleTests(voll); continue; }
    if (!eintrag.endsWith('.test.ts')) continue;
    const quelle = readFileSync(voll, 'utf8');
    // Einfaches `it('…')`
    summe += (quelle.match(/^\s*it\(['`]/gm) ?? []).length;
    // `it.each([...])('…')` — so viele Tests wie Zeilen in der Tabelle
    for (const block of quelle.match(/it\.each\(\[[\s\S]*?\]\)\(/g) ?? []) {
      summe += (block.match(/^\s*\[/gm) ?? []).length;
    }
  }
  return summe;
}

describe('Badges', () => {
  it('die Testzahl im Badge stimmt mit den vorhandenen Tests überein', () => {
    const gezaehlt = zaehleTests(join(WURZEL, 'app', 'tests'))
      + zaehleTests(join(WURZEL, 'relay', 'test'));
    const imBadge = Number(/Tests-(\d+)-/.exec(README)?.[1] ?? '0');
    expect(imBadge, 'kein Tests-Badge in der README').toBeGreaterThan(0);

    // ⚠️ Aus dem Quelltext lässt sich nur eine UNTERGRENZE zählen: `it.each`
    //    mit gerechneten Tabellen erzeugt zur Laufzeit mehr Tests, als hier zu
    //    sehen sind. Statt daraus eine willkürliche Spanne zu machen, wird die
    //    Eigenschaft benannt, die wirklich gilt:
    //
    //      · das Badge darf nie WENIGER nennen als statisch zählbar ist
    //        (dann ist es veraltet oder erfunden),
    //      · und nicht mehr als ein Drittel darüber liegen
    //        (dann ist es aufgeblasen).
    const meldung = `Badge ${String(imBadge)}, statisch gezählt ${String(gezaehlt)}`;
    expect(imBadge, meldung).toBeGreaterThanOrEqual(gezaehlt);
    expect(imBadge, meldung).toBeLessThanOrEqual(Math.round(gezaehlt * 1.34));
  });

  it('das Abhängigkeits-Badge nennt die wirkliche Zahl', () => {
    const paket = JSON.parse(readFileSync(join(WURZEL, 'app', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const echt = Object.keys(paket.dependencies ?? {}).length;
    const imBadge = Number(/Laufzeit--Abh%C3%A4ngigkeiten-(\d+)-/.exec(README)?.[1] ?? '-1');
    expect(imBadge).toBe(echt);
  });

  it('das CI-Badge zeigt auf einen Arbeitsablauf, den es gibt', () => {
    const treffer = /actions\/workflows\/([\w.-]+)\/badge\.svg/.exec(README);
    expect(treffer, 'kein CI-Badge').not.toBeNull();
    expect(existsSync(join(WURZEL, '.github', 'workflows', treffer?.[1] ?? ''))).toBe(true);
  });

  it('das Lizenz-Badge nennt die Lizenz, die im Repo liegt', () => {
    expect(README).toMatch(/Lizenz-MIT/);
    expect(readFileSync(join(WURZEL, 'LICENSE'), 'utf8')).toContain('MIT');
  });

  it('jedes Badge verweist auf ein Ziel im Repo — keine toten Anker', () => {
    for (const ziel of [...README.matchAll(/^\[!\[[^\]]*\]\([^)]*\)\]\(([^)]+)\)/gm)].map((m) => m[1] ?? '')) {
      if (ziel.startsWith('http')) continue;
      if (ziel.startsWith('#')) {
        // Ein Anker muss einer Überschrift entsprechen.
        const anker = ziel.slice(1).toLowerCase();
        const ueberschriften = [...README.matchAll(/^#{2,3} (.+)$/gm)]
          .map((m) => (m[1] ?? '').toLowerCase().replace(/[^a-zäöüß0-9]+/g, '-').replace(/^-|-$/g, ''));
        expect(ueberschriften, `Anker ${ziel}`).toContain(anker);
      } else {
        expect(existsSync(join(WURZEL, ziel)), `Datei ${ziel}`).toBe(true);
      }
    }
  });
});

describe('Bilder', () => {
  const BILDER = join(WURZEL, 'docs', 'bilder');

  it('jedes eingebundene Bild liegt auch im Repo', () => {
    const eingebunden = [...README.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1] ?? '');
    expect(eingebunden.length, 'die README zeigt kein einziges Bild').toBeGreaterThan(0);
    for (const pfad of eingebunden) {
      if (pfad.startsWith('http')) continue;
      expect(existsSync(join(WURZEL, pfad)), pfad).toBe(true);
    }
  });

  it('jeder Bildschirmauszug wird beschrieben, nicht nur benannt', () => {
    // Ein Bild ohne Alternativtext ist für Screenreader ein Loch — und in
    // einer App, die ihre eigene Zugänglichkeit misst, wäre das schwer zu
    // erklären. ⚠️ Für einen Auszug reicht ein Wort nicht: er zeigt etwas,
    // das im Text nicht steht, und muss deshalb beschrieben werden.
    for (const treffer of README.matchAll(/!\[([^\]]*)\]\((docs\/bilder\/[^)]+)\)/g)) {
      expect((treffer[1] ?? '').trim().length, `Auszug ${treffer[2] ?? ''}`).toBeGreaterThan(40);
    }
  });

  it('auch die Badges haben einen Alternativtext — dort genügt ein Wort', () => {
    // Ein Badge sagt EINE Sache; „Tests" ist die richtige Länge dafür. Von ihm
    // eine Beschreibung zu verlangen, hiesse Lärm zu erzwingen.
    for (const treffer of README.matchAll(/!\[([^\]]*)\]\((https?:[^)]+)\)/g)) {
      expect((treffer[1] ?? '').trim().length, `Badge ${treffer[2] ?? ''}`).toBeGreaterThan(0);
    }
  });

  it('kein Bild ist unnötig schwer', () => {
    if (!existsSync(BILDER)) return;
    for (const datei of readdirSync(BILDER)) {
      const groesse = statSync(join(BILDER, datei)).size;
      // GitHub zeigt README-Bilder mit rund 880 px Breite. Mehr als 150 kB je
      // Bild heisst: falsch erzeugt, nicht „schön".
      expect(groesse, `${datei} ist ${String(Math.round(groesse / 1024))} kB`)
        .toBeLessThan(150 * 1024);
    }
  });

  it('die Bilder werden aus der App erzeugt, nicht von Hand gemalt', () => {
    // Ein montiertes Bild wäre eine Zusage, die der Quelltext nicht einlöst.
    expect(existsSync(join(WURZEL, 'tools', 'bilder.mjs'))).toBe(true);
    const werkzeug = readFileSync(join(WURZEL, 'tools', 'bilder.mjs'), 'utf8');
    expect(werkzeug).toContain('app/dist'.replace('/', "', '"));
    expect(werkzeug).toContain('chromium');
  });

  it('in keinem Bild steckt ein privater Schlüssel', () => {
    // Die Bilder entstehen mit einem Wegwerf-Schlüssel — trotzdem wird
    // geprüft, dass nichts Privates im Bild ist. Ein PNG ist durchsuchbar.
    if (!existsSync(BILDER)) return;
    for (const datei of readdirSync(BILDER)) {
      const roh = readFileSync(join(BILDER, datei), 'latin1');
      expect(roh, datei).not.toContain('PRIVATE KEY BLOCK');
    }
  });
});

describe('Die README behauptet nichts Veraltetes', () => {
  it('nennt keine Phase als noch offen, die fertig ist', () => {
    const plan = readFileSync(join(WURZEL, 'PLAN.md'), 'utf8');
    if (/Alle Phasen umgesetzt/.test(plan)) {
      expect(README).not.toMatch(/Phase \d[^.]{0,40}(folgt|offen|steht aus|kommt)/i);
    }
  });

  it('verspricht keine Superlative — dieselbe Regel wie im UI', () => {
    for (const wort of ['militärisch', 'unknackbar', '100 % sicher', 'absolut sicher', 'unhackbar']) {
      // ⚠️ Kommentar- und Zitatzeilen ausnehmen: die README erklärt selbst,
      //    dass sie diese Wörter NICHT benutzt.
      const ohneZitate = README.split('\n').filter((z) => !z.trimStart().startsWith('>')).join('\n');
      expect(ohneZitate.toLowerCase(), wort).not.toContain(wort.toLowerCase());
    }
  });

  it('jeder Verweis auf eine Datei im Repo geht ins Leere oder nirgendwohin', () => {
    for (const treffer of README.matchAll(/\[[^\]]+\]\((?!http|#)([^)]+)\)/g)) {
      const ziel = (treffer[1] ?? '').split('#')[0] ?? '';
      if (ziel === '') continue;
      expect(existsSync(join(WURZEL, ziel)), ziel).toBe(true);
    }
  });

  it('nennt die Befehle, die es wirklich gibt', () => {
    const paket = JSON.parse(readFileSync(join(WURZEL, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const treffer of README.matchAll(/npm run ([a-z:-]+)/g)) {
      expect(Object.keys(paket.scripts), `npm run ${treffer[1] ?? ''}`).toContain(treffer[1]);
    }
  });
});
