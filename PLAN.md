# PLAN.md — `klartext`

> Status: **Entwurf, wartet auf Bestätigung.** Vor deinem OK entsteht kein Produktivcode.
> Stand: 2026-08-19

---

## 0. Bestätigte Entscheidungen

Alle Empfehlungen aus Phase 0 sind übernommen:

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Argon2id vs. GPG-Export | **Zwei Formate.** Vault = Argon2id + AEAD, Export = `iterated+salted` |
| 2 | Curve25519-Variante | **v4 / `ed25519Legacy`** (GnuPG ≥ 2.1) |
| 3 | Relay-Zugriffsschutz | **Signatur-Challenge** bei Registrierung, danach Read-Token |
| 4 | Relay-Deployment | **systemd** + Nicht-Root-User; `docker-compose.yml` liegt bei |
| 5 | Frontend-Stack | **Vanilla TS + Vite**, kein Framework, eigene Feder-Engine |
| 6 | Repo | **öffentlich** `pepperonas/klartext` |
| 7 | GPG-Interop-Tests | `brew install gnupg`, Fixtures ins Repo, Regenerier-Skript |
| 8 | UI-Sprache | **Deutsch** |
| 9a | Gruppennachrichten | ja, Phase 4 |
| 9b | Multi-Device | nur manueller verschlüsselter Export/Import |
| 9c | Web Push | **nein** |
| 10 | Analytics/Umami | **nein**, ausdrücklich nicht |

Ohne Rückfrage entschieden: nginx · `listen 443 ssl http2;` (nginx 1.24) · npm-Workspaces · TypeScript **6.0.3** · Relay-Port **4264** · Zustellung siehe §5.3.

---

## 1. Was in Phase 0 gemessen statt geraten wurde

Fünf Spikes gegen OpenPGP.js 6.3.1, weil davon die Architektur abhängt:

1. `s2kType: argon2` auf einem v4-Key → **`Error: Using Argon2 S2K without AEAD is not allowed`**.
2. Argon2 **+ `aeadProtect: true`** auf v4 → funktioniert. Aber AEAD-geschützte *v4*-Secret-Keys sind ein
   Draft-Format (OpenPGP.js führt dafür eigens `parseAEADEncryptedV4KeysAsLegacy`). **GnuPG liest sie nicht.**
3. v6-Keys verlangen `type: 'curve25519'`; `ed25519Legacy` wird dort abgelehnt.
4. **Der Vault-Pfad trägt:** Key mit Argon2id+AEAD erzeugt → entsperrt → mit `iterated+salted` re-verschlüsselt
   → identischer Fingerprint, `aead: false`, GnuPG-lesbares Format. Damit ist §3.2 kein Wunschdenken.
5. Argon2-WASM ist **im Bundle** (keine Extra-Dependency), braucht aber `'wasm-unsafe-eval'` in der CSP.
   Das ist *nicht* `'unsafe-eval'`, sondern die enge Direktive nur für WASM-Kompilierung.

Nebenbefund mit Konsequenz: v4-Fingerprints sind **SHA-1, 160 Bit** (40 Hex). Das gehört ins Threat-Model,
nicht unter den Teppich — siehe §7.

---

## 2. Architektur in einem Bild

```
┌─ Main-Thread ────────────────┐        ┌─ Web Worker ─────────────────────┐
│  UI, Motion, Router          │  RPC   │  OpenPGP.js 6.3.1                │
│  kennt: Fingerprints,        │ ◄────► │  IndexedDB-Vault                 │
│         Public Keys,         │        │  Auto-Lock-Timer                 │
│         Ciphertext,          │        │  ── hier und NUR hier liegen ──  │
│         Klartext zur Anzeige │        │     entsperrte Private Keys      │
└──────────────────────────────┘        └──────────────────────────────────┘
              │
              │  nur bei Modus B, nur Ciphertext
              ▼
┌─ Relay (VPS, :4264 loopback) ────────────────────────────────────────────┐
│  Fastify + SQLite(WAL).  Tabelle: (mailbox_id, blob, created, expires)   │
│  Kein Klarname, keine IP-Logs, keine Public Keys im Ruhezustand.         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Der Vault liegt im Worker, nicht im Main-Thread.** Das ist die wichtigste Strukturentscheidung: der
entsperrte Private Key existiert damit in einem Realm, den kein UI-Code, keine Router-Logik und kein
Drittskript je betritt. Der Main-Thread importiert `openpgp` überhaupt nicht — was ein Test erzwingt (§6).

---

## 3. Krypto-Kern

### 3.1 Schlüsselerzeugung

| | Default | Alternative |
|---|---|---|
| Typ | **RSA-4096** | Curve25519 (`type:'ecc'`, `curve:'ed25519Legacy'`) |
| Hash | SHA-512 | SHA-512 |
| Symmetrisch | AES-256 | AES-256 |
| Key-Version | v4 | v4 |

RSA-4096 bleibt Default wegen maximaler GPG-Kompatibilität, wie gefordert. Die Keygen-Dauer streut
prinzipbedingt stark (Primsuche ist Zufall; in Node gemessen ~0,9 s, im Browser deutlich mehr, Ausreißer
möglich) → **Fortschrittsanzeige mit ehrlicher Formulierung** („Das kann eine Minute dauern"), kein
Fake-Progressbar. Läuft im Worker, die UI bleibt bedienbar.

### 3.2 Zwei S2K-Formate — die zentrale Regel

```
Ruhezustand (IndexedDB)   Argon2id + AEAD    passes 3, parallelism 4, memoryExponent 16 (64 MiB)
Export (.asc)             iterated+salted    s2kIterationCountByte 255, kein AEAD  → GnuPG liest es
Import                    beides
```

Der Export re-verschlüsselt beim Speichern-Klick, was ohnehin einen entsperrten Vault voraussetzt.
Es kostet also nichts und niemand muss zwischen „sicher" und „kompatibel" wählen.
Der Export-Dialog fragt eine **eigene** Export-Passphrase ab und sagt im Klartext, dass die Datei
schwächer geschützt ist als der Vault — weil GnuPG es nicht anders kann.

### 3.3 Worker-Protokoll

Diskriminierte Union, ein `id` pro Aufruf, kein `any`:

```ts
type Req =
  | { op: 'vault.status' }
  | { op: 'vault.unlock';  passphrase: string }
  | { op: 'vault.lock' }
  | { op: 'key.generate';  algo: 'rsa4096'|'curve25519'; userId: UserId; passphrase: string }
  | { op: 'key.import';    armored: string; passphrase?: string }
  | { op: 'key.export';    fingerprint: string; secret: boolean; exportPassphrase?: string }
  | { op: 'encrypt';       plaintext: string; to: string[]; signWith?: string }
  | { op: 'decrypt';       armored: string }
  | { op: 'sign';          text: string; detached: boolean }
  | { op: 'verify';        text: string; signature?: string }
  | { op: 'file.encrypt';  handle: FileSystemFileHandle | File; to: string[] }
  /* … */
```

Antworten immer `{ id, ok: true, result } | { id, ok: false, error: KlartextError }`.
`KlartextError` ist eine geschlossene Fehlerliste mit deutschen Klartext-Meldungen — kein
`e.message` aus der Bibliothek durchreichen, weil dort Pfade und interne Zustände auftauchen können.

### 3.4 Auto-Lock

- Leerlauf-Timeout, Default **15 Min**, einstellbar.
- `visibilitychange` → versteckt: Sperre nach **Karenzzeit, Default 30 s**; wählbar *sofort / 30 s / 5 Min / nie*.
  **Bewusste Abweichung von „sofort" mit Begründung:** der Kern-Workflow von Modus A ist
  *verschlüsseln → Tab wechseln → in Signal einfügen*. Bei 0 s Karenz sperrt genau diese Handbewegung
  den Vault. Das Ergebnis auf dem Schirm ist Ciphertext, also nicht schützenswert; die Karenz kostet
  30 s Angriffsfenster gegen jemanden, der bereits am entsperrten Gerät sitzt. Wenn du „sofort" als
  Default willst, ist es eine Zeile — sag Bescheid.
- `pagehide` / `beforeunload`: Referenzen fallenlassen.
- Beim Sperren werden Schlüsselobjekte dereferenziert und, wo es ein `Uint8Array` ist, überschrieben.
  **JS kann Speicher nicht zuverlässig löschen** (GC, unveränderliche Strings) — das steht so im
  Threat-Model und im Info-Screen, statt ein Versprechen zu geben, das die Sprache nicht hält.

### 3.5 IndexedDB

```
keys      { fingerprint, label, algo, created, isDefault, armoredPublic, armoredSecretArgon2 }
contacts  { fingerprint, name, armoredPublic, trust: 'unverified'|'verified',
            addedAt, verifiedAt, previousFingerprints[] }
messages  { id, contactFp, direction, ciphertextArmored, createdAt }   // Phase 4
settings  { autoLockMinutes, lockOnHidden, theme, relayUrl }
```

Nie gespeichert: Passphrase, entsperrter Key, Klartext. Die lokale Historie liegt als Ciphertext an den
eigenen Schlüssel — Historie lesen setzt also einen entsperrten Vault voraus.

---

## 4. Frontend

### 4.1 Stack

Vanilla TS + Vite 8, npm-Workspaces, TypeScript 6.0.3 (`strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), ESLint 10 + typescript-eslint 8.

**Laufzeit-Abhängigkeiten: genau eine — `openpgp`.** Alles andere (Feder-Engine, QR-Encoder,
Routing, DOM) ist eigener Code. Begründung je Abhängigkeit steht in `CLAUDE.md`; jede neue braucht
dort einen Absatz, sonst kommt sie nicht rein.

QR: eigener Encoder (Byte-Modus, Level Q) — der xword-Weg, dort schon einmal gegen Chromes
`BarcodeDetector` und über Reed-Solomon-Syndrome gegengeprüft. Spart eine Dependency in einer App,
deren ganzer Punkt Vertrauenswürdigkeit ist.

### 4.2 Das Namensmotiv als Bewegung

Beim Verschlüsseln zerfallen die Zeichen sichtbar in den Armored-Block, beim Entschlüsseln setzen
sie sich zusammen. Umsetzung:

- Feder-Physik (kein Easing), gestaffelt pro Zeichen, **Gesamtdauer < 400 ms**.
- **Höchstens ~300 animierte Spans**; längere Texte animieren den sichtbaren Anfang und blenden den
  Rest über. Sonst baut ein 40-kB-Text 40.000 DOM-Knoten und die „Eleganz" wird zum Ruckler.
- Läuft **nach** dem Worker-Ergebnis und rein kosmetisch. Der Krypto-Pfad wartet nie auf eine Animation;
  ein Test pinnt, dass das Ergebnis auch bei `prefers-reduced-motion` sofort vollständig im DOM steht.
- `prefers-reduced-motion` → gar keine Animation, direkter Zustandswechsel.

### 4.3 Das Namensmotiv als Produktregel

Jede Sicherheitsaussage im UI ist ein prüfbarer Satz. Verboten: „militärisch", „100 %", „unknackbar",
„bankensicher". Ein Lint-artiger Test (`tests/wording.test.ts`) durchsucht die UI-Strings gegen eine
Liste von Superlativen und schlägt fehl, wenn eins auftaucht. Der Info-Screen mit den Grenzen aus
`THREAT-MODEL.md` ist **von der Startseite in einem Tap** erreichbar und heißt „Was klartext nicht kann".

### 4.4 Gestaltung

- Tokens als Single Source of Truth in `src/design/tokens.ts`, Regeln in `.claude/rules/frontend-m3e.md`.
- Dark als Default, Light verfügbar. Theme-Wechsel als Circular Reveal über View Transitions —
  inklusive der Hausfalle: UA-Default abschalten (`animation:none` + `mix-blend-mode:normal` auf
  `::view-transition-old/new(root)`, `isolation:auto`), gescoped auf eine Klasse, sonst wäscht
  `plus-lighter` die Seite milchig aus.
- Schrift **self-hosted, subsetted woff2**: Inter (proportional, Klartext) + JetBrains Mono
  (Ciphertext, Fingerprints). Beide OFL. Der Typwechsel ist der Zustandsanzeiger.
- Persistenter Vault-Indikator in der App-Bar: Zustand **und Restzeit** bis zum Auto-Lock.
- Vollständige Tastaturbedienung, ARIA, sichtbare Fokusringe, Kontrast AA.
  ⚠️ Aus der Hauserfahrung mitgenommen: Kontrast wird **im laufenden Browser gemessen**, nicht
  geschätzt — Farben über Canvas-Pixel lesen statt per Regex zerlegen, halbdurchsichtige Gründe über
  die Vorfahren rechnen, nie während einer View-Transition messen.
- Footer auf jeder Seite: `© {Jahr} Martin Pfeffer | celox.io`.
- Mobile-first, PWA, Offline für Modus A. Service-Worker **network-first** für die Shell,
  versionierter Cache `klartext-vN`, Bump bei jeder Shell-Änderung.

---

## 5. Relay (Modus B)

### 5.1 Datenmodell — bewusst arm

```sql
CREATE TABLE messages (
  id         TEXT PRIMARY KEY,      -- zufällig, nicht ableitbar
  mailbox_id TEXT NOT NULL,         -- SHA-256("klartext-mailbox-v1" || fingerprint), base64url
  blob       BLOB NOT NULL,         -- ASCII-armored Ciphertext
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE mailboxes (
  mailbox_id  TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL,        -- SHA-256 des Read-Tokens
  created_at  INTEGER NOT NULL
);
```

Das ist die vollständige Liste. **Kein Public Key im Ruhezustand, keine Absender-Spalte, keine
Empfangsbestätigung an Dritte, keine IP.** Ein Test liest das reale Schema aus und schlägt fehl,
sobald eine Spalte dazukommt, die hier nicht steht.

### 5.2 Zugriff

Die Mailbox-ID ist **nicht geheim** — sie muss aus dem Public Key berechenbar sein, sonst bräuchte
es ein Verzeichnis. Daraus folgt die Aufteilung:

- **Senden** (`POST /v1/mailbox/:id`): offen für jeden, der den Public Key hat. Genau so ist es gemeint.
  Rate-Limit + Größenlimit + Mailbox-Kontingent.
- **Registrieren** (einmalig): `POST /v1/challenge` → Nonce; Client signiert
  `klartext-relay-auth:v1:<mailboxId>:<nonce>` mit dem Private Key; `POST /v1/register` liefert
  `{mailboxId, publicKey, nonce, signature}`. Server prüft **beides**: dass
  `derive(fingerprint(publicKey)) === mailboxId` und dass die Signatur stimmt. Damit ist die Bindung
  selbstzertifizierend — der Server *glaubt* nichts, er *rechnet nach*. Danach: Public Key verwerfen,
  nur `sha256(readToken)` bleibt.
- **Abholen / Löschen** (`GET`, `DELETE`): `Authorization: Bearer <readToken>`.

Wer nur den Public Key kennt, kann also schreiben, aber nicht lesen und nicht leeren.
Der Public Key erreicht den Server **einmal bei der Registrierung** — das ist ein echtes,
unvermeidbares Restrisiko und steht als solches im Threat-Model.

### 5.3 Zustellung: Long-Polling — und warum nicht SSE

**Entschieden: Long-Polling** (`GET /v1/messages?wait=25`, Server hält bis 25 s, dann leere Antwort).

- `EventSource` **kann keine Header setzen**. Mit SSE müsste der Read-Token in die URL — und
  Query-Strings landen in jedem Proxy-Log der Welt. Genau das wollen wir nicht. (Der Ausweg,
  SSE von Hand über `fetch` + `ReadableStream` zu lesen, gibt die Header zurück, kostet aber
  eigenes Framing, eigenen Reconnect und eigenen Backoff.)
- Long-Polling braucht am nginx nur ein erhöhtes `proxy_read_timeout`, kein `proxy_buffering off`,
  kein Sonderverhalten. Weniger bewegliche Teile heißt in einem Zero-Knowledge-Dienst: weniger,
  das falsch stehen kann.
- Der Effizienzvorteil von SSE ist bei einer Handvoll Freunde bedeutungslos.
- Beide verraten Anwesenheit gleichermaßen. SSE gewinnt hier also nichts, kostet aber Header-Auth.

### 5.4 Aufbewahrung und Löschung

- TTL Default **7 Tage**, konfigurierbar.
- **Löschen nach ausdrücklicher Bestätigung, nicht beim Lesen**: der Client holt, entschlüsselt,
  speichert lokal — und schickt danach ein `DELETE` mit den IDs. Ein Abbruch im Mobilfunk darf
  keine Nachricht vernichten. Die TTL bleibt als Fangnetz.
- Cleanup-Job im Prozess (alle 10 Min) + `PRAGMA secure_delete = ON`, damit gelöschte Blobs nicht
  als Seitenrest in der Datei stehenbleiben.
- Rate-Limits: Senden 30/min pro IP und 60/h pro Mailbox; ein offener Long-Poll pro Token;
  Nachricht ≤ **2 MiB**, Mailbox ≤ 100 Nachrichten bzw. 32 MiB.
- **Keine Logs mit Personenbezug:** Fastify mit `disableRequestLogging`, eigener Serializer ohne
  IP/URL/Body; nginx `access_log off` für die API-Location.
- ⚠️ **Backup-Ausschluss (sonst ist die TTL eine Lüge):** dein `vps-data-backup.sh` sucht SQLite-DBs
  *dynamisch* — die Relay-DB liefe automatisch mit und gelöschte Nachrichten überlebten einen Monat
  in `/var/backups`. Phase 5 trägt einen expliziten Ausschluss ein. Die Relay-DB wird **nicht**
  gesichert; sie enthält ausschließlich Flüchtiges.

---

## 6. Tests und Definition of Done

| Was | Womit |
|---|---|
| Units, Krypto, Vault | Vitest (Node), `fake-indexeddb` |
| **GPG-Interop** | Fixtures aus echtem `gpg` in `fixtures/gpg/`, erzeugt von `tools/gen-gpg-fixtures.sh` mit Wegwerf-`GNUPGHOME`. Beide Richtungen: gpg→klartext (Pub/Sec-Import, Entschlüsseln, Signatur prüfen, Widerrufszertifikat) und klartext→gpg (nur wenn `gpg` vorhanden, Gate `KLARTEXT_GPG=1`) |
| **Kein Klartext auf der Leitung** | Playwright: `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` werden abgefangen; jeder Request wird gegen Marker-Klartext, Passphrase und `PRIVATE KEY BLOCK` geprüft. Zusätzlich statisch: der Main-Thread-Bundle darf `openpgp` nicht enthalten |
| **Relay sieht nichts** | Pro Endpoint: bekannte Marker rein, danach DB-Datei *und* Logs gegen die Marker prüfen. Plus Schema-Test (§5.1) |
| Wording | `tests/wording.test.ts` gegen Marketing-Superlative |
| A11y | Lighthouse ≥ 95, in CI |
| Reproduzierbarkeit | zweimal bauen, Hashes vergleichen |
| Lieferkette | `npm audit --audit-level=high`, `npm ci` (Lockfile-Drift = rot) |

⚠️ Zwei Fallstricke aus der Hauserfahrung gelten hier ausdrücklich: Textprüfungen auf Code laufen
**gegen den kommentarfreien Quelltext** (ein Erklärkommentar zitiert sonst genau das, was er verbietet),
und **jeder neue Pin wird einmal mutiert** — ein Test, den man nicht hat scheitern sehen, ist keine Zusicherung.

**DoD pro Phase:** TS strict ohne `any`, 0 ESLint-Warnungen, Tests grün, die beiden
Nichts-verlässt-den-Browser-Tests grün, Lighthouse-A11y ≥ 95, Commit mit sauberer Message,
danach kurzer Bericht an dich.

---

## 7. Sicherheits-Header, CSP, Auslieferung

```
Content-Security-Policy:
  default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self';
  font-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self';
  manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';
  object-src 'none'; require-trusted-types-for 'script'
Strict-Transport-Security: max-age=63072000; includeSubDomains
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Permissions-Policy: camera=(self), geolocation=(), microphone=(), accelerometer=(),
                    payment=(), usb=(), midi=(), serial=(), bluetooth=()
```

- `'wasm-unsafe-eval'` ausschließlich wegen Argon2 (§1.5) — begründet, nicht bequem.
- `camera=(self)` nur für **QR-Scannen bei der Fingerprint-Verifikation**, per `BarcodeDetector`,
  rein lokal, erst nach ausdrücklichem Tap. Safari kennt die API nicht → Rückfall auf manuellen
  Vergleich, der ohnehin immer verfügbar ist.
- `require-trusted-types-for 'script'` erzwingt die Disziplin „kein `innerHTML`" — in einer Krypto-App
  die richtige Fessel.
- **Kein Umami**, kein Sub-Filter. Ein Kommentar im vhost hält fest, dass das Absicht ist, damit ein
  künftiger Rollout die Datei nicht arglos mitnimmt.
- SRI + Build-Hash: Post-Build-Skript rechnet SHA-384 über die Entry-Assets, schreibt `integrity=`
  und injiziert den Gesamt-Hash. Der Info-Screen zeigt ihn samt Anleitung zum Nachrechnen —
  bei öffentlichem Repo ist das eine Aussage, die jemand tatsächlich prüfen kann.

**Lizenz:** OpenPGP.js steht unter **LGPL-3.0+**. Damit die Bedingungen sauber erfüllt sind, wird
`openpgp` als **eigener, unveränderter Chunk** ausgeliefert (nicht in den App-Bundle gemischt), die
Lizenz liegt bei und das Repo ist öffentlich. `klartext` selbst: **MIT**.

---

## 8. THREAT-MODEL.md — was offen benannt wird

1. **Code-Delivery-Trust.** Der Server liefert bei *jedem* Aufruf den Krypto-Code aus. Wer ihn
   kontrolliert, kann eine Fassung ausliefern, die Schlüssel abzieht. Kein Web-Design kann das lösen;
   Build-Hash und öffentliches Repo machen es nur nachprüfbar. Das ist der wichtigste Satz des Dokuments.
2. **Keine Forward Secrecy.** PGP hat keine. Wer heute mitschneidet und in fünf Jahren an den Private Key
   kommt, liest alles rückwirkend. Signal kann das besser; `klartext` ist ein anderes Werkzeug.
3. **Metadaten-Restrisiko beim Relay.** Zeitpunkte, Größen, Anwesenheit. Der Public Key erreicht den
   Server einmal bei der Registrierung. Wer den Server *und* die Public Keys des Kreises hat, kann
   Mailbox-IDs zuordnen.
4. **Der Browser ist die Angriffsfläche.** Erweiterungen lesen die Seite mit. XSS wäre fatal — daher
   Trusted Types, `default-src 'none'`, kein `innerHTML`, eine einzige Laufzeit-Abhängigkeit.
5. **Speicher lässt sich in JS nicht zuverlässig löschen.** Auto-Lock verkleinert das Zeitfenster,
   er schließt es nicht.
6. **v4-Fingerprints sind SHA-1** (gemessen: 160 Bit). Für den Vergleich am Telefon reicht das heute;
   dass SHA-1 gegen Chosen-Prefix-Kollisionen gefallen ist, gehört trotzdem gesagt. Wer maximale
   Härte will, nimmt v6/SHA-256 und verzichtet auf GnuPG-2.4-Kompatibilität.
7. **Unverifizierte Kontakte.** Bis zum Fingerprint-Abgleich kann jemand beim Schlüsselaustausch
   dazwischenstehen. Das UI markiert das dauerhaft, nicht nur beim Anlegen.
8. **Die Passphrase ist die ganze Sicherheit des Vaults.** Argon2id macht Raten teuer, nicht unmöglich.

Diese acht Punkte stehen wortgleich im Info-Screen „Was klartext nicht kann".

---

## 9. Verzeichnisaufbau

```
klartext/
├─ PLAN.md  CLAUDE.md  THREAT-MODEL.md  README.md  LICENSE
├─ .claude/rules/frontend-m3e.md
├─ package.json                     # npm-Workspaces
├─ app/
│  ├─ index.html  vite.config.ts
│  ├─ public/     manifest.webmanifest, sw.js, Icons, Fonts
│  └─ src/
│     ├─ main.ts  router.ts
│     ├─ design/tokens.ts   motion/spring.ts
│     ├─ worker/            index.ts (einziger openpgp-Import), vault.ts, ops.ts
│     ├─ crypto/            client.ts, protocol.ts, errors.ts   (kein openpgp!)
│     ├─ ui/                views/, components/
│     ├─ contacts/          invite.ts, fingerprint.ts, qr.ts
│     └─ relay/             client.ts
├─ relay/src/               server.ts, db.ts, auth.ts, routes/, cleanup.ts
├─ fixtures/gpg/            von echtem gpg erzeugt
├─ tools/                   gen-gpg-fixtures.sh, build-hash.mjs, sri.mjs
└─ deploy/                  nginx-klartext.conf, klartext-relay.service, docker-compose.yml
```

---

## 10. Phasen

**Phase 1 — Krypto-Kern.** Worker + RPC, Keygen (RSA-4096 / Curve25519), Vault mit Argon2id,
Auto-Lock, Import/Export in beiden S2K-Formaten, Widerrufszertifikate. GPG-Fixtures + Interop-Tests.
*Fertig, wenn:* ein von `gpg` erzeugter Key hier funktioniert und ein hier erzeugter Key in `gpg` importiert.

**Phase 2 — Werkzeug-Modus.** Text und Dateien ver-/entschlüsseln, signieren, prüfen (auch detached).
Streaming über WebStreams, Speichern per File System Access API mit Blob-Rückfall und ehrlicher
Größenwarnung. Copy-to-Clipboard, Drag & Drop, Zerfalls-Animation, belastbare Fehler bei kaputtem
oder fremdem Ciphertext. PWA/Offline steht ab hier.
*Fertig, wenn:* die App im Flugmodus vollständig arbeitet.

**Phase 3 — Kontakte & Einladungen.** Kontaktverwaltung, Einladungslinks (Nutzlast im
`#`-Fragment, einmalig, mit Ablauf), QR anzeigen und scannen, Fingerprint-Verifikation mit
Wortliste, Trust-States, Warnung bei Schlüsselwechsel.
*Anmerkung:* als Wortliste ist die **PGP Word List** gesetzt (phonetisch auf Verwechslungssicherheit
gebaut, interoperabel) — englische Wörter zum Vorlesen. Falls dir eine deutsche Liste lieber ist,
sag es in Phase 3, der Austausch ist eine Tabelle.

**Phase 4 — Relay.** Fastify + SQLite, Registrierung per Signatur, Long-Polling, Konversationsansicht,
lokal verschlüsselte Historie, Zustellstatus, Gruppennachrichten. Das UI sagt an der Stelle, an der
man Modus B einschaltet, dass es **Bequemlichkeit ist und kein Sicherheitsgewinn**.

**Phase 5 — Härtung & Deployment.** CSP-Feinschliff, Header-Test, `THREAT-MODEL.md`, Info-Screen,
systemd-Unit + Compose-Datei, nginx-vhost, certbot mit `renew_hook`, Backup-Ausschluss (§5.4),
reproduzierbarer Build, Build-Hash im UI, CI.

---

## 11. Bekannte Risiken

| Risiko | Umgang |
|---|---|
| RSA-4096-Keygen im Browser dauert unvorhersehbar lang | Worker + ehrlicher Text; Curve25519 sichtbar als schnelle Alternative |
| Argon2 mit 64 MiB auf alten Android-Geräten | `Argon2OutOfMemoryError` wird abgefangen, Parameter fallen gestuft zurück, der Nutzer erfährt es |
| Trusted Types bricht eine Drittkomponente | Es gibt keine Drittkomponente außer openpgp; falls doch, wird die Direktive dokumentiert entfernt statt still |
| `BarcodeDetector` fehlt in Safari | QR-Scan ist Zusatz, der manuelle Vergleich ist der Hauptweg |
| Long-Poll hinter nginx läuft in Timeout | `proxy_read_timeout` > `wait`; Client-Backoff |
| Große Dateien sprengen den Speicher ohne FSA | Größenwarnung + harte Grenze im Blob-Rückfall |

---

## 12. Was ich als Nächstes tue

Auf dein OK: `git init`, öffentliches Repo `pepperonas/klartext`, Gerüst nach §9, `brew install gnupg`,
GPG-Fixtures erzeugen — und dann **Phase 1**. Danach Bericht, offene Punkte, Vorschlag für Phase 2.

**Zum Widersprechen bitte ich ausdrücklich bei:**
- §3.4 Karenzzeit 30 s statt „sofort" beim Tab-Wechsel,
- §5.3 Long-Polling statt SSE,
- §5.4 die Relay-DB bewusst *nicht* zu sichern,
- §10/Phase 3 englische PGP Word List.
