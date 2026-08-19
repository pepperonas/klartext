# PLAN-UX2.md — `klartext` einfacher machen

> Status: **Umgesetzt.** Stand: 2026-08-19
> Vorgänger: [`PLAN-UX.md`](PLAN-UX.md) (Sackgassen, geführte Schlüsselerzeugung,
> Orientierung — umgesetzt). Dieser Plan setzt darauf auf.

---

## 1. Wie ich vorgegangen bin

Ich bin die ausgelieferte App unter `klartext.celox.io` selbst abgelaufen — mit
zwei Browsern, in drei Fenstergrössen, und habe dabei **gemessen** statt
geschätzt: Klicks bis zum ersten Ergebnis, Scrollwege, was im Blickfeld liegt,
was ein Neuling auf jedem Schirm liest.

⚠️ Eine meiner Vermutungen hat die Messung gleich widerlegt. Auf dem Vollbild
sah es so aus, als läge das Verschlüsselungs-Ergebnis unerreichbar weit unten,
unter zwei unbeteiligten Karten. Gemessen: die App **scrollt selbst dorthin**
(598 px auf dem Desktop, 1067 px auf dem Handy), die Karte steht danach im
Blickfeld. Der Punkt ist damit erledigt, bevor er im Plan stand.

---

## 2. Der Kernbefund: die App verlangt mehr, als sie braucht

**Um jemandem etwas zu verschlüsseln, braucht man keinen eigenen Schlüssel.**
Man braucht den öffentlichen Schlüssel des Gegenübers, sonst nichts. Dasselbe
gilt fürs Prüfen einer Signatur.

Der Krypto-Kern kann das auch: `verschluessele(...)` nimmt `signiereMit: null`
und einen eingefügten fremden Schlüssel entgegen — beides ist im Code
vorgesehen und getestet.

Die Oberfläche verbietet es trotzdem. Ohne eigenen Schlüssel zeigt das Werkzeug:

> **Erst brauchst du einen Schlüssel**
> Ohne Schlüssel gibt es nichts zu ver- oder entschlüsseln. Leg zuerst einen an.

Der zweite Satz ist zur Hälfte unwahr. Richtig ist:

| | ohne eigenen Schlüssel |
|---|---|
| an jemanden verschlüsseln | **geht** |
| eine Signatur prüfen | **geht** |
| entschlüsseln | braucht den eigenen Schlüssel |
| signieren | braucht den eigenen Schlüssel |

Die Folge ist das eigentliche Problem. Wer zum ersten Mal hier landet — etwa
weil eine Freundin einen Einladungslink geschickt hat — muss einen
sechsstufigen Assistenten hinter sich bringen, bevor die App *irgendetwas* tut.
Gezählt, mit allen Vorgaben übernommen:

| bis wohin | Interaktionen |
|---|---|
| bis zum Sicherungsschritt (Name, Verfahren, Passphrase) | **5** (gemessen) |
| drei Wörter zur Kontrolle + „Schlüssel jetzt erzeugen" | 4 |
| Widerrufszertifikat herunterladen + weiter | 2 |
| Backup-Entscheidung + Bestätigung | 2 |
| **gesamt** | **13** |

Dazu die Rechenzeit: ~2,5 s bei Curve25519, bei der Voreinstellung RSA-4096 bis
zu einer Minute.

Jeder einzelne Schritt ist begründet. Die Reihenfolge ist es nicht: Sicherung
und Widerruf sind Fragen für jemanden, der die App **behalten** will. Sie vor
den ersten Nutzen zu stellen, verlangt eine Verpflichtung, bevor irgendein
Vertrauen entstanden ist.

---

## 3. Was mir sonst aufgefallen ist

### 3.1 Die Voreinstellung widerspricht dem eigenen Rat

Schritt 2 hat **RSA-4096 vorausgewählt**. Die App selbst rechnet aber vor, dass
ein RSA-4096-Einladungslink 3137 Zeichen lang wird und damit **in keinen
QR-Code passt** (Höchstmass 2953 Byte), während Curve25519 mit 685 Zeichen
bequem hineingeht — gemessen im echten Betrieb: 782 Zeichen, QR-Code sauber.

Auf dem Auswahlschirm steht davon nichts. Wer die Voreinstellung nimmt — also
die Mehrheit — schneidet sich damit den bequemsten Weg ab, jemanden
aufzunehmen, und erfährt es erst Tage später.

Dazu ist die Frage selbst kaum beantwortbar. „RSA-4096 versteht jedes GnuPG,
auch alte Fassungen" gegen „Curve25519 braucht GnuPG 2.1 oder neuer" setzt
voraus, dass man weiss, was das Gegenüber benutzt. Das weiss man nicht.

### 3.2 Nach dem Schlüssel kommt nichts

Der Assistent endet auf der Schlüsselseite. Die zeigt: eine rote Warnung, den
Schlüssel, und ein Expertenformular („Vorhandenen Schlüssel übernehmen"), das
in fast jeder Sitzung Beiwerk ist.

Was sie **nicht** zeigt: was man jetzt tun könnte. Die naheliegendste Frage
nach dem Anlegen — „und wie schicke ich meiner Freundin jetzt etwas?" — steht
nirgends. Jeder Schirm ist für sich vollständig; keiner führt zum nächsten.

### 3.3 Drei gleich laute Knöpfe, von denen zwei Expertenwissen verlangen

Das Werkzeug bietet nebeneinander **Verschlüsseln · Signieren · Nur Signatur
erzeugen**. Der Unterschied zwischen den letzten beiden (eingebettet gegen
abgetrennt) ist eine Fachfrage. Wer sie nicht kennt, kann sie hier nicht
beantworten, und es steht kein Satz dabei.

### 3.4 Die Landung spricht Fachsprache

Der erste Absatz nennt *PGP*, *OpenPGP*, *Ciphertext*, *gpg* und *Matrix* —
bevor irgendwo steht, wofür man das im eigenen Leben braucht. Wer PGP kennt,
ist sofort zu Hause. Wer nicht, findet keinen Satz über das eigene Anliegen
(„ich will meiner Freundin etwas schicken, das sonst niemand liest").

### 3.5 Kleinigkeiten, die ich beim Ansehen gefunden habe

* Der orange Warnsatz auf der Startseite steht auf der Einrückung der
  Aufzählung, hat aber **keinen Punkt davor** — er liest sich in beiden
  Fenstergrössen wie ein kaputter vierter Listenpunkt.
* „Was klartext nicht kann" steht **zweimal gleichzeitig** auf dem Schirm:
  als Knopf und in der Fusszeile.
* „Jemanden einladen" ist ein **volle Breite** füllender Knopf in der
  Überschriftenzeile — er liest sich als Banner und drängt die Überschrift
  „Kontakte" an den Rand.
* Auf der Kontaktseite ist „Prüfen" der einzige Knopf seiner Karte, aber als
  Nebenknopf gezeichnet. Und „Prüfen" sagt nicht, dass danach ein Kontakt
  entsteht.
* Der eingebaute QR-Leser dient **nur dem Fingerprint-Abgleich** eines schon
  vorhandenen Kontakts. Eine Einladung nimmt man an, indem die Kamera-App des
  Telefons den Link öffnet. Das ist richtig so — aber „Zum Abscannen, wenn ihr
  euch seht" auf dem Einladungsschirm lädt dazu ein, in `klartext` nach einem
  Scanner zu suchen, den es für diesen Zweck nicht gibt.

### 3.6 Was ich ausdrücklich NICHT als Problem gefunden habe

* **Sackgassen.** Der Durchgang aus `PLAN-UX.md` hält; `wegfindung.mjs` läuft
  über alle zehn Zustände.
* **Mobil.** 0 px waagerechter Überlauf bei 390 px, alle Ziele erreichbar.
* **Leere Zustände.** Werkzeug und Kontakte erklären sich ohne Schlüssel
  vernünftig (bis auf den halbwahren Satz aus §2).
* **Das Gespräch.** Zwei Fremde von null bis zum ersten zugestellten Satz: ging
  live durch, 178 ms hin, 199 ms zurück, Signaturen erkannt, Verlauf nach dem
  Entsperren wieder da.

---

## 4. Plan

### Stufe 1 — Ausprobieren vor Verpflichten *(der Kern)*

**1. Das Werkzeug ohne eigenen Schlüssel freigeben.** Wer keinen hat, sieht
dasselbe Werkzeug, nur mit ehrlicher Beschriftung:

* *Verschlüsseln* und *Prüfen* stehen offen — sie brauchen nur das Gegenüber.
* *Entschlüsseln* und *Signieren* sind sichtbar, aber gesperrt, mit dem Satz,
  **warum**: „Dafür brauchst du einen eigenen Schlüssel" und einem Knopf
  daneben, der den Assistenten öffnet.

Damit erlebt jemand den Nutzen in **zwei Handgriffen** statt in dreizehn — fremden
Schlüssel einfügen, Text tippen, fertig — und entscheidet danach, ob er
bleibt. Der halbwahre Satz verschwindet dabei von selbst.

**2. Der Assistent wird zweigeteilt.** Nötig zum Loslegen: Name, Verfahren,
Passphrase, Sicherung der Passphrase. Nötig zum *Behalten*: Widerrufszertifikat
und Schlüssel-Backup. Der zweite Teil wandert hinter den Abschluss — als
Aufgabenliste auf der Schlüsselseite, die so lange steht, bis sie erledigt ist
(die rote Warnung dafür gibt es schon, sie bekommt nur Gesellschaft und einen
Weg zur Erledigung).

⚠️ **Nicht** wegkürzen, nur verschieben. Wer ohne Widerrufszertifikat
dasteht, kann einen verlorenen Schlüssel nie für ungültig erklären; das bleibt
so wichtig, wie es heute dargestellt wird. Es ist nur keine Frage für die
erste Minute.

**3. RSA-4096 bleibt die Voreinstellung** (Entscheidung vom 2026-08-19) — der
Auswahlschirm sagt aber künftig, was das kostet: langsamer im Erzeugen, und der
eigene Einladungslink passt **in keinen QR-Code**. Curve25519 bekommt
spiegelbildlich den Gewinn dazugeschrieben. Beides steht dort, wo die Wahl
getroffen wird, statt erst Tage später.

⚠️ Damit wird der QR-Weg beim Einladen der **Ausnahmefall**, nicht die Regel.
Nachgesehen: der Einladungsschirm behandelt das bereits ehrlich — statt des
Codes steht dort ein Kasten „Für einen QR-Code ist dieser Link zu lang" samt
Zeichenzahl, Höchstmass und dem Hinweis auf Curve25519. Es ist also nichts zu
reparieren, nur die Wahl vorzuverlegen.

### Stufe 2 — Jeder Schirm sagt, was als Nächstes kommt

**4. Ein „Als Nächstes"-Block auf der Schlüsselseite**, der dem Zustand folgt:
kein Kontakt → *jemanden einladen*; Kontakt da → *schreiben*; nichts gesichert →
*Sicherung erzeugen*. Kein Assistent, kein Zwang — eine Zeile, die die Frage
beantwortet, die ohnehin gestellt wird.

**5. Das Expertenformular klappt zu.** „Vorhandenen Schlüssel übernehmen" wird
ein aufklappbarer Bereich statt einer Dauerkarte. Es verschwindet nicht, es
drängt sich nur nicht mehr auf.

**6. Aus drei Knöpfen werden zwei plus eine Wahl.** *Verschlüsseln* und
*Signieren* bleiben; die Unterscheidung eingebettet/abgetrennt wird eine
Option beim Signieren, mit einem Satz, wann man welche nimmt („abgetrennt,
wenn die Datei unverändert bleiben soll").

### Stufe 3 — Die Landung spricht die Sprache der Leserin

**7. Ein Satz über das Anliegen vor den Satz über die Technik.** Nicht statt —
davor. Sinngemäss: „Schick jemandem etwas, das unterwegs niemand lesen kann.
Auch nicht der Dienst, über den du es schickst." Danach gern weiter mit PGP,
GnuPG und Ciphertext, für die, die das suchen.

**8. Die drei Aufzählungspunkte bekommen eine Überschrift**, die sie
einordnet, und der orange Warnsatz wird ein eigener Absatz mit Abstand — kein
Listenpunkt ohne Punkt.

**9. „Was klartext nicht kann" steht einmal auf dem Schirm.** In der Fusszeile
bleibt es, auf der Startkarte wird es ein Textlink im Fliesstext statt eines
zweiten Knopfes neben dem Hauptknopf.

### Stufe 4 — Kleinigkeiten

**10.** „Jemanden einladen" wird ein normal breiter Knopf rechts neben der
Überschrift.
**11.** „Prüfen" heisst „Kontakt aufnehmen" und wird der Hauptknopf seiner
Karte. (Der Fingerprint-Abgleich steht ohnehin danach.)
**12.** Auf dem Einladungsschirm wird aus „Zum Abscannen, wenn ihr euch seht"
ein Satz, der sagt, **wer** scannt und **womit**: „Die andere Person scannt ihn
mit der Kamera ihres Telefons — der Link öffnet sich dann in ihrem Browser."

### Prüfen

* `wegfindung.mjs` bekommt die neuen Zustände (Werkzeug ohne Schlüssel,
  Aufgabenliste) — und die bestehende Forderung gilt weiter: keine Sackgasse,
  kein Knopf, der nichts tut.
* **Neuer Test „erster Nutzen":** ein Browser ohne alles fügt einen fremden
  öffentlichen Schlüssel ein, tippt einen Satz, verschlüsselt — und bekommt
  einen gültigen Block, **ohne je einen eigenen Schlüssel angelegt zu haben**.
  Gegengeprüft mit echtem `gpg`, sonst prüft der Test nur sich selbst.
* **Ein Pin gegen den Rückfall:** *Entschlüsseln* und *Signieren* müssen ohne
  eigenen Schlüssel gesperrt bleiben. Die Freigabe darf nicht versehentlich zu
  weit gehen.
* Zugänglichkeit über die neuen Zustände, beide Themen.
* Jeder neue Pin wird einmal mutiert. ⚠️ Und die Mutation muss die Eigenschaft
  treffen, die der Test behauptet — in dieser Sitzung sind mir zwei Proben am
  Gegenstand vorbei gegangen und deshalb folgerichtig grün geblieben.

---

## 5. Entscheidungen (2026-08-19)

| Frage | Entschieden |
|---|---|
| Ausprobieren ohne Schlüssel | **Werkzeug freigeben** — verschlüsseln und prüfen offen, entschlüsseln und signieren sichtbar gesperrt mit Begründung |
| Assistent zweiteilen | **Ja, beides verschieben** — Widerrufszertifikat und Backup wandern in eine Aufgabenliste nach dem Abschluss |
| Voreinstellung Verfahren | **RSA-4096 bleibt** — dafür kommt der QR-Hinweis auf den Auswahlschirm |
| Landeseite | **Ein Satz voran**, sonst unverändert |

⚠️ Zur zweiten Entscheidung gehört die bewusste Inkaufnahme: wer den Assistenten
zweiteilt, senkt die Einstiegshürde **und** erhöht die Zahl derer, die
Widerrufszertifikat und Backup nie anlegen. Die Aufgabenliste bleibt deshalb
stehen, bis sie abgehakt ist, und die rote Warnung bleibt rot. Verhindern lässt
es sich nicht — das ist der Preis der Entscheidung, nicht ein Mangel der
Umsetzung.

---

## 6. Was ich dabei nicht anfasse

Der Krypto-Kern, die Worker-Grenze, die S2K-Formate, das Relay und sämtliche
Sicherheits-Zusicherungen bleiben unberührt. Die Arbeit findet in
`app/src/ui/` statt, plus die Freigabe der bereits vorhandenen Fähigkeit aus
§2 — dort wird nichts Neues gebaut, sondern etwas Vorhandenes zugänglich
gemacht.

Kein Punkt dieses Plans schwächt eine Aussage aus `THREAT-MODEL.md` ab, und
keiner macht eine Warnung leiser. Die rote Backup-Warnung bleibt rot.
