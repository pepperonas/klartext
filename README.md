# klartext

**PGP im Browser. Dein privater Schlüssel bleibt auf diesem Gerät.**

`klartext` verschlüsselt, entschlüsselt, signiert und prüft OpenPGP — vollständig
im Browser, ohne dass irgendetwas an einen Server geht. Was `gpg` erzeugt, liest
`klartext`. Was `klartext` erzeugt, liest `gpg`.

Der Name ist doppeldeutig, und beide Bedeutungen sind Absicht: Klartext ist der
Zustand vor der Verschlüsselung — und das Versprechen, offen zu sagen, was die
App leistet und was nicht. Was sie **nicht** kann, steht in
[`THREAT-MODEL.md`](THREAT-MODEL.md) und ist in der App einen Tipp weit entfernt.

> Kein „militärische Verschlüsselung", kein „100 % sicher". Ein Test in diesem
> Repo lässt solche Sätze gar nicht erst durch.

## Stand

**Phase 1 von 5 ist fertig** — der Krypto-Kern. Schlüssel erzeugen, ein
Schlüsselbund mit Passphrase-Schutz und Zeitsperre, Import und Export in beide
Richtungen zu GnuPG, Widerrufszertifikate.

Werkzeug-Modus, Kontakte, Relay und die Auslieferung folgen; die Phasen stehen
in [`PLAN.md`](PLAN.md).

## Zwei Betriebsarten

**Modus A — Werkzeug.** Text und Dateien lokal ver- und entschlüsseln. Heraus
kommt ein ASCII-Block, den du über einen beliebigen Kanal schickst — Signal,
Mail, Matrix. Braucht keinen Server und keine Verbindung.

**Modus B — Relay** (freiwillig, Phase 4). Ein eigener Zustellserver als
Briefkasten, der nur Ciphertext sieht. Das ist **Bequemlichkeit, kein
Sicherheitsgewinn**, und die App sagt das an der Stelle, an der man es
einschaltet.

## Kryptografie

Nichts davon ist selbst geschrieben. Die Krypto kommt vollständig aus
[OpenPGP.js](https://openpgpjs.org/) 6.3.1.

* **RSA-4096** als Vorgabe (SHA-512, AES-256) — höchste Kompatibilität.
* **Curve25519** als moderne Alternative, als v4-Schlüssel, damit jedes GnuPG
  ab 2.1 damit umgehen kann.
* Der Schlüsselbund ist mit **Argon2id** verschlüsselt (3 Durchgänge, 64 MiB).
* Der **Export** wird mit `iterated+salted` geschrieben — das ist das Einzige,
  was GnuPG annimmt. Der Export-Dialog sagt, dass die Datei damit schwächer
  geschützt ist als der Schlüsselbund.

Die gesamte Krypto und der gesamte Schlüsselbund liegen in einem **Web Worker**.
Der Haupt-Thread lädt die Kryptobibliothek nicht einmal — ein Test hält das
gegen den fertig gebauten Bundle fest.

## Selbst bauen

```bash
npm ci
npm run dev          # Entwicklungsserver
npm run build        # nach app/dist
```

Voraussetzung: Node ≥ 20.19.

## Prüfen

```bash
npm run pruefe       # lint + typecheck + Tests
npm run test:alles   # dazu Browserlauf und Zugänglichkeit
```

| Was | Umfang |
|---|---|
| Tests | 87, davon 18 gegen **echtes GnuPG** |
| Browserlauf | 10 Kriterien, u. a. dass nichts Geheimes eine Anfrage verlässt |
| Zugänglichkeit | WCAG 2.1 A + AA, 6 Zustände (3 Ansichten × 2 Themen), 0 Verstöße |

Die GPG-Testvektoren liegen unter `fixtures/gpg/` und stammen aus echtem GnuPG,
nicht aus OpenPGP.js — ein Interop-Test gegen die eigene Bibliothek beweist
nichts. Neu erzeugen mit `npm run fixtures` (braucht `gpg`).

> ⚠️ Die privaten Schlüssel in `fixtures/` sind Wegwerf-Testschlüssel mit
> öffentlich bekannter Passphrase. Nie für echte Kommunikation verwenden.

## Abhängigkeiten

**Zur Laufzeit genau eine: `openpgp`.** Kein Framework, keine
Motion-Bibliothek, kein QR-Paket, keine Analyse-Werkzeuge, keine Schriften von
fremden Servern. Jede weitere müsste in [`CLAUDE.md`](CLAUDE.md) begründet
werden.

## Lizenz

`klartext` steht unter der [MIT-Lizenz](LICENSE).

OpenPGP.js steht unter LGPL-3.0+ und wird als eigener, unveränderter Chunk
ausgeliefert — nicht in den App-Bundle gemischt. Damit bleibt das Neubinden
gegen eine geänderte Fassung möglich, wie die LGPL es verlangt.

---

© 2026 Martin Pfeffer | [celox.io](https://celox.io)
