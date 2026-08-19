/**
 * Misst, ob der Bau reproduzierbar ist.
 *
 * Die Zusage lautet: wer diesen Quelltext baut, bekommt exakt die Dateien, die
 * ausgeliefert werden — und kann sie deshalb gegen den Server vergleichen. Eine
 * Zusage, die man nicht misst, ist eine Behauptung. Also wird zweimal von Grund
 * auf gebaut und Datei für Datei verglichen.
 *
 * ⚠️ Das prüft Reproduzierbarkeit auf DIESEM Rechner mit DIESEN Abhängigkeiten.
 *    Ein anderer Rechner kann abweichen (andere Node-Fassung, andere npm-
 *    Auflösung). Deshalb ist `package-lock.json` verbindlich und die
 *    Node-Fassung in der CI festgenagelt. Eine echte Mehr-Rechner-Prüfung
 *    leistet erst die CI, wenn sie den Hash gegen den ausgelieferten meldet.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WURZEL, 'app', 'dist');

function baue(ziel) {
  rmSync(DIST, { recursive: true, force: true });
  execFileSync('npm', ['run', 'build'], { cwd: WURZEL, stdio: 'pipe' });
  cpSync(DIST, ziel, { recursive: true });
  return JSON.parse(readFileSync(join(ziel, 'build.json'), 'utf8'));
}

const arbeit = mkdtempSync(join(tmpdir(), 'klartext-repro-'));
let fehler = 0;
try {
  const a = baue(join(arbeit, 'a'));
  const b = baue(join(arbeit, 'b'));

  const namen = new Set([...Object.keys(a.dateien), ...Object.keys(b.dateien)]);
  for (const name of [...namen].sort()) {
    const links = a.dateien[name];
    const rechts = b.dateien[name];
    if (links === rechts) continue;
    fehler += 1;
    if (links === undefined) console.log(`  nur im zweiten Bau: ${name}`);
    else if (rechts === undefined) console.log(`  nur im ersten Bau:  ${name}`);
    else console.log(`  unterschiedlich:    ${name}\n    ${links}\n    ${rechts}`);
  }

  if (a.hash !== b.hash) {
    fehler += 1;
    console.log(`  Gesamt-Hash weicht ab:\n    ${a.hash}\n    ${b.hash}`);
  }

  if (fehler === 0) {
    console.log(`  OK   zwei Bauläufe, ${namen.size} Dateien, Byte für Byte gleich`);
    console.log(`  OK   Build-Hash ${a.hash}`);
  }
} finally {
  rmSync(arbeit, { recursive: true, force: true });
}

process.exit(fehler === 0 ? 0 : 1);
