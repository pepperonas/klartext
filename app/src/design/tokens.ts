/**
 * Einzige Quelle der Gestaltungswerte.
 *
 * Aus dieser Datei erzeugt vite.config.ts beim Bauen das `:root`-Regelwerk
 * (virtuelles Modul `virtual:tokens.css`). Es gibt also keine zweite Liste in
 * einer CSS-Datei, die auseinanderlaufen koennte — und weil die Werte als
 * echtes CSS ausgeliefert werden, gibt es auch kein Aufblitzen ungestylter
 * Inhalte, wie es eine Zuweisung per JavaScript zur Laufzeit mit sich braechte.
 */

/**
 * ⚠️ Die Werte sind GEMESSEN, nicht geschaetzt. Zwei Paare sind beim ersten
 *    Anlauf durchgefallen und mussten nachgezogen werden:
 *
 *      text-still     4,45:1  -> Text braucht 4,5:1   (Fusszeile, Restzeit)
 *      kontur-stark   2,08:1  -> Bedienelement-Grenzen brauchen 3:1
 *                                (WCAG 1.4.11 — die Umrandung von Eingabe-
 *                                feldern und Knoepfen IST das Bedienelement)
 *
 *    `tests/kontrast.test.ts` rechnet beide Themen bei jedem Lauf nach.
 */
export const FARBEN_DUNKEL = {
  'bg': '#0e1113',
  'bg-erhaben': '#151a1d',
  'flaeche': '#1a2024',
  'flaeche-hoch': '#212a2f',
  'kontur': '#2c363c',
  'kontur-stark': '#697379',

  'text': '#e4eaed',
  'text-leise': '#9aa8b0',
  'text-still': '#839198',

  // Ruhiges Blaugruen statt Werbeblau: die App soll technisch wirken, nicht laut.
  'akzent': '#5ec8be',
  'akzent-schwach': '#1b3b3a',
  'auf-akzent': '#00201e',

  'warnung': '#f0b354',
  'warnung-schwach': '#3a2c14',
  'auf-warnung': '#241800',

  'gefahr': '#f2857f',
  'gefahr-schwach': '#3d1f1e',
  'auf-gefahr': '#2b0908',

  'gut': '#7ec98a',
  'gut-schwach': '#1d3421',
} as const;

export const FARBEN_HELL = {
  'bg': '#f6f8f8',
  'bg-erhaben': '#ffffff',
  'flaeche': '#ffffff',
  'flaeche-hoch': '#eef2f3',
  'kontur': '#d5dee1',
  'kontur-stark': '#818d91',

  'text': '#141a1c',
  'text-leise': '#4a575d',
  'text-still': '#627076',

  'akzent': '#0f6b64',
  'akzent-schwach': '#d5eeeb',
  'auf-akzent': '#ffffff',

  'warnung': '#7a5200',
  'warnung-schwach': '#fbeed2',
  'auf-warnung': '#ffffff',

  'gefahr': '#a3211c',
  'gefahr-schwach': '#fbdedd',
  'auf-gefahr': '#ffffff',

  'gut': '#1d6b2c',
  'gut-schwach': '#dceede',
} as const;

/**
 * Der Typwechsel ist der Zustandsanzeiger: Proportionalschrift heisst Klartext,
 * Festbreitenschrift heisst Ciphertext oder Fingerprint. Man sieht auf einen
 * Blick, woran man ist, ohne ein Wort zu lesen.
 *
 * Phase 1 nutzt die Systemschriften. Eigene, mitgelieferte Schnitte (Inter +
 * JetBrains Mono, beide OFL, auf Latein reduziert) kommen in Phase 2 — dort
 * traegt die Typografie das Motiv, hier waere sie Ballast ohne Nutzen.
 */
export const SCHRIFT = {
  'schrift-text': "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  'schrift-mono': "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
} as const;

export const MASSE = {
  'r-klein': '10px',
  'r-mittel': '16px',
  'r-gross': '24px',
  'r-voll': '999px',
  'raum-1': '4px',
  'raum-2': '8px',
  'raum-3': '12px',
  'raum-4': '16px',
  'raum-5': '24px',
  'raum-6': '32px',
  'raum-7': '48px',
  'breite': '760px',
} as const;

/**
 * Federn statt Beschleunigungskurven. Die Werte sind Steifigkeit / Daempfung /
 * Masse und werden von motion/spring.ts integriert, nicht von CSS.
 */
export const FEDERN = {
  /** Standard fuer Zustandswechsel. */
  weich: { steifigkeit: 170, daempfung: 26, masse: 1 },
  /** Kurz und bestimmt — fuer Zeichen im Zerfalls-Motiv (Phase 2). */
  knapp: { steifigkeit: 420, daempfung: 34, masse: 1 },
  /** Traege, fuer grosse Flaechen. */
  ruhig: { steifigkeit: 120, daempfung: 24, masse: 1 },
} as const;

export type Federname = keyof typeof FEDERN;

function regeln(werte: Readonly<Record<string, string>>): string {
  return Object.entries(werte)
    .map(([name, wert]) => `  --kt-${name}: ${wert};`)
    .join('\n');
}

/**
 * Erzeugt das Regelwerk. Das helle Thema haengt an `data-theme`, damit die
 * Wahl des Nutzers die Systemeinstellung schlagen kann — und zusaetzlich an
 * `prefers-color-scheme`, damit ohne getroffene Wahl das Richtige passiert.
 */
export function alsCss(): string {
  return `:root {
${regeln({ ...FARBEN_DUNKEL, ...SCHRIFT, ...MASSE })}
  color-scheme: dark;
}

:root[data-theme='hell'] {
${regeln(FARBEN_HELL)}
  color-scheme: light;
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme='dunkel']) {
${regeln(FARBEN_HELL)}
    color-scheme: light;
  }
}
`;
}
