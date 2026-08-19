# Frontend-Regeln — Material 3 Expressive in `klartext`

Verbindlich für alles unter `app/src/ui/` und `app/src/design/`.

## Tokens

`app/src/design/tokens.ts` ist die **einzige** Quelle für Farben, Maße,
Schriften und Federn. `vite.config.ts` erzeugt daraus beim Bauen das
`:root`-Regelwerk (virtuelles Modul `virtual:tokens.css`).

* Kein Farbwert und kein Abstand direkt in einer CSS-Datei oder in TypeScript.
  Immer `var(--kt-…)`.
* Fest verdrahtetes Weiß ist verboten. `rgba(255,255,255,…)` ist nur so lange
  eine Kontur, wie der Grund dunkel ist — im hellen Thema fehlt sie ersatzlos.
  Wer eine Aufhellung braucht, nimmt `color-mix(in srgb, var(--kt-text) N%,
  transparent)`; das kippt mit dem Thema.
* Legitime Ausnahmen: echte *On-Color*-Werte (Text auf farbiger Fläche, dafür
  gibt es `--kt-auf-akzent`, `--kt-auf-gefahr`, `--kt-auf-warnung`) und Weiß als
  Sachaussage.

## Kontrast

**Messen, nicht schätzen.** `app/tests/kontrast.test.ts` rechnet beide Themen
bei jedem Lauf nach, `npm run a11y` prüft zusätzlich im echten Browser.

* Fließtext ≥ 4,5:1 gegen **jeden** Untergrund, auf dem er vorkommt — auch
  `flaeche-hoch`, nicht nur `bg`.
* Große Schrift ≥ 3:1.
* **Grenzen von Bedienelementen ≥ 3:1** (WCAG 1.4.11). Die Umrandung eines
  Eingabefelds *ist* das Bedienelement; eine Kontur, die man nicht sieht, ist
  kein Feld, sondern eine Fläche, die man nicht findet. Beim ersten Anlauf lag
  `--kt-kontur-stark` bei 2,08:1 — das fiel nur auf, weil gemessen wurde.
* Wer im laufenden Browser misst: Farben nie per Regex zerlegen
  (`getComputedStyle` liefert auch `color(srgb 0.89 0.88 0.91 / 0.45)`),
  halbdurchsichtige Gründe über die Vorfahren rechnen, und **nie während einer
  View-Transition** messen — der Wechsel animiert, direkt danach misst man
  Zwischenbilder.

## Bewegung

Federn, keine Beschleunigungskurven. `app/src/motion/spring.ts`, Parameter aus
`FEDERN` in den Tokens.

* Eine Feder darf jederzeit ein neues Ziel bekommen und behält dabei ihre
  Geschwindigkeit. Eine `transition` müsste neu starten und wirkt abgehackt.
* `prefers-reduced-motion: reduce` schaltet **jede** Animation ab, nicht nur die
  auffälligen. `ruhigeDarstellung()` fragt das ab; `Feder.ziel()` springt dann.
* Zeitspannen im Integrator deckeln (`dt` auf 1/30 s): war der Tab im
  Hintergrund, sprengt der Zeitsprung sonst die Integration.
* **Bewegung darf nie eine Krypto-Operation aufhalten.** Das Zerfalls-Motiv
  läuft *nach* dem Worker-Ergebnis und rein kosmetisch. Höchstens ~300 animierte
  Zeichen; längere Texte animieren den sichtbaren Anfang und blenden den Rest
  über — sonst baut ein 40-kB-Text 40.000 DOM-Knoten.

## Themawechsel

Kreis-Aufblende über die View-Transitions-API.

⚠️ Der Standard-Übergang des Browsers **muss** dabei abgeschaltet werden
(`animation: none` und `mix-blend-mode: normal` auf `::view-transition-old(root)`
und `::view-transition-new(root)`, dazu `isolation: auto` auf dem
`image-pair`). Sonst blendet der Browser old und new zusätzlich ineinander und
legt sie mit `plus-lighter` übereinander: zwei volle Bilder addieren sich zu
einer ausgewaschenen Fläche, und im Kreis steht die falsche Farbe.

Die Regeln sind auf `.thema-wechsel` **gescoped** — global gesetzt verlöre ein
künftiger Seitenübergang seinen eigenen Standard-Fade.

## Markup

* **Kein `innerHTML`, kein `outerHTML`, kein `document.write`.** Die CSP
  verlangt Trusted Types. Alles wird über `ui/dom.ts` gebaut, Text landet immer
  über `textContent` im Dokument. Eine ESLint-Regel hält das fest.
* Kein `localStorage`/`sessionStorage` für irgendetwas, das mit Schlüsseln oder
  Passphrasen zu tun hat — ebenfalls per ESLint gesperrt.
* Trefferflächen ≥ 44 px. Eingabefelder mit `font-size: 16px`, sonst zoomt iOS
  beim Fokus hinein.
* Jedes Bedienelement ist mit der Tastatur erreichbar und hat einen sichtbaren
  `:focus-visible`-Ring.

## Typografie als Zustandsanzeiger

Proportionalschrift = Klartext. Festbreitenschrift = Ciphertext oder
Fingerprint. Der Wechsel ist keine Zierde, sondern die Information — man sieht
auf einen Blick, woran man ist, ohne ein Wort zu lesen.

## Sprache im UI

Deutsch. Jede Sicherheitsaussage ist ein Satz, den man nachprüfen kann.

Verboten und per Test gesperrt (`app/tests/errors.test.ts`): „militärisch",
„100 % sicher", „unknackbar", „absolut sicher", „bankensicher", „unhackbar",
„vollkommen anonym", „garantiert sicher".

Stattdessen konkret: „Dein Schlüssel liegt nur in diesem Browser."
„Dieser Kontakt ist nicht verifiziert — jemand könnte sich dazwischengeschaltet
haben."
