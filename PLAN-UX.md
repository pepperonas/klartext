# PLAN-UX.md — `klartext` benutzbar machen

> Status: **Bestätigt und umgesetzt.** Alle vier Stufen sind gebaut; der
> Durchgang von damals läuft als `tools/e2e/wegfindung.mjs` bei jedem Bauen mit.
> Grundlage: ein Durchgang durch alle sieben Zustände der laufenden App am
> 2026-08-19, protokolliert mit den in jedem Zustand tatsächlich sichtbaren
> Bedienelementen.

---

## 1. Was ich als Aufgabe verstanden habe

Die App soll an jeder Stelle sagen, **wo man ist, was der Zustand der Schlüssel
ist, was als Nächstes zu tun ist und wie man wieder herauskommt**. Konkret
angestoßen durch drei Punkte: die Passphrase lässt sich nicht bequem kopieren,
es wird nicht überprüft, ob wirklich *die richtige* gesichert wurde, und aus dem
gesperrten Zustand führt kein Weg zurück.

---

## 2. Befund — was der Durchgang gezeigt hat

### 2.1 Die Sackgasse ist echt

Im gesperrten Zustand gibt es genau **einen** möglichen Handgriff: die
Passphrase eintippen. Kein Zurück, keine Übersicht, keine Erklärung. Wer aus
Neugier auf „Sperren" geklickt hat, sitzt vor einer Passwortabfrage ohne Ausweg.

Verschärfend: **der Knopf „Sperren" steht dort weiterhin in der Kopfzeile**,
obwohl schon gesperrt ist. Er tut nichts. Das ist nicht nur nutzlos, es ist
irreführend — er suggeriert, es gäbe hier noch etwas zu bedienen.

Dabei ginge einiges: **öffentliche Schlüssel sind nicht geheim** und lassen sich
auch bei gesperrtem Schlüsselbund lesen und ausgeben. Die App verweigert das
grundlos.

### 2.2 „Notiert"-Haken beweist nichts — und das Wiederholfeld auch nicht

Der Haken „Ich habe die Passphrase notiert" ist eine Selbstauskunft. Man klickt
ihn in zwei Sekunden, ohne irgendetwas notiert zu haben.

Schlimmer: **beim Übernehmen eines Vorschlags fülle ich beide Felder** — auch
„Passphrase wiederholen". Damit prüft das Wiederholfeld genau nichts mehr. Der
einzige Mechanismus, der einen Tippfehler abfangen könnte, ist bei der
gefährlichsten Variante (vorgeschlagene, nie selbst getippte Passphrase)
abgeschaltet.

### 2.3 Der gefährlichste Irrtum: die Wörter sind **kein** Seed

Du hast sie „Seed" genannt, und die Form legt das nahe — sechs Wörter aus einer
Diceware-Liste sehen aus wie eine Wallet-Wiederherstellung. **Sie sind es
nicht.**

| | Wallet-Seed (BIP-39) | Passphrase in `klartext` |
|---|---|---|
| Was er tut | **erzeugt** den Schlüssel neu | **entsperrt** einen gespeicherten Schlüssel |
| Browserdaten weg | egal, Seed genügt | **Schlüssel unwiederbringlich weg** |
| Reicht als Backup | ja | **nein** |

Wer die sechs Wörter für ein Backup hält, verliert seine Schlüssel beim ersten
gelöschten Browserprofil — und hat den Zettel mit den Wörtern in der Hand, der
ihm nicht hilft. Das ist der schwerwiegendste Punkt in diesem ganzen Dokument.

Das echte Backup ist der **exportierte private Schlüssel**. Der ist derzeit hinter
zwei Klicks in einer Schlüsselkarte versteckt und kommt im Ablauf des ersten
Schlüssels überhaupt nicht vor.

### 2.4 Der Info-Screen fehlt — und war Vorgabe

Der Masterprompt verlangt, dass die Grenzen aus `THREAT-MODEL.md` **von der
Startseite aus in einem Tipp** erreichbar sind. Es gibt sie im Repo, aber
nirgends in der App. Der leere Zustand erklärt mit keinem Wort, was `klartext`
ist, was es leistet und was nicht.

### 2.5 Kleinere, konkrete Fehler aus dem Durchgang

| Fund | Warum es stört |
|---|---|
| Überschrift **„Privaten Schlüssel ausführen"** | schlicht falsches Deutsch von mir — „ausführen" heißt *starten*. Gemeint ist *exportieren*. Ebenso die Meldung „Ausgeführt." |
| Wortmarke „klartext" verlinkt auf `#` | sieht aus wie ein Weg nach Hause, tut nichts |
| „Sperren" auch im leeren Zustand sichtbar | es gibt nichts zu sperren |
| Browser-Zurück tut nichts | in jedem Unterzustand die naheliegendste Geste, sie führt aus der App heraus |
| Widerrufszertifikat: „Weiter" ohne Herunterladen | das Wichtigste lässt sich mit einem Klick überspringen |
| Zustand „Schlüssel vorhanden" bietet nichts zu tun | Phase 2 fehlt noch, aber die App sagt das nicht |

---

## 3. Vier Rückfragen

**1. Wie deutlich soll der Unterschied Passphrase ↔ Backup werden?**
- (a) **Empfehlung:** Der Ablauf des ersten Schlüssels endet mit einem
  eigenen Schritt „Backup anlegen", der den privaten Schlüssel exportiert.
  Überspringen möglich, aber mit ausdrücklicher Warnung, und die Schlüsselkarte
  zeigt danach dauerhaft „kein Backup vorhanden", bis eines erzeugt wurde.
- (b) Nur ein erklärender Text, kein eigener Schritt.

**2. Wie prüfen wir, dass die richtige Passphrase gesichert wurde?**
- (a) **Empfehlung:** Nach dem Notieren werden **drei zufällig gewählte Wörter
  nach Position** abgefragt („Wort 2, 4 und 5"). So machen es Wallets; es beweist
  den Besitz des Zettels, ohne 55 Zeichen abtippen zu lassen.
- (b) Die vollständige Passphrase noch einmal eintippen — sicherer, aber bei
  sechs Wörtern eine Zumutung, die viele per Zwischenablage umgehen (und damit
  nichts beweisen).
- (c) Beides anbieten, (a) voreingestellt.

**3. Kopieren in die Zwischenablage — mit welcher Ehrlichkeit?**
- **Empfehlung:** Knopf ja, mit einem Satz im Klartext daneben (die
  Zwischenablage lesen andere Programme mit, und auf Apple-Geräten wandert sie
  über Universal Clipboard auf andere Geräte), und **automatisches Leeren nach
  60 Sekunden**. Zusätzlich „Zum Ausdrucken" — ein sauberes Blatt mit Wörtern,
  Würfelzahlen, Fingerprint und Datum.

**4. Umfang und Zeitpunkt.** Ein Teil der Probleme rührt daher, dass Phase 2
noch fehlt (im Zustand „Schlüssel vorhanden" gibt es schlicht nichts zu tun).
- (a) **Empfehlung:** Jetzt als **Phase 1.5** machen, aber die Navigation gleich
  so bauen, dass Werkzeug (Phase 2) und Kontakte (Phase 3) nur noch eingehängt
  werden. Sackgassen und Backup-Lücke sind echte Fehler, die nicht auf Phase 2
  warten sollten.
- (b) Alles zusammen mit Phase 2.

---

## 4. Plan

### Stufe 1 — Sackgassen und Fehler (das Dringendste)

1. **Gesperrter Zustand wird nutzbar.** Die Schlüsselliste bleibt sichtbar,
   nur eben gesperrt: Fingerprints lesbar, öffentliche Schlüssel ausgebbar
   (sie sind nicht geheim). Darüber ein klarer Block „Gesperrt — Passphrase
   eingeben", mit einem Satz dazu, warum das passiert ist (Leerlauf, Tabwechsel
   oder von Hand).
2. **Kopfzeile zeigt nur, was möglich ist.** „Sperren" verschwindet, wenn
   gesperrt oder leer. Die Sperranzeige wird selbst zum Bedienelement:
   anklicken sperrt bzw. springt zur Eingabe.
3. **Zurück funktioniert überall.** Jeder Unterzustand (Export,
   Widerrufszertifikat, Vorschlag) bekommt einen sichtbaren Weg zurück **und**
   hängt an der Browser-History, damit die Zurück-Geste tut, was sie soll.
4. **Wortmarke führt nach Hause.** Sprachfehler beheben: „exportieren" statt
   „ausführen".

### Stufe 2 — Der erste Schlüssel wird geführt

Aus einem langen Formular werden benannte Schritte mit sichtbarem Fortschritt:

```
1 Wer bist du      → Name (E-Mail optional)
2 Verfahren        → RSA-4096 / Curve25519, mit Folgen im Klartext
3 Passphrase       → vorschlagen oder selbst wählen
4 Sichern          → kopieren · drucken · Würfelzahlen; danach Abfrage von
                     drei Wörtern nach Position
5 Widerrufs-       → Herunterladen ist Pflicht zum Weitergehen
  zertifikat
6 Backup           → privater Schlüssel als Datei; überspringen möglich,
                     aber mit Warnung und dauerhaftem Hinweis danach
```

Jeder Schritt sagt in einem Satz, **warum** er existiert. Zurück ist immer
möglich, vorwärts nur, wenn der Schritt erledigt ist.

Dazu: **das Wiederholfeld wird beim Übernehmen eines Vorschlags nicht mehr
mitgefüllt** — sonst prüft es nichts.

### Stufe 3 — Orientierung

5. **Navigationsleiste** mit den Zielen, die es gibt, und ausgegrauten für die,
   die noch kommen: `Schlüssel · Werkzeug (Phase 2) · Kontakte (Phase 3) · Info`.
   Damit ist auch beantwortet, warum im Zustand „Schlüssel vorhanden" gerade
   nichts weiter zu tun ist.
6. **„Was klartext nicht kann"** als eigene Seite, von der Startseite und aus
   der Fußzeile mit einem Tipp erreichbar — die acht Punkte aus
   `THREAT-MODEL.md` im Wortlaut. Das ist Vorgabe aus dem Masterprompt und
   zugleich Markenkern.
7. **Leerer Zustand erklärt die App**, bevor er ein Formular zeigt: was sie
   tut, was sie nicht tut, dass nichts das Gerät verlässt.

### Stufe 4 — Kleinigkeiten mit großer Wirkung

8. Kopieren mit Klartext-Hinweis und Leeren der Zwischenablage nach 60 s.
9. Druckansicht für den Passphrase-Zettel (Wörter, Würfelzahlen, Fingerprint,
   Datum) — Papier ist das ehrlichste Sicherungsmedium für dieses Geheimnis.
10. Jede irreversible Handlung sagt vorher, was passiert; jeder Knopf heißt
    nach dem, was er tut.
11. Ladezustände: RSA-4096 dauert unvorhersehbar lange — Fortschritt und ein
    ehrlicher Satz statt eines eingefrorenen Knopfs.

### Prüfen

Der Durchgang von heute wird zum **Test**: `tools/e2e/wegfindung.mjs` läuft alle
Zustände ab und verlangt für jeden, dass es (a) eine Überschrift gibt, die sagt
wo man ist, (b) mindestens einen Weg heraus, (c) keinen Knopf, der nichts tut.
Sackgassen fallen dann beim Bauen auf, nicht beim Benutzen.

Dazu die bestehenden Läufe: Zugänglichkeit über alle neuen Zustände, und der
Datenabfluss-Test bleibt unverändert scharf.

---

## 5. Was ich dabei NICHT anfasse

Der Krypto-Kern, die Worker-Grenze, die S2K-Formate und die Testzusicherungen
bleiben unberührt. Diese Arbeit findet ausschließlich in `app/src/ui/` statt —
mit einer Ausnahme: Stufe 2 braucht einen Weg, den Fortschritt „Backup
vorhanden?" festzuhalten, das ist ein zusätzliches Feld in den Einstellungen.
