# THREAT-MODEL.md — was `klartext` nicht kann

> Diese Datei ist kein Kleingedrucktes. Ihre acht Punkte stehen wortgleich im
> Info-Screen der App und sind von der Startseite mit einem Tipp erreichbar.
>
> `klartext` in Backticks meint die Anwendung. Klartext ohne Backticks meint
> unverschlüsselten Text.

## Wogegen die App schützt

Gegen jemanden, der die Nachricht **unterwegs** mitliest: auf dem Weg durch
Signal, Mail oder Matrix, auf dem Server des jeweiligen Anbieters, im WLAN.
Genau dafür ist PGP gebaut, und dafür taugt es.

Und gegen jemanden, der **später** an das Gerät kommt: der private Schlüssel
liegt nur mit Argon2id verschlüsselt in IndexedDB. Ohne Passphrase ist er ein
Haufen Zufall.

Das ist die ganze Liste. Alles Weitere ist Beiwerk.

---

## 1. Der Server liefert bei jedem Aufruf den Code aus, der deine Schlüssel anfasst

Das ist der wichtigste Satz hier. Eine Webanwendung wird nicht einmal
installiert und dann geprüft — sie wird bei **jedem** Aufruf neu geladen. Wer
den Server kontrolliert oder das Zertifikat bricht, kann dir morgen eine
Fassung ausliefern, die deinen Schlüssel abzieht, und du merkst es nicht.

Keine Gestaltung dieser App löst das. Was sie tut, ist es **nachprüfbar**
machen:

* Der Quelltext ist öffentlich (`github.com/pepperonas/klartext`).
* Der Build ist reproduzierbar, der Hash steht im Info-Screen.
* Wer misstrauisch ist, baut selbst und vergleicht — oder lässt die App lokal
  laufen und lädt sie nie wieder vom Server.

Wenn dein Gegner die Betreiberin der Seite ist, ist eine Webanwendung das
falsche Werkzeug. Dann nimm GnuPG auf einem Rechner, den du selbst
kontrollierst. `klartext` liest und schreibt dasselbe Format.

## 2. PGP hat keine Forward Secrecy

Wer heute deinen Ciphertext aufzeichnet und in fünf Jahren an deinen privaten
Schlüssel kommt — durch Beschlagnahme, Erpressung, einen Fehler von dir —, kann
**alles rückwirkend** lesen. Jede Nachricht, die je an diesen Schlüssel ging.

Signal kann das besser: dort wechseln die Schlüssel fortlaufend, ein einzelner
geknackter Schlüssel gibt nur ein schmales Fenster preis. PGP hat dieses
Verfahren nicht, und `klartext` kann es nicht nachrüsten, ohne die
Kompatibilität zu GnuPG aufzugeben, die der Grund für seine Existenz ist.

Für dauerhaft heikle Gespräche ist Signal das bessere Werkzeug. `klartext` ist
für das gedacht, was ins Archiv soll und trotzdem verschlüsselt gehört.

## 3. Das Relay sieht Metadaten, auch wenn es den Inhalt nicht sieht

Der Zustellserver (Modus B, freiwillig) speichert nur:
Postfach-Kennung, Ciphertext, Zeitstempel, Verfallszeit. Kein Name, keine
IP-Protokolle, kein Absender.

Trotzdem sieht er, **dass** ein Postfach zu einem Zeitpunkt eine Nachricht
bekommt und **wie groß** sie ist. Wer den Server beobachtet, sieht daran
Aktivitätsmuster. Und: dein öffentlicher Schlüssel erreicht den Server **einmal**
bei der Einrichtung des Postfachs — er wird nicht gespeichert, aber er war da.
Wer den Server zu diesem Zeitpunkt kontrolliert, kann ihn mitschreiben.

Die Postfach-Kennung ist ein Hash deines Fingerprints. Der Server kann sie nicht
zurückrechnen — aber wer deinen öffentlichen Schlüssel ohnehin hat, kann sie
ausrechnen und dich damit wiedererkennen.

**Modus B ist Bequemlichkeit, kein Sicherheitsgewinn.** Wer das nicht will,
benutzt Modus A und schickt den Ciphertext über einen Kanal seiner Wahl. Modus A
braucht überhaupt keinen Server.

## 4. Der Browser ist die Angriffsfläche

Jede installierte Erweiterung kann grundsätzlich lesen, was auf dieser Seite
steht — auch deine entschlüsselten Nachrichten, auch das Feld, in das du deine
Passphrase tippst. Das ist kein Fehler von `klartext`, das ist die Bauform von
Browser-Erweiterungen.

Dagegen gerichtet: eine strenge Content-Security-Policy (`default-src 'none'`),
Trusted Types, kein `innerHTML` im gesamten Quelltext, **eine einzige**
Laufzeit-Abhängigkeit (OpenPGP.js), keine fremden Server, keine Schriften von
außen, keine Analyse-Werkzeuge.

Das erschwert eine Einschleusung über die App. Gegen eine bösartige Erweiterung
in deinem eigenen Browser hilft es nicht.

## 5. JavaScript kann Speicher nicht zuverlässig löschen

Die App sperrt sich nach Leerlauf (voreingestellt 15 Minuten) und wenn du den
Tab verlässt. Dabei werden die Verweise auf das Schlüsselmaterial fallengelassen.

Mehr ist technisch nicht drin: Zeichenketten sind in JavaScript unveränderlich,
wann der Speicher tatsächlich freigegeben wird, entscheidet die
Speicherbereinigung. Ein Speicherabbild des Browserprozesses kann den Schlüssel
oder die Passphrase also noch enthalten, nachdem die App "gesperrt" anzeigt.

Der Auto-Lock verkleinert das Zeitfenster. Er schließt es nicht.

## 6. Fingerprints sind SHA-1

Ein v4-OpenPGP-Fingerprint ist 160 Bit SHA-1 — auch bei `klartext`, weil genau
das die Kompatibilität zu jedem GnuPG herstellt. SHA-1 ist gegen
Chosen-Prefix-Kollisionen gefallen (SHAttered 2017, SHA-1 is a Shambles 2020).

Für den Abgleich am Telefon ist das heute in Ordnung: ein Angreifer müsste einen
zweiten Schlüssel mit **demselben** Fingerprint bauen, und das ist eine andere,
deutlich härtere Aufgabe als eine Kollision. Trotzdem gehört es gesagt, statt so
zu tun, als sei ein Fingerprint ein für alle Zeiten fester Anker.

Wer maximale Härte will, nimmt v6-Schlüssel mit SHA-256 — und verzichtet dafür
auf jedes GnuPG vor Version 2.5.

## 7. Ein unverifizierter Kontakt kann jemand anderes sein

Wenn du einen öffentlichen Schlüssel über einen Kanal bekommst, den ein
Angreifer kontrolliert, kann er dir seinen eigenen unterschieben, mitlesen und
weiterreichen. Beide Seiten sehen nichts.

Dagegen hilft **nur** der Abgleich des Fingerprints über einen zweiten Kanal:
vorlesen am Telefon, QR-Code beim Treffen. Deshalb markiert `klartext`
unverifizierte Kontakte dauerhaft — nicht nur beim Anlegen — und warnt, wenn ein
bekannter Kontakt plötzlich mit einem neuen Schlüssel auftaucht.

## 8. Die Passphrase ist die ganze Sicherheit deines Schlüsselbunds

Argon2id (3 Durchgänge, 64 MiB) macht Raten teuer. Es macht es nicht unmöglich.
Gegen "Sommer2024!" hilft kein Ableitungsverfahren der Welt.

Vier oder fünf zufällige Wörter sind besser als ein kurzes Wirrwarr aus
Sonderzeichen — leichter zu merken und schwerer zu raten.

---

## Bewusst nicht gelöste Punkte

| Punkt | Warum nicht |
|---|---|
| Verschlüsselte Betreffzeilen / Absender | PGP verschlüsselt den Inhalt, nicht den Umschlag. Modus A hat gar keinen Umschlag — den baut der Kanal, über den du schickst. |
| Deniability (Abstreitbarkeit) | Eine PGP-Signatur ist das Gegenteil davon: sie beweist dauerhaft, dass du es warst. Das ist manchmal erwünscht und manchmal genau falsch. Wer abstreiten können will, signiert nicht. |
| Schutz gegen ein kompromittiertes Betriebssystem | Ein Keylogger sieht die Passphrase beim Tippen. Dagegen kann eine Webanwendung nichts. |
| Anonymität | `klartext` verbirgt Inhalte, nicht dich. Wer unerkannt bleiben muss, braucht zusätzlich Tor — und dann ist Modus B ohnehin die falsche Wahl. |
