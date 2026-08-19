# Herkunft der Wortliste

`de-7776-v1.txt` stammt aus **[dys2p/wordlists-de](https://github.com/dys2p/wordlists-de)**.

* 7776 Wörter = 6⁵, also genau fünf Würfelwürfe je Wort (Diceware)
* **12,925 Bit Entropie pro Wort**
* Ohne Umlaute und ß — auf jeder Tastatur und in jeder Wiederherstellungslage tippbar
* Keine Eigennamen, keine regionalen oder religiösen Begriffe, keine negativ
  besetzten Wörter; Substantive, Verben und Adjektive in Grundform
* Lizenz: **Unlicense / CC0 / BSD-3** (das Projekt stellt die Wahl frei) —
  hier unter CC0 verwendet, verträglich mit der MIT-Lizenz dieses Repos

## sha256

```
440fa02c65591328d6351435d3824c27b483a049f4eca0b13456d8c5090442e7
```

`app/tests/passphrase.test.ts` prüft diese Summe bei jedem Lauf. Wer Wörter
austauscht, muss die Summe bewusst mitändern — eine stillschweigend
manipulierte Liste wäre ein Angriff auf jede damit erzeugte Passphrase.

## Würfel-Zuordnung

Die Reihenfolge der Datei **ist** die Diceware-Nummerierung: Zeile *n*
entspricht der Würfelzahl in Basis 6, wobei 1 die Ziffer 0 darstellt.

```
Zeile    0  →  11111  →  aalen
Zeile    6  →  11121  →  abbekommen
Zeile 3888  →  41111  →  kaufanreiz
Zeile 7775  →  66666  →  zypressen
```

Gegen die Diceware-Fassung des Projekts (`de-7776-v1-diceware.txt`) über alle
7776 Zeilen geprüft: **0 Abweichungen**. Deshalb liegt hier nur die einfache
Liste — die Würfelzahl wird gerechnet, nicht gespeichert.

## Warum nicht BIP-39

Naheliegend, aber schwächer:

* 2048 Wörter = **11 Bit** pro Wort statt 12,925. Bei sechs Wörtern sind das
  66 statt 77,5 Bit — bei gleicher Merkarbeit.
* Es gibt **keine offizielle deutsche BIP-39-Liste**; Vorschläge liegen seit
  Jahren als Pull Requests im bitcoin/bips-Repo. Die BIP rät inzwischen
  ausdrücklich von lokalisierten Listen ab.
* Die Prüfsumme von BIP-39 dient der Wiederherstellung eines Wallet-Seeds. Für
  eine Passphrase ist sie nutzlos und kostet nur Entropie.

## Ein Befund zur Wortauswahl

Das Projekt nennt als Kriterium „keine negativ konnotierten Wörter". Nachgezählt
sind dennoch **15 von 7776** Einträgen (0,19 %) solche, die man am Telefon
ungern vorliest oder die schlicht unangenehm sind:

```
angst, armut, arsch, bekriegen, elend, erbrechen, ermorden, giftig,
hassliebe, kotzen, krebs, panik, sargnagel, seuche, sterben
```

Rechnerisch trifft das etwa **jeden 87. Vorschlag** aus sechs Wörtern.

**Die Liste bleibt trotzdem unverändert.** Drei Gründe:

1. **Stilles Filtern wäre genau die Verzerrung, gegen die der Gleichverteilungs-
   Test gebaut ist.** Die App sagt zu, „gleichverteilt über alle 7776 Wörter" zu
   ziehen. Wer einzelne Wörter unterdrückt, macht diesen Satz zur Unwahrheit —
   und niemand sähe es dem Ergebnis an.
2. **Der Wert der Liste liegt darin, dass sie veröffentlicht und über ihre
   Prüfsumme nachprüfbar ist.** Eine von mir nach eigenem Geschmack
   zurechtgeschnittene Fassung wäre nicht mehr dieselbe Liste — die Herkunft
   dieser Datei wäre dann nur noch eine Behauptung.
3. **7776 = 6⁵ ist keine Zierde.** Wörter zu streichen zerstört die
   Würfel-Zuordnung und damit den Modus, in dem man dem Zufall selbst zusieht.

Der „Nochmal"-Knopf kostet einen Klick. Das ist der richtige Preis dafür, dass
die Zusage über die Gleichverteilung stimmt.

Falls das doch stören sollte, wäre der saubere Weg, **den ganzen Vorschlag** neu
zu ziehen statt einzelne Wörter zu tauschen: die Verteilung bliebe innerhalb der
verbleibenden Vorschläge gleichmäßig, der Verlust läge bei 0,017 Bit. Das wäre
dann aber eine Geschmacksliste, die jemand pflegen muss — und sie gehörte
genauso offengelegt wie diese hier.
