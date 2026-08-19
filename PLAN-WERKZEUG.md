# PLAN-WERKZEUG.md — die Werkbank aufräumen und in Bewegung bringen

> Status: **Vorschlag, noch nicht umgesetzt.** Stand: 2026-08-19
> Gegenstand: `/werkzeug` — Layout und Bewegung (Material 3 Expressive).
> Vorgänger: [`PLAN-UX.md`](PLAN-UX.md), [`PLAN-UX2.md`](PLAN-UX2.md).

---

## 1. Befund — gemessen, nicht geschätzt

Ich habe die ausgelieferte Seite in drei Zuständen und zwei Fenstergrössen
vermessen:

| Zustand | Seitenhöhe | in Bildschirmen (900 px) |
|---|---|---|
| leer, nichts getan | **1473 px** | 1,6 |
| Text eingegeben | 1473 px | 1,6 |
| mit Ergebnis | **1961 px** | 2,2 |
| mobil (390×844), leer | **1690 px** | **2,0** |

Die Kartenfolge dabei, von oben:

```
   225 px  +542   Eingabe (Textfeld, 9 Zeilen) + Erkennung + Knöpfe
   783 px  +308   An wen?
  1106 px  +211   Dateien
  1333 px  +472   Verschlüsselt        ← das Ergebnis
```

### 1.1 Die Lesereihenfolge stimmt nicht

Das **Ergebnis ist die vierte Karte** — hinter „An wen?" und „Dateien". Beide
sind Eingaben für die *nächste* Handlung, nicht Ausgaben der letzten. Zwischen
dem, was man hineingibt, und dem, was herauskommt, liegen also 730 px von etwas
anderem.

⚠️ Das ist **nicht** dasselbe wie „man findet das Ergebnis nicht" — die App
scrollt selbst dorthin (gemessen: 598 px am Desktop, 1067 px am Handy). Aber wer
danach den Empfänger ändern will, scrollt wieder zurück nach oben, und die
Zuordnung Eingabe → Ausgabe muss man sich merken statt sie zu sehen.

### 1.2 Vier Karten für vier verschiedene Dinge, alle gleich laut

Sie sind keineswegs gleichrangig:

* **Eingabe** — die Werkbank selbst.
* **An wen?** — eine Einstellung *dieser einen* Handlung (verschlüsseln).
* **Dateien** — ein **zweiter Eingang** in dasselbe Werkzeug, kein Schritt.
* **Ergebnis** — die Ausgabe.

Als vier gleich gestaltete Karten untereinander liest sich das als vierstufiges
Formular. Es ist aber eine Werkbank mit einer Einstellung, einem Nebeneingang
und einem Ausgabefach.

### 1.3 Die Oberfläche weiss längst, was du vorhast — und zeigt es nicht

`tool.erkenne` bestimmt bei jedem Tastendruck, was im Feld steht: Klartext ·
Nachricht · signierter Text · Signatur · öffentlicher Schlüssel · privater
Schlüssel. Die Knöpfe folgen dem bereits.

Das **Layout** folgt ihm nicht. „An wen?" steht auch dann da, wenn eine fremde
Nachricht zum Entschlüsseln im Feld liegt — dort gibt es nichts zu adressieren.
308 px, die in diesem Moment nichts beitragen.

### 1.4 Die Sperrgründe stehen zwischen den Knöpfen

Seit dem Werkzeug ohne eigenen Schlüssel stehen in einer Reihe:

```
[Verschlüsseln]  Wähle zuerst mindestens einen Empfänger.  [Signieren]
Dafür brauchst du einen eigenen Schlüssel.
```

Zwei Knöpfe, zwei Gründe, ineinandergeschoben — welcher Grund zu welchem Knopf
gehört, ist nicht zu sehen. (Mir beim Ausliefern des vorigen Plans aufgefallen;
mit nur einem gesperrten Knopf fiel es nicht auf.)

### 1.5 Bewegung gibt es genau an einer Stelle

Das **Zerfalls-Motiv** auf dem Ergebnistext ist gut und bleibt. Sonst springt
alles: die Erkennungs-Plakette wechselt hart, Knöpfe erscheinen und verschwinden
ohne Übergang, die Ergebniskarte ist von einem Bild aufs nächste da.

Dabei liegt das Werkzeug längst bereit — `motion/spring.ts` ist ein echter
Feder-Integrator mit drei benannten Federn (`weich`, `knapp`, `ruhig`), und
`ruhigeDarstellung()` fragt `prefers-reduced-motion` zentral ab. Benutzt wird
beides bisher fast nur vom Zerfall.

### 1.6 Was NICHT das Problem ist

* Das Textfeld ist mit 9 Zeilen grosszügig, aber nicht falsch — Ciphertext, den
  man einfügt, ist lang.
* Die Erkennung selbst arbeitet zuverlässig und schnell.
* Mobil gibt es **0 px** waagerechten Überlauf.

---

## 2. Der Gedanke dahinter

> **Die Oberfläche folgt der Erkennung.**

Die App weiss bei jedem Tastendruck, was vor ihr liegt. Dann soll sie auch nur
zeigen, was dazu gehört — und der Übergang zwischen den Lagen ist kein Sprung,
sondern eine Bewegung. Genau dafür ist Material 3 Expressive gedacht: Bewegung
als **Erklärung der Veränderung**, nicht als Zierde.

Und: **Eingang und Ausgang gehören zusammen.** Was dazwischen steht, ist
Beiwerk.

---

## 3. Plan — Layout

### L1. Eine Werkbank statt vier Karten

Aus vier gleichrangigen Karten wird **eine Werkbank** mit klarer Innengliederung:

```
┌─ Werkbank ─────────────────────────────────────────┐
│  ( Text | Datei )        ← Segmentwahl, zwei Eingänge
│  ┌──────────────────────────────────────────────┐  │
│  │ Eingabe                                      │  │
│  └──────────────────────────────────────────────┘  │
│  [KLARTEXT]  Gewöhnlicher Text.                    │
│  ─────────────────────────────────────────────────  │
│  An wen?   ← nur bei Klartext, eingeklappt möglich │
│  ─────────────────────────────────────────────────  │
│  [ Verschlüsseln ]  [ Signieren ]                  │
└────────────────────────────────────────────────────┘
┌─ Ergebnis ─────────────────────────────────────────┐
│  …                                                 │
└────────────────────────────────────────────────────┘
```

* **„Dateien" wird der zweite Reiter** der Eingabe, kein Zwischenkapitel. Es ist
  ein anderer Eingang in dasselbe Werkzeug — die Segmentwahl sagt das in einem
  Blick. (Das Ablegen per Ziehen bleibt **immer** möglich, auf der ganzen
  Werkbank; der Reiter ist der sichtbare Weg für alle, die nichts ziehen wollen.)
* **„An wen?" rückt in die Werkbank**, direkt über die Knöpfe, zu denen es
  gehört — und erscheint nur, wenn adressiert werden kann.
* **Das Ergebnis rückt direkt hinter die Werkbank.** Damit stehen Eingang und
  Ausgang beieinander, ohne 730 px Fremdes dazwischen.

Erwartete Höhe: leer **unter 900 px** (ein Bildschirm statt 1,6), mit Ergebnis
unter 1500 px. Wird gemessen, nicht behauptet.

### L2. Was gerade nichts beiträgt, ist nicht da

| Erkannt | sichtbar |
|---|---|
| Klartext | An wen? · Verschlüsseln · Signieren |
| Nachricht | Entschlüsseln (+ „mit welchem Schlüssel prüfen?", eingeklappt) |
| signierter Text | Signatur prüfen |
| Signatur | Hinweis: den zugehörigen Text einfügen |
| öffentlicher Schlüssel | Als Kontakt aufnehmen · Als Empfänger übernehmen |
| privater Schlüssel | Hinweis auf den Schlüsselbund |

⚠️ **Ausblenden, nicht ausgrauen** — aber nur, was gerade *gegenstandslos* ist.
Was grundsätzlich zum erkannten Inhalt gehört und nur momentan nicht geht
(gesperrter Bund, kein eigener Schlüssel), bleibt **sichtbar und gesperrt, mit
Grund**. Wer nicht sieht, dass es Entschlüsseln gibt, sucht es nicht.

### L3. Jeder Grund steht unter seinem Knopf

Aus der ineinandergeschobenen Reihe wird eine Spalte aus Paaren: Knopf, darunter
sein Grund in kleiner Schrift. Zuordnung durch Nähe, nicht durch Raten.

### L4. Das Textfeld wächst mit

Start bei vier Zeilen, wächst federgeführt bis zu einer Höchsthöhe mit dem
Inhalt. Das nimmt der leeren Seite ~200 px, ohne beim Einfügen langer Blöcke zu
stören.

---

## 4. Plan — Bewegung (Material 3 Expressive)

Grundlage ist das vorhandene `motion/spring.ts`. **Keine neue Abhängigkeit**,
und jede Bewegung ist an eine Veränderung gebunden, die sie erklärt.

### M1. Der Lagenwechsel ist ein Morph, kein Schnitt

Wechselt die Erkennung (Klartext → Nachricht), verändert sich der untere Teil
der Werkbank. Statt neu zu zeichnen:

* Die Höhe des Bereichs läuft auf einer **`weich`-Feder** ins neue Mass.
* Der alte Inhalt blendet aus (~90 ms), der neue ein (~140 ms, leicht versetzt).
* Die **Erkennungs-Plakette** morpht: Farbe und Beschriftung wechseln, die
  Pille verändert dabei ihre Breite federgeführt statt zu springen.

⚠️ Eine Feder statt einer `transition`, weil beim Tippen alle 250 ms ein neues
Ziel kommen kann. Eine `transition` müsste jedes Mal neu anfangen und wirkt
abgehackt; eine Feder nimmt das neue Ziel mit ihrer aktuellen Geschwindigkeit an.

### M2. Das Ergebnis kommt herein, es erscheint nicht

Die Ergebniskarte fährt federgeführt auf ihre Höhe auf (`ruhig`, grosse Fläche)
und steigt dabei ~12 px auf. Der Text darin behält sein bestehendes
**Zerfalls-/Aufbau-Motiv** — das ist die Signatur der App und bleibt unangetastet.

⚠️ Die Bewegung läuft **nach** dem Worker-Ergebnis und rein kosmetisch. Sie darf
nie zwischen Krypto und Anzeige stehen (Hausregel aus `frontend-m3e.md`).

### M3. Der Hauptknopf setzt sich, wenn er verfügbar wird

Wird eine Handlung möglich (Empfänger gewählt, Bund entsperrt), bekommt der
zugehörige Knopf einen kurzen **`knapp`-Feder-Impuls** (Massstab 1 → 1,03 → 1).
Einmal, nicht wiederholt. Er sagt: *jetzt geht es*.

### M4. Die Ablegefläche reagiert auf das Ziehen

Beim Ziehen über die Werkbank hebt sich die Ablegefläche federgeführt an
(Kontur kräftiger, leichte Vergrösserung), beim Verlassen zurück. Heute ist der
Wechsel hart.

### M5. Der Reiterwechsel Text ↔ Datei ist ein Shared Element

Die aktive Pille **gleitet** auf ihre neue Position, statt umzuspringen — das
gebräuchlichste M3E-Motiv und hier zutreffend, weil dieselbe Sache umzieht.

### M6. Ruhig bleibt ruhig

`prefers-reduced-motion: reduce` schaltet **alle** sechs Punkte ab; die Feder
springt dann auf ihr Ziel (`Feder.setze`). Das ist bereits die Bauart des
Integrators, es muss nur konsequent benutzt werden.

⚠️ Und die Zeitschranke aus `frontend-m3e.md` gilt weiter: höchstens ~300
animierte Zeichen im Zerfall; ein 40-kB-Block baut sonst 40 000 DOM-Knoten.

---

## 5. Wie ich es prüfe

* **Höhe messen**, vorher/nachher, in beiden Fenstergrössen — die Zahlen oben
  sind der Vergleichsmassstab.
* **Wegfindung** (`npm run wege`) läuft über die neuen Lagen: keine Sackgasse,
  kein Knopf, der nichts tut.
* **Zugänglichkeit** (`npm run a11y`) über die Werkbank in jeder erkannten Lage,
  in beiden Themen. Ein- und ausblendende Bereiche brauchen korrektes
  `aria-live`/`hidden` — was verschwindet, darf für Hilfsmittel nicht
  weiterbestehen.
* **`npm run erster-nutzen`** und **`npm run e2e`** müssen unverändert
  durchlaufen: das Layout darf am Verhalten nichts ändern.
* **Ein Pin gegen den Rückfall:** was grundsätzlich möglich ist, aber gerade
  nicht geht, bleibt sichtbar (L2) — sonst wird aus „aufgeräumt" heimlich
  „versteckt".
* **Bewegung messbar machen:** ein Lauf mit `prefers-reduced-motion: reduce`
  prüft, dass die Endzustände identisch sind. Eine Animation, die den
  Endzustand verändert, ist ein Fehler, kein Effekt.
* Jeder neue Pin wird einmal mutiert — und die Mutation muss die Eigenschaft
  treffen, die der Test behauptet.

---

## 6. Was ich nicht anfasse

Krypto-Kern, Worker-Grenze, Erkennung, die Zusicherungen aus `THREAT-MODEL.md`
und der Datenabfluss-Test. Die Arbeit liegt in `app/src/ui/views/werkzeug.ts`,
`app/src/ui/stil.css` und einem neuen Bewegungs-Baustein; `motion/spring.ts`
bleibt, wie es ist.

Der **Zerfall bleibt** — er ist die Handschrift der App und funktioniert.

---

## 7. Offene Fragen

**1. Karte oder zwei Spalten?** Auf breiten Fenstern liessen sich Werkbank und
Ergebnis **nebeneinander** legen (vorher | nachher). Das wäre die klarste
Zuordnung überhaupt — kostet aber die ruhige Einspaltigkeit, die die App sonst
überall hat. Mein Vorschlag oben bleibt einspaltig; sag Bescheid, wenn du das
Nebeneinander willst.

**2. Wie weit soll ausgeblendet werden?** Ich schlage vor, nur
*Gegenstandsloses* zu verbergen (L2). Radikaler wäre, alles zu verbergen, was
gerade nicht geht — kürzer, aber dann erfährt niemand mehr, dass es Signieren
überhaupt gibt.

**3. Dateien als Reiter — oder unten lassen?** Als Reiter ist es aufgeräumter
und macht die Gleichrangigkeit sichtbar. Dagegen spricht: wer die Seite kennt,
sucht die Ablegefläche dort, wo sie heute ist. (Ziehen bleibt in beiden Fällen
überall möglich.)
