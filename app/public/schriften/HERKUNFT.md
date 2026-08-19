# Schriften

Beide unter der **SIL Open Font License 1.1**; die Lizenztexte liegen daneben
und werden mit ausgeliefert.

| Datei | Schrift | Fassung | Quelle |
|---|---|---|---|
| `inter-var-latin.woff2` | Inter (variabel, Gewicht 100–900) | 4.1 | github.com/rsms/inter |
| `jetbrains-mono-latin.woff2` | JetBrains Mono Regular | 2.304 | github.com/JetBrains/JetBrainsMono |
| `jetbrains-mono-latin-bold.woff2` | JetBrains Mono Bold | 2.304 | github.com/JetBrains/JetBrainsMono |

## Warum selbst ausgeliefert

Weil die App zusagt, **nichts von fremden Servern zu laden**. Eine Schrift von
Google Fonts wäre ein Aufruf an einen fremden Rechner bei jedem Seitenaufruf —
mit IP-Adresse, Zeitpunkt und Referrer. Die CSP (`font-src 'self'`) verbietet
das ohnehin; hier steht, womit die Regel erfüllt wird.

## Warum zugeschnitten

Ungeschnitten wiegt allein Inter 352 kB. Zugeschnitten auf den lateinischen
Bereich sind es 63 kB, die beiden Mono-Schnitte je ~29 kB — zusammen 122 kB.

Der Schnitt umfasst Latin-1 (also alle deutschen Umlaute und das ß), die
typografischen Anführungszeichen, Gedankenstrich, Auslassungspunkte, Pfeile
und das Euro-Zeichen.

⚠️ **Bewusst nicht enger.** Die Proportionalschrift zeigt auch *entschlüsselte
fremde Texte* und *Namen aus Kontakten*. Ein engerer Schnitt liesse einzelne
Zeichen mitten im Absatz auf die Systemschrift zurückfallen — man sähe dem Text
dann an, dass er Sonderzeichen enthält, und er sähe kaputt aus. Was ausserhalb
von Latin liegt (Griechisch, Kyrillisch, CJK, Emoji), fällt weiterhin auf die
Systemschrift zurück; das ist der Zustand von vorher und dort in Ordnung, weil
es den ganzen Textlauf betrifft und nicht einzelne Zeichen darin.

## Neu erzeugen

```sh
LATIN="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,\
U+2000-206F,U+2074,U+20AC,U+2122,U+2191-2193,U+2212,U+2215,U+FEFF,U+FFFD"

pyftsubset InterVariable.woff2 --unicodes="$LATIN" --flavor=woff2 \
  --layout-features='kern,liga,calt,tnum' --output-file=inter-var-latin.woff2

pyftsubset JetBrainsMono-Regular.ttf --unicodes="$LATIN" --flavor=woff2 \
  --layout-features='kern,calt' --output-file=jetbrains-mono-latin.woff2
```

⚠️ Bei Inter muss die **variable Fassung** die Quelle sein und die
Gewichtsachse erhalten bleiben — sonst stünde jede Fettung als synthetisch
verzerrte Regular da. `tnum` (Ziffern gleicher Breite) ist kein Schmuck: die
Oberfläche zeigt Zahlen, die sich beim Aktualisieren ändern, und ohne
Tabellenziffern springt die Zeile.
