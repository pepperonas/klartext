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

**Phase 1 (Krypto-Kern), Phase 2 (Werkzeug) und Phase 3 (Kontakte) fertig**,
dazu ein Benutzbarkeits-Durchgang (Phase 1.5). Phase 4 (Relay) und 5 (Härtung)
offen, siehe `PLAN.md` §10 und `PLAN-UX.md`.

Live unter [klartext.celox.io](https://klartext.celox.io/).

## Architektur in einem Satz

Der **gesamte** Vault liegt im Web Worker — nicht nur die Krypto. Der
Main-Thread importiert `openpgp` nicht einmal und sieht nie einen privaten
Schlüssel oder eine Passphrase im Ruhezustand.

```
app/src/crypto/     Vertrag + Client. Enthält KEIN openpgp (per Test gepinnt).
app/src/worker/     Der einzige Ort mit openpgp. Vault, Schlüssel, Auto-Lock.
app/src/passphrase/ Vorschlagsgenerator + deutsche Diceware-Liste (7776 Wörter).
app/src/trusted.ts  Trusted-Types-Richtlinie für BEIDE Skript-Adressen.
app/src/contacts/   QR-Encoder, Wortabgleich, Einladungslinks.
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

## Das Werkzeug erkennt, statt zu fragen

Keine Reiter für „verschlüsseln / entschlüsseln / signieren / prüfen". Wer etwas
eingefügt bekommt, weiß oft gar nicht, was es ist — er müsste den richtigen
Reiter erraten, bevor er anfangen kann.

Stattdessen ein Feld: `tool.erkenne` sagt, was drinsteckt (Nachricht ·
signierter Text · abgetrennte Signatur · öffentlicher Schlüssel · privater
Schlüssel · Klartext), und die Oberfläche bietet an, was damit geht. Sie sagt
auch, ob eine Nachricht überhaupt an einen der eigenen Schlüssel gerichtet ist.

**Signaturen kennen DREI Zustände, nicht zwei:** gültig · ungültig · Unterzeichner
unbekannt. Das dritte als „ungültig" darzustellen wäre eine Falschaussage — wir
können es schlicht nicht beurteilen.

⚠️ `signature.verified` ist ein Promise, das **wirft**, wenn die Signatur nicht
stimmt; es liefert nicht `false`. Wer den Fehler verschluckt, meldet jede
kaputte Signatur als gültig. `werteSignaturen` in `worker/werkzeug.ts` behandelt
das ausdrücklich, `tests/werkzeug.test.ts` pinnt es gegen echte gpg-Signaturen.

## Trusted Types: es gibt ZWEI Senken

`require-trusted-types-for 'script'` betrifft beide Stellen, an denen diese App
ein Skript lädt:

* `new Worker(url)` — der Krypto-Worker
* `navigator.serviceWorker.register()` — der Offline-Worker

⚠️ Der zweite war zunächst übersehen, und die Folge war heimtückisch: die App
lief, der Offline-Test lief (sein Server sendete keine CSP), und nur in
Produktion registrierte sich der Service Worker **still nicht** — der Flugmodus
hätte nie funktioniert. Aufgefallen ist es allein daran, dass der
Datenabfluss-Test die Browser-Konsole mitliest.

**Daraus die Regel: jeder Testserver sendet wortgleich dieselbe CSP wie nginx.**
`tests/vertrag.test.ts` vergleicht alle drei Stellen Direktive für Direktive.

## Offline heißt: die Assets müssen VOR dem Netzausfall im Cache sein

⚠️ Beim ersten Laden holt der Browser die Assets, bevor der Service Worker aktiv
ist — sie landen also nie in seinem Cache, und beim zweiten Aufruf ohne Netz
fehlt genau das JavaScript, das die App ausmacht. `tools/sw-manifest.mjs` trägt
deshalb nach jedem Build die tatsächlichen Dateinamen in den Service Worker ein
und leitet daraus zugleich die Cache-Version ab.

Die Shell läuft **network-first**: bei einer Krypto-App ist ein
hängengebliebener alter Stand kein Schönheitsfehler, sondern ein Problem — eine
ausgelieferte Korrektur muss ankommen. Nur `/assets/` (Inhalts-Hash im Namen,
also unveränderlich) läuft cache-first.

## Kontakte: unverifiziert ist der Normalfall

Nicht der Sonderfall. Ein über einen Kanal empfangener Schlüssel KANN
untergeschoben sein, und die Oberfläche markiert das **dauerhaft** — nicht nur
beim Anlegen.

**Ein Schlüsselwechsel wird nie stillschweigend übernommen.** Taucht unter
bekanntem Namen ein anderer Schlüssel auf, bekommt das eine eigene Ansicht mit
beiden Fingerprints nebeneinander. Von aussen ist „neuer Schlüssel derselben
Person" nicht von „jemand setzt sich dazwischen" zu unterscheiden — also
entscheidet der Mensch. Und der neue Schlüssel ist danach **wieder
unverifiziert**, auch wenn der alte es war; sonst erbte ein untergeschobener
Schlüssel das Vertrauen des echten.

## Der QR-Encoder ist selbst geschrieben

`app/src/contacts/qr.ts`, Byte-Modus, ISO/IEC 18004. Eine Bibliothek dafür
hiesse, für 300 Zeilen Algorithmus einen unbekannten Codepfad in eine App zu
lassen, deren Versprechen die kurze Abhängigkeitsliste ist.

⚠️ Die zwei grossen Tabellen (Blockaufteilung, Ausrichtungsmuster) sind
abgeschrieben und damit die wahrscheinlichste Fehlerquelle. **Zwei Prüfungen
decken sie ab, und zwar verschiedene Fehler** — an Mutationen gemessen:

| Fehler | `qr.test.ts` (geometrisch) | `npm run qr` (Decoder) |
|---|---|---|
| Zahlendreher in der Blocktabelle | **fängt ihn** | fängt ihn |
| verschobenes Ausrichtungsmuster | **grün!** | fängt ihn |

Der geometrische Test kennt nur die ANZAHL der Ausrichtungsmuster, nicht ihre
Lage: verschiebt man einen Punkt, bleibt die Codewortzahl gleich. Die eine
Prüfung ersetzt die andere also nicht. Ich hatte das zunächst stärker behauptet,
als es stimmt — erst die Mutationsprobe hat es gezeigt.

⚠️ `BarcodeDetector` gibt es nur auf macOS und Android; unter Linux (CI) fehlt
er. Deshalb läuft **jsQR** als plattformunabhängiger Zweitdecoder mit, und der
Bericht sagt, welche Decoder tatsächlich gelaufen sind — ein still
übersprungener Test wäre wertlos. Und: eine gleichförmige Nutzlast
(`'x'.repeat(n)`) bringt Apples Decoder bei Version 38 und 40 zum Aufgeben,
jsQR liest dieselben Symbole einwandfrei. Das Testmaterial ist deshalb
abwechslungsreich — so wie die base64-Nutzlasten, die klartext wirklich kodiert.

## Der Fingerprint reist NICHT im Einladungslink mit

Er wird beim Empfänger aus dem Schlüssel gerechnet. Ein mitgeschickter
Fingerprint wäre eine zweite Wahrheit neben dem Schlüssel — und zwei Wahrheiten
kann jemand auseinanderlaufen lassen. So ist ein Widerspruch strukturell
unmöglich.

⚠️ Die Nutzlast steht im **Fragment**. Fragmente schickt der Browser nie an
einen Server: kein Zugriffsprotokoll, kein Proxy-Mitschnitt, keine
Referrer-Zeile.

⚠️ **Kompaktes Binärformat, nicht JSON.** Der erste Anlauf packte den
ASCII-armored Schlüssel in JSON und kodierte das Ganze noch einmal base64 — ein
RSA-4096-Link wurde **4606 Zeichen** lang. Jetzt sind es 3137, und selbst das
passt in KEINEN QR-Code (Höchstmass 2953 Byte). Curve25519 wiegt 685 Zeichen
und passt bequem. Die App sagt das im Klartext und macht daraus ein echtes
Argument für Curve25519.

## Die Wortliste ist deutsch, nicht die PGP Word List

⚠️ **Abweichung von meiner Empfehlung aus Phase 0.** Dort hatte ich die
englische PGP Word List vorgeschlagen. Die deutsche `de-7776-v1` liegt aber
bereits im Repo, mit Prüfsumme festgenagelt und ohne Umlaute — für deutsche
Ohren am Telefon das bessere Werkzeug. Interop-Zwang gibt es keinen: GnuPG kennt
gar keine Wortliste für Fingerprints. Eine zweite Liste hätte 512 abgeschriebene
englische Wörter bedeutet, also eine zweite Fehlerquelle für nichts.

Verfahren: der Fingerprint als 160-Bit-Zahl in Basis 7776 — 13 Wörter tragen
168 Bit. Umkehrbar, über tausend Zufallswerte hin und zurück geprüft.

## Wegfindung — keine Sackgassen

`tools/e2e/wegfindung.mjs` läuft alle zehn Zustände ab und verlangt für jeden:
eine Überschrift, die sagt wo man ist · mindestens einen Weg heraus · keinen
sichtbaren Knopf, der nichts tut · eine funktionierende Zurück-Geste.

Anlass war die Frage „wie komme ich hier zurück?". Im gesperrten Zustand gab es
genau einen Handgriff und keinen Ausweg — und der Knopf „Sperren" stand
weiterhin in der Kopfzeile, obwohl schon gesperrt war. Dabei sind **öffentliche
Schlüssel nicht geheim** und lassen sich auch gesperrt lesen und ausgeben; die
App verweigerte das grundlos. Jetzt bleibt die Schlüsselliste sichtbar, nur eben
gesperrt.

⚠️ Beim allerersten Lauf fand dieser Test sofort eine echte Attrappe: dem
„Weiter" im Widerrufs-Schritt fehlte der Klick-Handler. Der Knopf sah aus wie
ein Weg nach vorn und tat nichts.

## Die Passphrase ist KEIN Seed

Der schwerwiegendste Irrtum, den diese App zulassen könnte:

| | Wallet-Seed (BIP-39) | Passphrase hier |
|---|---|---|
| Was er tut | **erzeugt** den Schlüssel neu | **entsperrt** einen gespeicherten |
| Browserdaten weg | egal | **Schlüssel unwiederbringlich weg** |
| Reicht als Backup | ja | **nein** |

Wer die sechs Wörter für ein Backup hält, verliert die Schlüssel beim ersten
gelöschten Browserprofil — mit dem Zettel in der Hand. Deshalb: der geführte
Ablauf endet mit einem Backup-Schritt, `KeyInfo.hasBackup` wird im Vault
festgehalten (gesetzt beim erfolgreichen Export des privaten Schlüssels), und
die Schlüsselkarte mahnt dauerhaft, solange keine Sicherung existiert.

## Sicherung der Passphrase wird NACHGEWIESEN

Ein Haken „Ich habe sie notiert" ist eine Selbstauskunft, die man in zwei
Sekunden setzt. Und das Wiederholfeld prüfte nichts mehr, sobald der Vorschlag
es mitfüllte. Deshalb fragt Schritt 4 **drei Wörter nach Position** ab
(`passphrase/pruefung.ts`), wie es Wallets tun.

⚠️ `waehlePositionen` ist ein teilweises **Fisher-Yates-Mischen**, nicht
„ziehen, bis genug Verschiedene beisammen sind". Die naive Fassung dreht sich
ewig, sobald die Quelle nicht genug verschiedene Werte hergibt — beim ersten
Testlauf hing die Suite, statt fehlzuschlagen. Im Formular wäre es ein
eingefrorener Schritt ohne Fehlermeldung gewesen.

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
npm run relay        # Zustellung über zwei echte Browser gegen ein gebautes Relay
npm run reproduzierbar  # zweimal bauen, Byte für Byte vergleichen
npm run kopfzeilen   # Kopfzeilen der LAUFENDEN Seite (nach jedem Deploy)
npm run erster-nutzen   # verschlüsseln ohne eigenen Schlüssel, gegen echtes gpg
npm run bilder       # die Bilder der README aus der gebauten App erzeugen
SCHRITTE=1 npm run relay   # Zustellung mit Fortschrittsanzeige (bei zwei Browsern Gold wert)
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
| `pruefung.test.ts` | Die Wortabfrage — inklusive Terminierung bei einer bösartigen Zufallsquelle. |
| `router.test.ts` | Pfade hin und zurück; nie ein Geheimnis in der Adresse. |
| `werkzeug.test.ts` | Das Werkzeug gegen echtes GnuPG, beide Richtungen. Erkennung, Signaturzustände, Rundlauf. |
| `zerfall.test.ts` | Die Animation darf den Inhalt nie antasten. |
| `trusted.test.ts` | Die Trusted-Types-Richtlinie lässt nur die zwei bekannten Adressen durch. |
| `sw.test.ts` | Service-Worker-Vertrag: network-first, nur eigene Herkunft, Cache-Abräumung. |
| `client.test.ts` | RPC-Zuordnung bei vertauschten Antworten, Sperr-Auslöser. |
| `idb.test.ts` | Der Migrationspfad — hier verliert man Nutzerdaten, ohne es zu merken. |
| `dom.test.ts` | Der `el()`-Helfer parst nie; dazu Quelltext-Zusicherungen (kein innerHTML, kein localStorage). |
| `tokens.test.ts` | Beide Themen vollständig, keine fest verdrahteten Farben im Stylesheet. |
| `spring.test.ts` | Der Feder-Integrator — Stillstand bei reduzierter Bewegung, kein NaN nach Tabwechsel. |
| `nav.test.ts` | Navigationsleiste und Sperr-Anzeige. |
| `qr.test.ts` | Die zwei abgeschriebenen Tabellen prüfen sich gegenseitig, für alle 40 Versionen. |
| `wortabgleich.test.ts` | Fingerprint ↔ Wörter, über tausend Werte umkehrbar. |
| `einladung.test.ts` | Nutzlast im Fragment, Ablauf, Länge, kein Vorbeilesen am Puffer. |
| `kontakte.test.ts` | Schlüsselwechsel wird gemeldet, nie stillschweigend übernommen. |
| `vertrag.test.ts` | Zusicherungen ÜBER Dateigrenzen: CSP dreifach gleich, openpgp nur im Worker, keine stillen Kanäle, eine Laufzeit-Abhängigkeit, Baukennung ↔ `build.json` ↔ Dateien, Reihenfolge der Nutzergeste, eine zugesagte Signatur wird nie weggelassen. |
| `kennung.test.ts` | **Der Vertrag zwischen App und Relay** — beide Ableitungen gegeneinander gerechnet, nicht gegen einen Nachbau. |
| `verlauf.test.ts` | Der lokale Verlauf: Ciphertext auf der Platte, Reihenfolge, und dass ein kaputter Eintrag den Rest nicht mitnimmt. |
| `schritte.test.ts` | Die Fortschrittsanzeige — vor allem ihre ARIA-Zusagen, denn die SIND für manche die Anzeige. |
| `doku.test.ts` | Die README gegen das Repo: Badge-Zahlen, Bilder, Verweise, Befehle. |
| `vorstellung.test.ts` | Das Format der Vorstellung — Fingerprint aus dem Schlüssel gerechnet, privater Schlüssel abgewiesen. |
| `waechter.test.ts` | Der Postfachwächter: nur entsperrt, nur einer, richtet ein, holt Vorgemerktes nach. |
| `sicherung.test.ts` | Die Vollsicherung: verschlüsselt, ergänzt statt zu ersetzen. |
| `build-kennung.test.ts` | Die Kennung kommt vom Server — also geprüfte Form oder gar nichts. |
| `datei-ziel.test.ts` | Der Weg auf die Platte, vor allem: jeder Fehlweg endet im Blob-Rückfall. |

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

## Die Dokumentation wird geprüft wie Code

`doku.test.ts` rechnet die README gegen das Repo: die Zahl im Tests-Badge, die
Zahl im Abhängigkeits-Badge, ob jeder verlinkte Pfad existiert, ob jeder
genannte `npm run …`-Befehl in `package.json` steht, ob jedes Bild vorhanden ist
und beschrieben wird.

⚠️ Grund: **eine getippte Zahl veraltet still.** Es geht nichts kaputt, niemand
merkt es, und das Repo behauptet einfach etwas Falsches. Genau so stand im
Info-Screen „kommt in Phase 4", als Phase 4 lief.

⚠️ Beim Testschreiben selbst gelernt: das Tests-Badge lässt sich aus dem
Quelltext nur als **Untergrenze** zählen — `it.each` erzeugt zur Laufzeit mehr
Tests, als dort zu sehen sind. Statt eine willkürliche Spanne zu erfinden,
benennt der Test die Eigenschaft, die wirklich gilt: das Badge darf nie weniger
nennen als statisch zählbar und höchstens ein Drittel darüber liegen.

**Die Bilder werden erzeugt, nicht gemalt** (`node tools/bilder.mjs`): aus der
gebauten App, im echten Browser, mit einem Wegwerf-Schlüssel. Ein montiertes
Bild wäre eine Zusage, die der Quelltext nicht einlöst. Ein Test prüft ausserdem,
dass in keinem Bild ein privater Schlüssel steckt und keines über 150 kB wiegt —
GitHub zeigt sie mit rund 880 px, alles darüber ist Ballast (erster Anlauf:
1,2 MB bei Faktor 2, jetzt 260 kB bei Faktor 1,5 plus `pngquant`).

## Drei Mutationsproben, die MEINE Tests widerlegt haben

Alle drei sahen aus wie gute Tests und waren keine:

1. **Der Vertrag App ↔ Relay prüfte sich selbst.** Mein „unabhängiger Nachbau"
   der Relay-Ableitung importierte den Präfix aus dem **App**-Modul — beide
   Seiten bewegten sich also gemeinsam. Mutation (Präfix auf v2) ⇒ grün. Jetzt
   wird die **echte** Relay-Funktion importiert und gegengerechnet; dieselbe
   Mutation ⇒ 3 Tests rot.
2. **Die Sortierung des Verlaufs war nie geprüft.** Meine Testdaten hiessen
   `id-<zeit>-…`, und IndexedDB liefert nach Schlüsselreihenfolge — die stimmte
   zufällig mit der Zeit überein. Mutation (Sortierung entfernt) ⇒ grün. Jetzt
   läuft die Schlüsselreihenfolge der Zeit **entgegen**.
3. **Die Attrappe verletzte die geprüfte Eigenschaft.** Der Ersatz-Ciphertext
   hiess `GEHEIM:<klartext>` — und der Test wollte belegen, dass kein Klartext
   auf der Platte landet. Er stand dort, weil ich ihn hineingeschrieben hatte.

Die Lehre ist nicht „mehr mutieren", sondern: **die Probe muss die Eigenschaft
treffen, die der Test behauptet** — und der Test darf seinen Gegenstand nicht
selbst herstellen.

## Namen ändern, und was dabei örtlich bleibt

Eigene Schlüssel und Kontakte lassen sich umbenennen — **örtlich**. Die
User-ID steht unveränderlich im öffentlichen Schlüssel und reist mit jeder
Kopie mit; was hier geändert wird, sieht nur der eigene Schlüsselbund. Die
Schlüsselkarte zeigt deshalb beides: den eigenen Namen als Überschrift und
darunter „Andere sehen: …", sobald es abweicht.

⚠️ Zwei Befunde dabei: die Karte zeigte `userIds[0] ?? label` — die
Beschriftung wurde also nie angezeigt, solange es eine User-ID gab, und eine
Umbenennung wäre unsichtbar geblieben. Und `kontakte.umbenennen` lag seit
Phase 3 fertig und getestet im Worker, **ohne dass eine Ansicht es aufrief**:
eine gebaute Fähigkeit, die niemand erreichen kann.

## Die Schlüsselsicherung enthält keine Gespräche

Sie ist ein OpenPGP-Export, damit GnuPG sie lesen kann — also nur der
Schlüssel. Wer die Browserdaten löscht, bekommt damit den Schlüssel zurück und
**kein einziges Gespräch**. Der Relay kann das nicht auffangen (nur Ciphertext,
sieben Tage).

Dafür gibt es jetzt `worker/sicherung.ts`: Kontakte und Verlauf als eigene
Datei, **an den eigenen Schlüssel verschlüsselt** — ohne ihn ist sie ein Haufen
Zufall. Sie **ergänzt beim Einspielen und ersetzt nie**: eine alte Sicherung
darf keinen neueren Kontakt zurückdrehen und keine Vertrauensmarkierung
verlieren. Der Verlauf wandert wörtlich als Ciphertext hinein, wird also nicht
entschlüsselt und neu verschlüsselt.

⚠️ Sie steht bewusst in den Einstellungen und nicht neben der
Schlüsselsicherung — sonst hält jemand seine Gespräche für gesichert, weil er
„eine Sicherung" hat.

## Eine ankommende Nachricht gehört dem ABSENDER

⚠️ **Der schwerste Fehler dieser Sitzung.** `holeNeues(eigener, kontaktFingerprint)`
schrieb jede abgeholte Nachricht dem Gespräch zu, das gerade **offen** war. Das
Postfach gehört einem selbst, und jeder darf hineinschreiben — sobald man mit
zwei Leuten schrieb, landete Bobs Nachricht bei Carol. Nichts stürzte dabei ab.

Wer der Absender ist, steht in der **Signatur**; dafür muss entschlüsselt
werden, also entscheidet das der Worker (`vault.nimmAn`). Nur eine **gültige**
Signatur ordnet zu — „Unterzeichner unbekannt" heisst gerade, dass man es nicht
weiss, dann wird auch nicht geraten. Was sich nicht zuordnen lässt, kommt unter
`UNBEKANNTER_ABSENDER`: nicht weggeworfen (eine verlorene Nachricht ist
schlimmer als eine unsortierte) und nicht irgendwo einsortiert (eine falsch
einsortierte ist am schlimmsten).

Dass `kontaktFingerprint` als Parameter überflüssig wurde, ist der Beweis, dass
der Fehler weg ist — der Compiler hat ihn als ungenutzt gemeldet.

## „Hat deine Einladung angenommen" — der Weg dorthin

Drei Dinge mussten zusammenkommen, und jedes einzelne fehlte:

1. **Ein Rückweg.** Wer eine Einladung annimmt, legt seinen eigenen Schlüssel
   als *Vorstellung* in das Postfach des Einladenden. Dessen Kennung lässt sich
   aus dem Fingerprint rechnen — es braucht keinen Rückkanal.
2. **Jemanden, der abholt.** Das Abholen lag allein in der Gesprächsansicht.
   Wer noch keinen Kontakt hat, öffnet nie ein Gespräch — und hätte es nie
   erfahren. Dafür gibt es jetzt den `Postfachwaechter`, der läuft, solange der
   Bund offen ist. ⚠️ Er richtet das Postfach auch gleich ein: das geschah
   vorher ebenfalls erst beim Öffnen eines Gesprächs.
3. **Einen Zeitpunkt, zu dem signiert werden kann.** Der Einladungslink lädt
   die Seite neu — danach ist der Bund **gesperrt**, und eine Vorstellung muss
   unterschrieben werden. Sie wird deshalb vorgemerkt
   (`settings.offeneVorstellungen`) und geht beim nächsten Entsperren raus.

⚠️ Sie wird **nie stillschweigend zum Kontakt**. Jeder mit deinem öffentlichen
Schlüssel darf dir schreiben; würde ein eingehender Schlüssel ungefragt
eingetragen, könnte jeder eine Kontaktliste mit frei gewählten Namen befüllen —
und der Fingerprint-Abgleich wäre genau dort ausgehebelt, wo er zählt. Sie
landet in einem **eigenen Speicher** (`STORE_INTROS`, Schema v4), nicht bei den
Kontakten: dort würde sie sofort zum Prüfen von Signaturen herangezogen.

⚠️ `oeffentlicheZu` sucht nur in den **eigenen** Schlüsseln. An einen Kontakt
verschlüsselt man über `anArmored` mit dessen Schlüssel — mit `anFingerprints`
scheitert es an `KEY_NOT_FOUND`, und weil der Aufrufer den Fehlschlag nur als
„nicht zugestellt" verbuchte, blieb die Vorstellung stumm liegen.

Live geprüft: Alice sieht die Vorstellung **2 s** nachdem Bob entsperrt, ohne
selbst etwas zu tun (`npm run relay`, 14 Kriterien).

## Eine Einladung geht nur in EINE Richtung

Sie trägt den Schlüssel dessen, der sie schickt. Wer sie annimmt, sieht den
Absender — der Absender sieht ihn deswegen **nicht**. Gemeldet als „der neue
Kontakt sieht mich, aber ich sehe ihn nicht": kein Fehler, aber es stand
nirgends. Beide Schirme sagen es jetzt, und nach dem Aufnehmen bietet die App
die Gegeneinladung direkt an, statt wortlos in die Liste zu springen.

**RSA und Curve25519 vertragen sich vollständig** — mit echtem gpg in beide
Richtungen geprüft, inklusive Signaturen und einer Nachricht an beide zugleich
(zwei Empfänger-Pakete in einem Block). Das Verfahren gehört zum Schlüssel, nicht
zur Verbindung.

## Der ganze Text bewegt sich, nicht nur der Anfang

`MAX_ZEICHEN = 300` hiess: bei einem PGP-Block bewegten sich die ersten drei
Zeilen, der Rest blendete als Klotz über — für den Betrachter sah das aus, als
sei die Animation kaputt (so gemeldet).

Der Deckel war trotzdem richtig gedacht: 40.000 Spans für einen 40-kB-Text sind
ein Ruckler. Er begrenzt jetzt die **Knoten** (`MAX_KNOTEN = 1200`), nicht den
Text: bis zum Budget ein Knoten je Zeichen, darüber fasst ein Knoten mehrere
Zeichen zusammen und fliegt als Einheit. Ein 40-kB-Text bewegt sich damit
vollständig. Dauer 400 → 1400 ms, Streuung und Drehung rund verdoppelt,
Deckkraft ab 0 statt 0,15. Im Browser gemessen: 656 von 656 Zeichen in
Bewegung, kein unbewegter Rest.

⚠️ Dabei ein alter Fund: dort stand `richtung === 'zerfall' ? 1 - p : 1 - p` —
**zwei identische Zweige**. Die Richtung tat nie etwas, obwohl die Doku seit
Phase 2 einen Unterschied verspricht. Beide Fälle sahen für sich richtig aus,
deshalb fiel es nie auf. Jetzt läuft die Welle beim Verschlüsseln von oben nach
unten und beim Entschlüsseln von unten nach oben, und der Aufbau dreht die
Stücke kaum — er rastet ein, statt zu zerfallen.

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

**Vite bettet Worker als `data:`-URL ein, wenn das Muster nicht stimmt** — siehe
oben. Der Import läuft deshalb über `?worker&url`.

**`ergebnis.filename` ist nicht immer eine Zeichenkette.** Bei Nachrichten ohne
Literal-Dateinamen — also bei allem, was klartext selbst erzeugt — kommt `null`.
Ein `.length` darauf ließ jede eigene Nachricht beim Entschlüsseln platzen; vom
Rundlauf-Test gefunden.

**Ein Klick-Handler gehört VOR jedes frühe `return`.** Zweimal ist derselbe
Fehler passiert: ein Knopf sah aus wie ein Weg nach vorn und tat nichts (Widerruf
und der Zweig „selbst getippte Passphrase"). Gefunden von `wegfindung.mjs` und
`offline.mjs` — die anderen Läufe kamen an diesen Zweigen nie vorbei.

**Ein Teilzeichenketten-Wächter schlägt Fehlalarm.** Die Telemetrie-Prüfung
suchte `gtag` als Teilzeichenkette und traf `gueltigTage` — kleingeschrieben
steckt es darin. Ein Wächter mit Fehlalarmen wird irgendwann abgeschaltet, und
dann bewacht er nichts mehr. Immer mit Wortgrenzen.

**Die Kamera muss ausdrücklich abgeschaltet werden.** `getTracks().stop()` beim
Verlassen der Ansicht — ein weiterlaufender Kamerastrom hinter einer
geschlossenen Ansicht wäre unentschuldbar und sieht man der App nicht an.
`main.ts` ruft `kontakte.verlasse()` bei jedem Wegnavigieren.

**`aria-hidden` allein reicht nicht.** Ein `<input type=file>` bleibt
fokussierbar; für Hilfsmittel unsichtbar, per Tabulator erreichbar ist eine
Falle. Es braucht zusätzlich `tabindex="-1"`.

**Eine Größenschranke, die man bei jedem Anschlagen lockert, sichert nichts.**
Zweimal ist sie angeschlagen, weil die App legitim wuchs (Wortliste, dann Router
und Ansichten). Gemeint war nie eine Kilobyte-Zahl, sondern „hier kann keine
Kryptobibliothek drinstecken" — deshalb ist sie jetzt **relativ**: der
Einstiegspunkt muss unter einem Viertel des Chunks liegen, der openpgp
nachweislich enthält. Damit wächst sie mit.

**Der Deploy einer nginx-Datei kann TLS abräumen.** Die Repo-Fassung endete mit
einem Kommentar „certbot trägt hier listen/ssl_certificate ein" — die Zeilen
standen also nur auf dem Server. Ein `scp` der Datei hat sie gelöscht: der vhost
horchte danach nur noch auf Port 80, HTTPS fiel auf den Standard-Server durch,
und der Browser zeigte ein gültiges Zertifikat für eine **völlig fremde Domain**
(`ERR_CERT_COMMON_NAME_INVALID` — derselbe Fehler, den der Nutzer schon einmal
gemeldet hatte; er war nie behoben, nur überdeckt). `nginx -t` sagt dazu nichts,
denn die Datei ist syntaktisch tadellos. Die TLS-Zeilen stehen jetzt **im Repo**,
inklusive `listen 443 ssl http2;` (nginx 1.24 kennt `http2 on;` nicht) und einem
eigenen Port-80-Block, dessen ACME-Ort **vor** der Weiterleitung steht. Regel:
was ein Deploy überschreibt, muss vollständig im Repo stehen — sonst ist der
Server die Quelle der Wahrheit, und die überlebt keinen Deploy.

**Einen Dienst zu starten ist nicht dasselbe wie ihn laufen zu sehen.** Der Relay
lief zuerst auf Port 4264, wo bereits gunicorn horchte. `systemctl enable --now`
meldete nichts, `is-active` sagte `activating` — nicht `failed`, weil `Restart=`
den Dienst alle fünf Sekunden neu warf. Er hätte sich beliebig lange so gedreht.
Die Portliste in der Haus-Doku war nicht aktuell (4263 war frei laut Doku, in
Wirklichkeit belegt). Also: Port selbst erheben
(`ss -tlnp | grep -oE '127\.0\.0\.1:4[0-9]{3}' | sort -u`), und nach dem Start
den **Zustand** prüfen, nicht den Rückgabewert des Startbefehls. Jetzt: **4265**.

**Die Relay-Datenbank gehört NICHT in die Nachtsicherung.** Sie hält nur
Ciphertext mit sieben Tagen Verfallszeit und `secure_delete = ON`. Die
VPS-Routine sammelt SQLite-Dateien unter `/opt` automatisch ein — sie hätte
Kopien angelegt, die die Verfallszeit um Monate überdauern, in einem Archiv, das
die App nicht kontrolliert. Ausnahme steht in `vps-data-backup.sh`. ⚠️ Dabei
selbst hineingetappt: die eingefügte Zeile endete auf `\\` statt `\`. In bash ist
das kein Umbruch, sondern ein Backslash als Argument — `bash -n` findet das
nicht, denn es ist gültige Syntax mit falscher Bedeutung. Erst der **Probelauf
der Funktion** zeigte es (14 Datenbanken gesichert, klartext nicht dabei).

**Der Server prüft nicht, ob das Eingeworfene verschlüsselt ist.** Nachgestellt
mit `curl`: ein blanker Probetext lag danach lesbar in der Datenbank. Das ist
richtig — dafür müsste er hineinsehen — aber es gehört gesagt, und steht jetzt im
THREAT-MODEL und im Info-Screen. Der E2E-Test „die Datenbank enthält KEINEN
Klartext" trägt trotzdem, weil dort die **App** verschlüsselt, bevor etwas geht.

**Eine getippte Zahl ist keine Verknüpfung.** Der Test „der Info-Screen nennt
alle acht Grenzen" pinnte die Acht als Literal — er sagte damit nur, dass sich
die App nicht geändert hat, nicht dass sie zum THREAT-MODEL passt. Deshalb
konnte im Info-Screen „kommt in Phase 4" stehen bleiben, als Phase 4 lief. Die
Erwartung kommt jetzt aus dem Dokument (`## \d+\.`-Abschnitte zählen), dazu ein
Wächter gegen Versprechen für später. Mutationsprobe: einen Eintrag entfernen
⇒ rot.

**Und der Gegenbefund zur Mutationsprobe:** meine erste Probe für genau diesen
Test war *falsch gewählt* (ich benannte einen Titel um, statt die Anzahl zu
ändern) und blieb folgerichtig grün — worauf ich den Test beinahe für untauglich
erklärt hätte. Eine grüne Mutationsprobe kann auch heißen, dass die Mutation am
Gegenstand vorbeigeht. Die Probe muss die Eigenschaft treffen, die der Test
behauptet.

## Der Build-Hash macht Grenze 1 überprüfbar — mehr nicht

Threat-Model Nr. 1 lautet: der Server liefert bei jedem Aufruf den Code aus, der
die Schlüssel anfasst. Dagegen hilft keine Technik im Browser. Was hilft, ist
**nachrechnen können**:

* `tools/build-hash.mjs` schreibt beim Bauen `build.json` (ein SHA-256 je
  ausgelieferter Datei plus ein Gesamt-Hash über Namen *und* Inhalte) und trägt
  den Gesamt-Hash als `<meta>` in die index.html. Der Info-Screen zeigt die
  ersten zwölf Stellen.
* `npm run reproduzierbar` baut zweimal von Grund auf und vergleicht. Ohne diese
  Messung wäre der Hash eine Behauptung.
* `integrity` steht an allem, was direkt im Markup hängt (Einstiegspunkt,
  `modulepreload`, Stylesheet).

⚠️ **Was das NICHT ist.** Die Zahl steht in derselben Datei, die der Server
geschickt hat — ein Server, der falschen Code ausliefert, kann auch eine falsche
Zahl ausliefern. Der Wert liegt darin, dass eine Abweichung *überhaupt* auffallen
kann: bei halbem Deploy, kaputtem Zwischenspeicher, und für jeden, der von aussen
nachrechnet. Der Info-Screen sagt genau das, mit dem Befehl daneben. Eine
Selbstprüfung im Browser gibt es bewusst nicht — eine Prüfung, die der Geprüfte
selbst durchführt, ist keine.

⚠️ SRI deckt **nicht** ab: den Krypto-Worker (`new Worker()` kennt kein
`integrity`), dynamisch nachgeladene Chunks (SRI erbt sich nicht) und den
Service Worker. Dafür ist `build.json` da.

## Kopfzeilen werden an der laufenden Seite gemessen

`tests/vertrag.test.ts` hält die CSP an drei Stellen im Repo deckungsgleich. Das
sagt nichts darüber, ob der Server sie auch anwendet — und genau dort ist schon
etwas durchgerutscht (der Deploy, der TLS abräumte). `npm run kopfzeilen` misst
deshalb gegen die echte Seite: CSP Direktive für Direktive, HSTS, Referrer,
Permissions-Policy, dazu Baukennung, `integrity` und ob eine ausgelieferte Datei
wirklich zu ihrem Eintrag in `build.json` passt.

⚠️ Beim ersten Lauf hätte dieser Test beinahe selbst falsch beruhigt: der vhost
hat einen SPA-Rückfall auf index.html, also antwortet er auf eine **fehlende**
Datei mit HTTP 200 und HTML. `response.ok` war wahr, `build.json` war nicht da.
Jetzt wird zusätzlich der `content-type` geprüft.

## Grosse Dateien: die zweite Kopie fällt weg, nicht die erste

Ab 64 MB fragt die Oberfläche über die File System Access API nach einem Ziel und
schreibt direkt dorthin. Das spart die Blob-Kopie — bei einer halben Gigabyte
ist das der Unterschied zwischen „geht" und „der Tab stirbt".

⚠️ **Kein Streaming.** Die Verschlüsselung reicht das ganze Ergebnis als
`Uint8Array` über die Worker-Grenze; die Datei liegt weiterhin vollständig im
Speicher. Gespart wird die zweite Kopie. Die Oberfläche behauptet auch nichts
anderes.

⚠️ **`showSaveFilePicker()` verlangt eine frische Nutzergeste** (wenige
Sekunden). Wer den Dialog erst *nach* dem Verschlüsseln öffnet, bekommt bei
grossen Dateien verlässlich einen `SecurityError` — also ausgerechnet dort, wo
der direkte Weg etwas bringt. Deshalb wird das Ziel **vorher** erfragt; ein Pin
in `vertrag.test.ts` hält die Reihenfolge fest.

⚠️ Jeder Fehlweg endet im Blob-Rückfall: abgebrochen, Geste verfallen, Platte
voll, Ort weg. Eine fertig entschlüsselte Datei darf daran nicht verlorengehen.
Das liess sich **nicht** mit einem Textvergleich sichern (nach der Mutation stand
der Rückfall immer noch daneben, nur unerreichbar — der Test blieb grün), also
liegt die Logik in `ui/datei-ziel.ts` und wird im Verhalten geprüft.

## Eigene Schriften

Inter (variabel) und JetBrains Mono, beide OFL, auf Latin-1 zugeschnitten:
zusammen 122 kB statt 352 kB allein für Inter. Herkunft, Lizenz und der
Zuschnitt-Befehl in `app/public/schriften/HERKUNFT.md`.

⚠️ Der Schnitt ist **bewusst nicht enger**. Die Proportionalschrift zeigt auch
entschlüsselte fremde Texte und Kontaktnamen; ein engerer Schnitt liesse
einzelne Zeichen mitten im Absatz auf die Systemschrift zurückfallen. Der
Ersatzstapel bleibt vollständig stehen — er trägt die Seite, solange geladen
wird (`font-display: swap`, nicht `block`: eine Krypto-App, die drei Sekunden
leere Kästen zeigt, während man eine Fehlermeldung erwartet, ist schlechter als
eine, die kurz in der Systemschrift erscheint).

⚠️ `crossorigin` gehört auch bei gleicher Herkunft an den Vorabruf — Schriften
werden immer im CORS-Modus geholt, ohne das Attribut lädt der Browser die Datei
zweimal.

⚠️ **Breitenmessung taugt hier nicht als Nachweis:** JetBrains Mono und die
System-Festbreitenschrift haben beide 0,6 em Vorschub, 19 Zeichen ergeben in
beiden Fällen exakt 1140 px. Ich hätte eine Übereinstimmung gemessen, die nichts
über die geladene Schrift sagt. `document.fonts.check()` beantwortet die Frage
direkt; die Gewichtsachse zeigt sich dagegen sehr wohl in der Breite (991 → 1084).

## Der erste Nutzen kommt vor der Verpflichtung

**Um jemandem etwas zu verschlüsseln, braucht man keinen eigenen Schlüssel** —
nur den öffentlichen des Gegenübers. Dasselbe gilt fürs Prüfen einer Signatur.
Der Krypto-Kern konnte das immer (`signiereMit: null` plus eingefügter fremder
Schlüssel); allein die Oberfläche verbot es, mit einem Satz, der zur Hälfte
unwahr war („Ohne Schlüssel gibt es nichts zu ver- oder entschlüsseln").

Jetzt steht das Werkzeug offen, und gesperrt ist nur, was wirklich einen eigenen
Schlüssel braucht — mit dem Grund daneben. `tools/e2e/erster-nutzen.mjs` hält
das fest: ohne je einen Schlüssel anzulegen einen fremden einfügen, tippen,
verschlüsseln — und der Block wird von **echtem gpg** im Wortlaut gelesen. Dazu
die Gegenprobe, dass Entschlüsseln und Signieren gesperrt bleiben.

⚠️ Beim Schreiben dieses Laufs zweimal danebengegriffen: das Ergebnis steht in
einem `<pre>`, nicht in einem `textarea`, **und** `textContent` liefert die
Zeilenumbrüche nicht (die Zerfalls-Animation setzt sie als `<br>`, so
dokumentiert). gpg sagte dazu „no valid OpenPGP data found". Richtig ist ohnehin
der Weg des Nutzers: den Kopierknopf drücken und die Zwischenablage lesen.

**Der Assistent endet beim erzeugten Schlüssel.** Widerrufszertifikat und
Sicherung sind Aufgaben auf der Schlüsselseite geworden (die Knöpfe dafür gab es
dort schon). Der Einstieg kostete vorher dreizehn Handgriffe. ⚠️ Das erhöht die
Zahl derer, die beides nie erledigen — bewusst in Kauf genommen; die Aufgaben
bleiben stehen, bis sie erledigt sind, und die rote Warnung bleibt rot.

## `.haupt` traf Knöpfe, die es nie treffen sollte

`.haupt { flex: 1 }` war für das `<main>` gedacht — traf aber jeden
**Hauptknopf** (`.knopf.haupt`), denn beide teilen sich den Klassennamen. Jeder
solche Knopf in einer Flex-Reihe wuchs damit auf den freien Platz: „Jemanden
einladen" spannte über die halbe Kontaktseite und las sich als Banner, auf der
Startseite war „Schlüssel anlegen" doppelt so breit wie sein Nachbar.

Gefunden durch **Messen im Browser**, nicht durch Lesen — im Stylesheet sieht die
Regel harmlos aus. Sie hängt jetzt am Element (`main.haupt`), und ein Pin in
`tokens.test.ts` hält fest, dass sie dort bleibt.

## Was noch nicht da ist

* Echtes Streaming grosser Dateien durch den Worker (siehe oben — heute fällt
  nur die zweite Kopie weg).
* Ein Off-Site-Stand des Relays gibt es absichtlich nicht; die Datenbank ist
  flüchtig und aus den Schlüsseln der Nutzer wiederherstellbar.
