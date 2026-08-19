# CLAUDE.md — `klartext`

Hinweise für Claude Code (claude.ai/code) beim Arbeiten in diesem Repo.

> **Begriffsklärung:** `klartext` in Backticks meint die Anwendung.
> Klartext ohne Backticks meint unverschlüsselten Text.

## Was das ist

PGP-Werkzeug für den Browser, deutschsprachig, für den privaten Freundeskreis.
Zwei Betriebsarten:

* **Modus A — Werkzeug** (offline-fähig, ohne Server): Text und Dateien
  ver-/entschlüsseln, signieren, prüfen. Ergebnis ist ASCII-armored Ciphertext
  zum Kopieren.
* **Modus B — Relay** (freiwillig, Phase 4): eigener Zustellserver als
  Zero-Knowledge-Briefkasten. **Bequemlichkeit, kein Sicherheitsgewinn** — das
  muss das UI so sagen.

Ziel: `klartext.celox.io`. Plan und Phasen in `PLAN.md`, Grenzen in
`THREAT-MODEL.md`, Gestaltungsregeln in `.claude/rules/frontend-m3e.md`.

## Stand

**Phase 1 (Krypto-Kern) fertig.** Phase 2–5 offen, siehe `PLAN.md` §10.

## Architektur in einem Satz

Der **gesamte** Vault liegt im Web Worker — nicht nur die Krypto. Der
Main-Thread importiert `openpgp` nicht einmal und sieht nie einen privaten
Schlüssel oder eine Passphrase im Ruhezustand.

```
app/src/crypto/     Vertrag + Client. Enthält KEIN openpgp (per Test gepinnt).
app/src/worker/     Der einzige Ort mit openpgp. Vault, Schlüssel, Auto-Lock.
app/src/passphrase/ Vorschlagsgenerator + deutsche Diceware-Liste (7776 Wörter).
app/src/design/     tokens.ts = einzige Quelle für Farben/Maße/Federn.
app/src/ui/         Ansichten. Kein innerHTML, kein localStorage.
relay/              Phase 4.
fixtures/gpg/       Von echtem GnuPG erzeugte Testvektoren.
tools/e2e/          Browser-Prüfungen (Datenabfluss, Zugänglichkeit).
deploy/             nginx-vhost + Ausliefer-Anleitung.
```

## Die zwei S2K-Formate — der Kern des Ganzen

| Wo | Format | Warum |
|---|---|---|
| Vault (IndexedDB) | Argon2id + AEAD, 3 Durchgänge, 64 MiB | Stärkster Schutz gegen Offline-Rateangriffe |
| Export (`.asc`) | iterated+salted, Zähler 255, kein AEAD | **Das Einzige, was GnuPG annimmt** |

Gemessen, nicht vermutet — `gpg 2.5.21` (der neueste Zweig!) meldet beim Import
des Argon2+AEAD-Schlüssels „bearbeitete Schlüssel: 0" und beim
iterated+salted-Schlüssel „geheime Schlüssel importiert: 1". Argon2 erzwingt
AEAD, und AEAD auf v4-Schlüsseln ist ein Draft-Format, das GnuPG nicht liest.

Der Export re-verschlüsselt beim Speichern-Klick — das setzt ohnehin einen
entsperrten Vault voraus, kostet also nichts. Der Fingerprint bleibt gleich.

## Passphrasen-Vorschläge

Deutsche Diceware-Liste `de-7776-v1` (Herkunft, Lizenz und ein Befund zur
Wortauswahl in `app/src/passphrase/HERKUNFT.md`). 12,925 Bit je Wort, sechs
Wörter voreingestellt = 77,5 Bit.

**Die einzige Stelle, an der man hier leise falsch liegen kann, ist die
Gleichverteilung.** `zufall % 7776` ist verzerrt — 65536 = 8 × 7776 + 3328,
also kämen die ersten 3328 Wörter je neun statt acht Mal vor. Deshalb Rejection
Sampling, und der Test rechnet **alle 65536** Zwei-Byte-Werte durch, statt eine
Stichprobe zu ziehen.

⚠️ **Der erste Anlauf dieses Tests war wertlos** und blieb unter der Mutation
grün: er sortierte die zu verwerfenden Werte selbst vorher aus und maß damit die
eigene Annahme statt die Funktion. Jetzt zählt eine instrumentierte Quelle mit,
ob die Funktion einen Wert genommen oder verworfen hat.

**Nicht stillschweigend filtern.** Die App sagt „gleichverteilt über alle 7776
Wörter" zu; wer einzelne Wörter unterdrückt, macht diesen Satz zur Unwahrheit,
und niemand sähe es dem Ergebnis an. Begründung in `HERKUNFT.md`.

## Die E-Mail-Adresse ist optional

OpenPGP schreibt sie nirgends vor — **gemessen mit gpg 2.5.21**: ein Schlüssel
mit reinem Namen wird importiert, gelistet, und man kann an ihn verschlüsseln.
Sie ist eine Konvention aus der Zeit, als PGP fast nur für E-Mail benutzt wurde.

Hier ist die Identität der Fingerprint. Und die User-ID steht **unveränderlich
im öffentlichen Schlüssel**: jede Kopie trägt sie weiter, zurücknehmen lässt
sich das nicht. Deshalb steht sie in einem Ausklapp-Bereich mit genau dieser
Erklärung, statt als Pflichtfeld.

OpenPGP.js verwirft eine leere Adresse von selbst (`{name, email: ''}` → `"Name"`);
die Beschriftung im Vault muss das mitmachen, sonst steht dort `Name <>`.

## Regeln, die nicht verhandelbar sind

1. **Kein `openpgp` außerhalb von `app/src/worker/`.** Vier Tests halten das
   fest, einer davon gegen den gebauten Bundle.
2. **Kein `innerHTML`/`outerHTML`/`document.write`** (Trusted Types) — per
   ESLint gesperrt.
3. **Kein `localStorage`/`sessionStorage`** für Schlüssel oder Passphrasen —
   per ESLint gesperrt.
4. **Keine Fehlermeldung der Bibliothek durchreichen.** `crypto/errors.ts` hat
   eine geschlossene Liste deutscher Meldungen; der Originalfehler bleibt am
   `cause` und geht nie über die Worker-Grenze.
5. **Jede neue Laufzeit-Abhängigkeit braucht einen Absatz hier.** Aktuell gibt
   es genau eine: `openpgp`.
6. **Keine Analyse-Werkzeuge, keine fremden Server, keine Schriften von außen.**
   Auch kein Umami, obwohl es auf den anderen celox-Seiten läuft.

## Abhängigkeiten und ihre Begründung

**Laufzeit — genau eine:**

* `openpgp` 6.3.1 (LGPL-3.0+) — die Krypto. Wird als **eigener, unveränderter
  Chunk** ausgeliefert, nicht in den App-Bundle gemischt; das erfüllt die
  LGPL-Bedingung zum Neubinden. `klartext` selbst steht unter MIT.

**Entwicklung:**

* `vite`, `typescript`, `vitest`, `eslint`, `typescript-eslint` — Werkzeugkette.
* `fake-indexeddb` — Vault-Tests in Node.
* `playwright` — die zwei Browser-Prüfungen.
* `axe-core` — Zugänglichkeit. **Nicht Lighthouse:** das zieht ~292 MB mit,
  darunter `@sentry/node`, und `npm audit` meldete dafür 20 Schwachstellen
  (4 hoch). In einem Projekt mit der Zusage „keine Telemetrie" ist das die
  falsche Abhängigkeit, selbst als Dev-Werkzeug. axe-core ist die Engine, auf
  der Lighthouses Zugänglichkeits-Kategorie ohnehin beruht, und hat null
  Abhängigkeiten. Zum Zeitpunkt der Umstellung maß Lighthouse 100/100.
* `@openpgp/web-stream-tools` — **nur Typen.** OpenPGP.js verweist in seinen
  `.d.ts` darauf, installiert es aber nicht mit. `skipLibCheck` verschluckt das
  stillschweigend; die Folge ist, dass `decrypt().data` & Co. zum `error`-Typ
  werden und jede `no-unsafe-*`-Regel anschlägt. Ohne dieses Paket ist „kein
  `any` im Krypto-Pfad" nicht überprüfbar.
* `@types/node` — nur für Tests und Werkzeuge. `node:`-Importe sind in
  `app/src/**` per ESLint gesperrt.

## Befehle

```bash
npm run dev          # Entwicklungsserver
npm run build        # Bauen nach app/dist
npm run pruefe       # lint + typecheck + Tests  (vor jedem Commit)
npm run test:alles   # build + Tests + E2E + Zugänglichkeit
npm run e2e          # "nichts verlässt den Browser" im echten Chromium
npm run a11y         # WCAG 2.1 A+AA über 6 Zustände (3 × 2 Themen)
npm run fixtures     # GPG-Testvektoren neu erzeugen (braucht gpg)
```

## Tests — was wofür da ist

| Datei | Sichert |
|---|---|
| `gpg-interop.test.ts` | **Der Daseinsgrund.** Beide Richtungen gegen echtes GnuPG. |
| `s2k-formats.test.ts` | Die zwei S2K-Profile. Schnelle Gegenprobe zum Interop-Test. |
| `vault.test.ts` | Vault-Zustände, Import, Auto-Lock, Standardschlüssel. |
| `no-crypto-in-main.test.ts` | openpgp nur im Worker — Quelle **und** Bundle. |
| `errors.test.ts` | Keine Bibliotheksmeldung nach außen, kein Marketing-Wortlaut. |
| `kontrast.test.ts` | Beide Themen gegen WCAG-Schwellen. |
| `armor.test.ts` | gpg-Eigenheiten beim Einfügen (siehe unten). |
| `autolock.test.ts` | Der Sperr-Zeitgeber. |
| `passphrase.test.ts` | Gleichverteilung (vollständig durchgerechnet), Würfel-Zuordnung, Prüfsumme der Wortliste. |

**Regeln fürs Testschreiben in diesem Repo:**

* Textprüfungen auf Code laufen **gegen den kommentarfreien Quelltext**. Die
  Doku hier zitiert verbotene Begriffe wörtlich, um zu erklären, warum sie
  verboten sind — ein naiver Textvergleich schlägt daran an.
* **Jeden neuen Pin einmal mutieren.** Ein Test, den man nicht hat scheitern
  sehen, ist keine Zusicherung. Alle strukturellen Wächter hier sind so geprüft.
* Marker müssen eindeutig sein. Der erste Bundle-Test suchte nach
  `BEGIN PGP PRIVATE KEY BLOCK` — das steht völlig zu Recht als **Platzhalter**
  im Einfügefeld und damit im Haupt-Bundle. Jetzt zählen nur Bezeichner, die es
  außerhalb der Bibliothek nicht gibt, plus eine Größenschranke als zweiter,
  stumpfer Riegel.

## Fallstricke, die schon zugeschnappt sind

**GnuPG-Eigenheiten beim Einfügen.** Ein `.rev`-Widerrufszertifikat von gpg
trägt einen langen erklärenden Vorspann **und einen Doppelpunkt vor der
BEGIN-Zeile** — als Sicherung gegen versehentliches Anwenden. Ohne Behandlung
sieht der Nutzer nur „Unknown ASCII armor type" für eine Datei, die gpg völlig
regelkonform erzeugt hat. `entpackeArmorBlock()` in `worker/keys.ts` schneidet
den Block heraus und entfernt den Doppelpunkt; das hilft zugleich bei allem, was
aus einer Mail mit Zitatzeichen kopiert wurde. Bei Klartext-Signaturen zählt das
**letzte** END, sonst das erste.

**Fixtures sind locale-abhängig.** Ohne `LC_ALL=C` schreibt gpg den Vorspann in
der Sprache des Erzeugers — die Fixture sähe auf jedem Rechner anders aus.

**gpg schreibt Ergebnisse nach stderr.** „secret key imported", „Good
signature": alles stderr, stdout trägt nur die Nutzdaten. Wer nur stdout prüft,
bekommt einen leeren String und hält jeden Erfolg für einen Fehlschlag.

**`vi.useFakeTimers()` legt fake-indexeddb still.** Dessen Transaktionsschleife
braucht echte Timer; pauschal gefälscht wartet jede DB-Operation für immer und
die Suite hängt ohne Meldung. Nur `{ toFake: ['setTimeout', 'clearTimeout'] }`.

**Der Vault muss seine DB-Verbindung schließen.** Sonst blockiert ein
`deleteDatabase()` — oder eine Schema-Migration in einem anderen Tab.
`Vault.schliesse()`.

**Ein Statuswechsel darf einen Zwischenschritt nicht wegräumen.** Das Erzeugen
des ersten Schlüssels schaltet den Vault von „leer" auf „offen"; der
Statusbeobachter zeichnete daraufhin die Schlüsselliste und überschrieb die
Seite mit dem **Widerrufszertifikat**, bevor der Nutzer sie zu Gesicht bekam —
also ausgerechnet das, was man sofort sichern muss. Dagegen das Feld `#schritt`
in `SchluesselAnsicht`. Gefunden im echten Browserlauf; kein Node-Test hätte das
sehen können.

**Der Themawechsel braucht das Abschalten des Standard-Übergangs.** Siehe
`.claude/rules/frontend-m3e.md`.

**Vite bettet einen Worker als base64-`data:`-URL ein**, sobald sein Import
nicht mehr dem wörtlichen `new Worker(new URL('…', import.meta.url))` entspricht
— der eigene Chunk verschwindet dann, und mit ihm die Zusicherung, dass die
Krypto woanders liegt. Deshalb läuft der Import über `?worker&url`. Marker- und
Größenprüfung haben das NICHT bemerkt; es gibt jetzt einen eigenen Pin dafür.

**`require-trusted-types-for 'script'` blockiert den `Worker`-Konstruktor.**
Die App bringt eine Richtlinie mit (`klartext-worker`), die CSP lässt genau
diesen einen Namen zu. Der E2E-Testserver sendet dieselbe CSP wie nginx, damit
so etwas nicht erst in Produktion auffällt.

**`form.querySelector('button')` ist nicht der Absenden-Knopf**, seit der
Vorschlags-Knopf im Formular steht. Der falsche wurde deaktiviert und
umbeschriftet — immer `button[type=submit]`.

**Eine Größenschranke, die man bei jedem Anschlagen lockert, sichert nichts.**
Als die Wortliste dazukam, sprang der Einstiegspunkt auf 94 kB. Statt die
Schranke hochzusetzen, liegt die Liste jetzt in einem eigenen Chunk — wo sie
ohnehin hingehört — und die Schranke wurde auf 40 kB *verschärft*.

## Was noch nicht da ist

* Eigene Schriften (Inter + JetBrains Mono, OFL, auf Latein reduziert). Phase 1
  fährt Systemschriften; die Typografie trägt das Motiv erst ab Phase 2.
* Service-Worker / PWA — Phase 2.
* Das Zerfalls-Motiv (Klartext ↔ Ciphertext) — Phase 2, dort ist der Text.
* Alles zu Kontakten, Relay, Deployment — Phasen 3–5.
