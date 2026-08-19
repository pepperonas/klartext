/**
 * QR-Encoder, Byte-Modus.
 *
 * Bewusst selbst geschrieben statt als Abhängigkeit: klartext hat genau eine
 * Laufzeit-Abhängigkeit, und ein QR-Code ist ein abgeschlossenes, vollständig
 * spezifiziertes Verfahren (ISO/IEC 18004). Eine Bibliothek dafür hereinzuholen
 * hiesse, für 300 Zeilen Algorithmus einen unbekannten Codepfad in eine App zu
 * lassen, deren Werbeversprechen die kurze Abhängigkeitsliste ist.
 *
 * ⚠️ Die beiden grossen Tabellen (Blockaufteilung und Ausrichtungsmuster) sind
 *    abgeschrieben und damit die wahrscheinlichste Fehlerquelle. Deshalb prüfen
 *    sie sich gegenseitig: `tests/qr.test.ts` rechnet die Gesamtzahl der
 *    Codewörter GEOMETRISCH aus der Symbolgrösse und den Funktionsmustern aus
 *    und vergleicht sie mit der Blocktabelle. Ein Zahlendreher in einer der
 *    beiden fällt dabei sofort auf. Zusätzlich liest der Browsertest die
 *    erzeugten Codes mit `BarcodeDetector` wieder ein.
 */

export type Fehlerkorrektur = 'L' | 'M' | 'Q' | 'H';

/** Blockaufteilung je Version (1..40) und Stufe: [ec je Block, g1, d1, g2, d2]. */
const BLOECKE: Readonly<Record<Fehlerkorrektur, readonly (readonly number[])[]>> = {
  L: [
    [7,1,19,0,0],[10,1,34,0,0],[15,1,55,0,0],[20,1,80,0,0],[26,1,108,0,0],
    [18,2,68,0,0],[20,2,78,0,0],[24,2,97,0,0],[30,2,116,0,0],[18,2,68,2,69],
    [20,4,81,0,0],[24,2,92,2,93],[26,4,107,0,0],[30,3,115,1,116],[22,5,87,1,88],
    [24,5,98,1,99],[28,1,107,5,108],[30,5,120,1,121],[28,3,113,4,114],[28,3,107,5,108],
    [28,4,116,4,117],[28,2,111,7,112],[30,4,121,5,122],[30,6,117,4,118],[26,8,106,4,107],
    [28,10,114,2,115],[30,8,122,4,123],[30,3,117,10,118],[30,7,116,7,117],[30,5,115,10,116],
    [30,13,115,3,116],[30,17,115,0,0],[30,17,115,1,116],[30,13,115,6,116],[30,12,121,7,122],
    [30,6,121,14,122],[30,17,122,4,123],[30,4,122,18,123],[30,20,117,4,118],[30,19,118,6,119],
  ],
  M: [
    [10,1,16,0,0],[16,1,28,0,0],[26,1,44,0,0],[18,2,32,0,0],[24,2,43,0,0],
    [16,4,27,0,0],[18,4,31,0,0],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44],
    [30,1,50,4,51],[22,6,36,2,37],[22,8,37,1,38],[24,4,40,5,41],[24,5,41,5,42],
    [28,7,45,3,46],[28,10,46,1,47],[26,9,43,4,44],[26,3,44,11,45],[26,3,41,13,42],
    [26,17,42,0,0],[28,17,46,0,0],[28,4,47,14,48],[28,6,45,14,46],[28,8,47,13,48],
    [28,19,46,4,47],[28,22,45,3,46],[28,3,45,23,46],[28,21,45,7,46],[28,19,47,10,48],
    [28,2,46,29,47],[28,10,46,23,47],[28,14,46,21,47],[28,14,46,23,47],[28,12,47,26,48],
    [28,6,47,34,48],[28,29,46,14,47],[28,13,46,32,47],[28,40,47,7,48],[28,18,47,31,48],
  ],
  Q: [
    [13,1,13,0,0],[22,1,22,0,0],[18,2,17,0,0],[26,2,24,0,0],[18,2,15,2,16],
    [24,4,19,0,0],[18,2,14,4,15],[22,4,18,2,19],[20,4,16,4,17],[24,6,19,2,20],
    [28,4,22,4,23],[26,4,20,6,21],[24,8,20,4,21],[20,11,16,5,17],[30,5,24,7,25],
    [24,15,19,2,20],[28,1,22,15,23],[28,17,22,1,23],[26,17,21,4,22],[30,15,24,5,25],
    [28,17,22,6,23],[30,7,24,16,25],[30,11,24,14,25],[30,11,24,16,25],[30,7,24,22,25],
    [28,28,22,6,23],[30,8,23,26,24],[30,4,24,31,25],[30,1,23,37,24],[30,15,24,25,25],
    [30,42,24,1,25],[30,10,24,35,25],[30,29,24,19,25],[30,44,24,7,25],[30,39,24,14,25],
    [30,46,24,10,25],[30,49,24,10,25],[30,48,24,14,25],[30,43,24,22,25],[30,34,24,34,25],
  ],
  H: [
    [17,1,9,0,0],[28,1,16,0,0],[22,2,13,0,0],[16,4,9,0,0],[22,2,11,2,12],
    [28,4,15,0,0],[26,4,13,1,14],[26,4,14,2,15],[24,4,12,4,13],[28,6,15,2,16],
    [24,3,12,8,13],[28,7,14,4,15],[22,12,11,4,12],[24,11,12,5,13],[24,11,12,7,13],
    [30,3,15,13,16],[28,2,14,17,15],[28,2,14,19,15],[26,9,13,16,14],[28,15,15,10,16],
    [30,19,16,6,17],[24,34,13,0,0],[30,16,15,14,16],[30,30,16,2,17],[30,22,15,13,16],
    [30,33,16,4,17],[30,12,15,28,16],[30,11,15,31,16],[30,19,15,26,16],[30,23,15,25,16],
    [30,23,15,28,16],[30,19,15,35,16],[30,11,15,46,16],[30,59,16,1,17],[30,22,15,41,16],
    [30,2,15,64,16],[30,24,15,46,16],[30,42,15,32,16],[30,10,15,67,16],[30,20,15,61,16],
  ],
};

/** Mittelpunkte der Ausrichtungsmuster je Version. */
const AUSRICHTUNG: readonly (readonly number[])[] = [
  [], [6,18], [6,22], [6,26], [6,30], [6,34], [6,22,38], [6,24,42], [6,26,46], [6,28,50],
  [6,30,54], [6,32,58], [6,34,62], [6,26,46,66], [6,26,48,70], [6,26,50,74], [6,30,54,78],
  [6,30,56,82], [6,30,58,86], [6,34,62,90], [6,28,50,72,94], [6,26,50,74,98], [6,30,54,78,102],
  [6,28,54,80,106], [6,32,58,84,110], [6,30,58,86,114], [6,34,62,90,118], [6,26,50,74,98,122],
  [6,30,54,78,102,126], [6,26,52,78,104,130], [6,30,56,82,108,134], [6,34,60,86,112,138],
  [6,30,58,86,114,142], [6,34,62,90,118,146], [6,30,54,78,102,126,150], [6,24,50,76,102,128,154],
  [6,28,54,80,106,132,158], [6,32,58,84,110,136,162], [6,26,54,82,110,138,166], [6,30,58,86,114,142,170],
];

// ---------------------------------------------------- Galois-Feld GF(256)

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // Generatorpolynom des QR-Standards
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] ?? 0;
})();

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0;
}

/** Generatorpolynom für `grad` Fehlerkorrektur-Codewörter. */
function generator(grad: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < grad; i++) {
    const neu = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      neu[j] = (neu[j] ?? 0) ^ (poly[j] ?? 0);
      neu[j + 1] = (neu[j + 1] ?? 0) ^ mul(poly[j] ?? 0, EXP[i] ?? 0);
    }
    poly = neu;
  }
  return poly;
}

function fehlerkorrektur(daten: Uint8Array, anzahl: number): Uint8Array {
  const gen = generator(anzahl);
  const rest = new Uint8Array(daten.length + anzahl);
  rest.set(daten);
  for (let i = 0; i < daten.length; i++) {
    const faktor = rest[i] ?? 0;
    if (faktor === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      rest[i + j] = (rest[i + j] ?? 0) ^ mul(gen[j] ?? 0, faktor);
    }
  }
  return rest.slice(daten.length);
}

// ------------------------------------------------------------ Kapazitäten

export function symbolgroesse(version: number): number {
  return version * 4 + 17;
}

function blockplan(version: number, stufe: Fehlerkorrektur): {
  ecJeBlock: number; gruppen: { bloecke: number; daten: number }[];
} {
  const zeile = BLOECKE[stufe][version - 1];
  if (zeile === undefined) throw new RangeError(`Version ${String(version)} unbekannt`);
  const [ec, g1, d1, g2, d2] = zeile as [number, number, number, number, number];
  const gruppen = [{ bloecke: g1, daten: d1 }];
  if (g2 > 0) gruppen.push({ bloecke: g2, daten: d2 });
  return { ecJeBlock: ec, gruppen };
}

/** Wie viele Nutzdaten-Bytes passen in diese Version bei dieser Stufe? */
export function kapazitaet(version: number, stufe: Fehlerkorrektur): number {
  const { gruppen } = blockplan(version, stufe);
  const datenCodewoerter = gruppen.reduce((s, g) => s + g.bloecke * g.daten, 0);
  const zaehlerBits = version < 10 ? 8 : 16;
  // 4 Bit Modus + Zeichenzähler, der Rest sind Nutzdaten.
  return Math.floor((datenCodewoerter * 8 - 4 - zaehlerBits) / 8);
}

export function kleinsteVersion(bytes: number, stufe: Fehlerkorrektur): number {
  for (let v = 1; v <= 40; v++) if (kapazitaet(v, stufe) >= bytes) return v;
  throw new RangeError(`${String(bytes)} Bytes passen in keinen QR-Code (Stufe ${stufe})`);
}

// ------------------------------------------------------------- Bitstrom

class Bits {
  #bits: number[] = [];
  schreibe(wert: number, laenge: number): void {
    for (let i = laenge - 1; i >= 0; i--) this.#bits.push((wert >>> i) & 1);
  }
  get laenge(): number { return this.#bits.length; }
  alsBytes(): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.#bits.length / 8));
    this.#bits.forEach((b, i) => {
      if (b === 1) bytes[i >> 3] = (bytes[i >> 3] ?? 0) | (0x80 >> (i & 7));
    });
    return bytes;
  }
}

function codewoerter(daten: Uint8Array, version: number, stufe: Fehlerkorrektur): Uint8Array {
  const { ecJeBlock, gruppen } = blockplan(version, stufe);
  const datenAnzahl = gruppen.reduce((s, g) => s + g.bloecke * g.daten, 0);

  const bits = new Bits();
  bits.schreibe(0b0100, 4);                       // Byte-Modus
  bits.schreibe(daten.length, version < 10 ? 8 : 16);
  for (const b of daten) bits.schreibe(b, 8);

  // Abschluss, höchstens vier Nullbits, dann auf Bytegrenze auffüllen.
  const platz = datenAnzahl * 8;
  bits.schreibe(0, Math.min(4, platz - bits.laenge));
  if (bits.laenge % 8 !== 0) bits.schreibe(0, 8 - (bits.laenge % 8));

  const roh = Array.from(bits.alsBytes());
  const FUELLER = [0xec, 0x11];
  for (let i = 0; roh.length < datenAnzahl; i++) roh.push(FUELLER[i % 2] ?? 0);

  // In Blöcke schneiden, je Block Fehlerkorrektur rechnen.
  const datenBloecke: Uint8Array[] = [];
  const ecBloecke: Uint8Array[] = [];
  let versatz = 0;
  for (const gruppe of gruppen) {
    for (let i = 0; i < gruppe.bloecke; i++) {
      const block = Uint8Array.from(roh.slice(versatz, versatz + gruppe.daten));
      versatz += gruppe.daten;
      datenBloecke.push(block);
      ecBloecke.push(fehlerkorrektur(block, ecJeBlock));
    }
  }

  // Verschränken: erst die Daten spaltenweise, dann die Fehlerkorrektur.
  const raus: number[] = [];
  const maxDaten = Math.max(...datenBloecke.map((b) => b.length));
  for (let i = 0; i < maxDaten; i++) {
    for (const block of datenBloecke) if (i < block.length) raus.push(block[i] ?? 0);
  }
  for (let i = 0; i < ecJeBlock; i++) {
    for (const block of ecBloecke) raus.push(block[i] ?? 0);
  }
  return Uint8Array.from(raus);
}

// ------------------------------------------------------------- Matrix

type Matrix = { modul: Int8Array; groesse: number };

function leer(groesse: number): Matrix {
  return { modul: new Int8Array(groesse * groesse).fill(-1), groesse };
}
function setze(m: Matrix, x: number, y: number, wert: number): void {
  m.modul[y * m.groesse + x] = wert;
}
function hole(m: Matrix, x: number, y: number): number {
  return m.modul[y * m.groesse + x] ?? -1;
}

function sucherMuster(m: Matrix, sx: number, sy: number): void {
  for (let y = -1; y <= 7; y++) {
    for (let x = -1; x <= 7; x++) {
      const px = sx + x;
      const py = sy + y;
      if (px < 0 || py < 0 || px >= m.groesse || py >= m.groesse) continue;
      const rand = x >= 0 && x <= 6 && (y === 0 || y === 6);
      const seite = y >= 0 && y <= 6 && (x === 0 || x === 6);
      const kern = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      setze(m, px, py, rand || seite || kern ? 1 : 0);
    }
  }
}

function ausrichtungsMuster(m: Matrix, version: number): void {
  const punkte = AUSRICHTUNG[version - 1] ?? [];
  for (const cy of punkte) {
    for (const cx of punkte) {
      // Nicht über die Sucher legen.
      if ((cx === 6 && cy === 6) ||
          (cx === 6 && cy === m.groesse - 7) ||
          (cx === m.groesse - 7 && cy === 6)) continue;
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          const rand = Math.max(Math.abs(x), Math.abs(y));
          setze(m, cx + x, cy + y, rand === 1 ? 0 : 1);
        }
      }
    }
  }
}

function taktmuster(m: Matrix): void {
  for (let i = 8; i < m.groesse - 8; i++) {
    const wert = i % 2 === 0 ? 1 : 0;
    if (hole(m, i, 6) === -1) setze(m, i, 6, wert);
    if (hole(m, 6, i) === -1) setze(m, 6, i, wert);
  }
}

/** Plätze für Format- und Versionsinformation freihalten. */
function reserviere(m: Matrix, version: number): void {
  for (let i = 0; i < 9; i++) {
    if (hole(m, i, 8) === -1) setze(m, i, 8, 0);
    if (hole(m, 8, i) === -1) setze(m, 8, i, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (hole(m, m.groesse - 1 - i, 8) === -1) setze(m, m.groesse - 1 - i, 8, 0);
    if (hole(m, 8, m.groesse - 1 - i) === -1) setze(m, 8, m.groesse - 1 - i, 0);
  }
  setze(m, 8, m.groesse - 8, 1); // immer dunkel
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3);
      const b = (i % 3) + m.groesse - 11;
      if (hole(m, a, b) === -1) setze(m, a, b, 0);
      if (hole(m, b, a) === -1) setze(m, b, a, 0);
    }
  }
}

function belegt(m: Matrix, roh: Uint8Array, maske: number): void {
  let bit = 0;
  let aufwaerts = true;
  for (let rechts = m.groesse - 1; rechts >= 1; rechts -= 2) {
    if (rechts === 6) rechts = 5; // die senkrechte Taktspalte überspringen
    for (let s = 0; s < m.groesse; s++) {
      const y = aufwaerts ? m.groesse - 1 - s : s;
      for (let d = 0; d < 2; d++) {
        const x = rechts - d;
        if (hole(m, x, y) !== -1) continue;
        const wert = bit < roh.length * 8
          ? ((roh[bit >> 3] ?? 0) >> (7 - (bit & 7))) & 1
          : 0;
        bit += 1;
        setze(m, x, y, wert ^ (maskiert(maske, x, y) ? 1 : 0));
      }
    }
    aufwaerts = !aufwaerts;
  }
}

function maskiert(maske: number, x: number, y: number): boolean {
  switch (maske) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

const STUFE_BITS: Readonly<Record<Fehlerkorrektur, number>> = { L: 1, M: 0, Q: 3, H: 2 };

function formatInfo(m: Matrix, stufe: Fehlerkorrektur, maske: number): void {
  const daten = (STUFE_BITS[stufe] << 3) | maske;
  let rest = daten << 10;
  for (let i = 4; i >= 0; i--) {
    if ((rest >>> (i + 10)) & 1) rest ^= 0b10100110111 << i;
  }
  const bits = ((daten << 10) | rest) ^ 0b101010000010010;

  for (let i = 0; i <= 5; i++) setze(m, 8, i, (bits >> i) & 1);
  setze(m, 8, 7, (bits >> 6) & 1);
  setze(m, 8, 8, (bits >> 7) & 1);
  setze(m, 7, 8, (bits >> 8) & 1);
  for (let i = 9; i < 15; i++) setze(m, 14 - i, 8, (bits >> i) & 1);

  for (let i = 0; i <= 7; i++) setze(m, m.groesse - 1 - i, 8, (bits >> i) & 1);
  for (let i = 8; i < 15; i++) setze(m, 8, m.groesse - 15 + i, (bits >> i) & 1);
  setze(m, 8, m.groesse - 8, 1);
}

function versionInfo(m: Matrix, version: number): void {
  if (version < 7) return;
  let rest = version << 12;
  for (let i = 5; i >= 0; i--) {
    if ((rest >>> (i + 12)) & 1) rest ^= 0b1111100100101 << i;
  }
  const bits = (version << 12) | rest;
  for (let i = 0; i < 18; i++) {
    const b = (bits >> i) & 1;
    const a = Math.floor(i / 3);
    const c = (i % 3) + m.groesse - 11;
    setze(m, a, c, b);
    setze(m, c, a, b);
  }
}

/** Strafpunkte nach ISO/IEC 18004 — je weniger, desto besser lesbar. */
function strafe(m: Matrix): number {
  const g = m.groesse;
  let summe = 0;

  // Regel 1: Reihen gleicher Farbe
  for (let richtung = 0; richtung < 2; richtung++) {
    for (let a = 0; a < g; a++) {
      let lauf = 1;
      let vorher = -1;
      for (let b = 0; b < g; b++) {
        const wert = richtung === 0 ? hole(m, b, a) : hole(m, a, b);
        if (wert === vorher) { lauf += 1; } else { if (lauf >= 5) summe += 3 + (lauf - 5); lauf = 1; vorher = wert; }
      }
      if (lauf >= 5) summe += 3 + (lauf - 5);
    }
  }

  // Regel 2: gleichfarbige 2x2-Blöcke
  for (let y = 0; y < g - 1; y++) {
    for (let x = 0; x < g - 1; x++) {
      const w = hole(m, x, y);
      if (w === hole(m, x + 1, y) && w === hole(m, x, y + 1) && w === hole(m, x + 1, y + 1)) summe += 3;
    }
  }

  // Regel 3: sucherähnliche Muster
  const muster = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const rueck = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let richtung = 0; richtung < 2; richtung++) {
    for (let a = 0; a < g; a++) {
      for (let b = 0; b + 11 <= g; b++) {
        let vor = true;
        let zur = true;
        for (let k = 0; k < 11; k++) {
          const wert = richtung === 0 ? hole(m, b + k, a) : hole(m, a, b + k);
          if (wert !== muster[k]) vor = false;
          if (wert !== rueck[k]) zur = false;
        }
        if (vor) summe += 40;
        if (zur) summe += 40;
      }
    }
  }

  // Regel 4: Abweichung vom Gleichgewicht hell/dunkel
  let dunkel = 0;
  for (let i = 0; i < g * g; i++) if (m.modul[i] === 1) dunkel += 1;
  const anteil = (dunkel * 100) / (g * g);
  summe += Math.floor(Math.abs(anteil - 50) / 5) * 10;

  return summe;
}

export interface QrCode {
  readonly groesse: number;
  readonly version: number;
  readonly stufe: Fehlerkorrektur;
  /** true = dunkel. */
  dunkel(x: number, y: number): boolean;
}

/**
 * Erzeugt den QR-Code. Die Maske wird wie im Standard über Strafpunkte gewählt.
 */
export function erzeugeQr(text: string, stufe: Fehlerkorrektur = 'Q'): QrCode {
  const daten = new TextEncoder().encode(text);
  const version = kleinsteVersion(daten.length, stufe);
  const roh = codewoerter(daten, version, stufe);

  let beste: Matrix | null = null;
  let bestePunkte = Number.POSITIVE_INFINITY;

  for (let maske = 0; maske < 8; maske++) {
    const m = leer(symbolgroesse(version));
    sucherMuster(m, 0, 0);
    sucherMuster(m, m.groesse - 7, 0);
    sucherMuster(m, 0, m.groesse - 7);
    ausrichtungsMuster(m, version);
    taktmuster(m);
    reserviere(m, version);
    belegt(m, roh, maske);
    formatInfo(m, stufe, maske);
    versionInfo(m, version);

    const punkte = strafe(m);
    if (punkte < bestePunkte) { bestePunkte = punkte; beste = m; }
  }
  if (beste === null) throw new Error('Keine Maske gefunden.');
  const fertig = beste;

  return {
    groesse: fertig.groesse,
    version,
    stufe,
    dunkel: (x, y) => hole(fertig, x, y) === 1,
  };
}

/** Als SVG-Pfad — ein einziger Pfad statt tausender Rechtecke. */
export function alsSvgPfad(qr: QrCode): string {
  const teile: string[] = [];
  for (let y = 0; y < qr.groesse; y++) {
    for (let x = 0; x < qr.groesse; x++) {
      if (qr.dunkel(x, y)) teile.push(`M${String(x)} ${String(y)}h1v1h-1z`);
    }
  }
  return teile.join('');
}
