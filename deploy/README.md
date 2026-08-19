# Auslieferung

Ziel: `klartext.celox.io` auf dem VPS (69.62.121.168), nginx 1.24, statisch.

## Erstmalig

```bash
ssh root@69.62.121.168 'mkdir -p /var/www/klartext.celox.io'
scp deploy/nginx-klartext.conf root@69.62.121.168:/etc/nginx/sites-available/klartext.celox.io
ssh root@69.62.121.168 'ln -sf /etc/nginx/sites-available/klartext.celox.io /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx'
ssh root@69.62.121.168 'certbot certonly --nginx -d klartext.celox.io'
# danach den TLS-Block in den vhost eintragen (siehe Kommentar dort) und
# renew_hook = systemctl reload nginx in die Erneuerungsdatei
```

## Aktualisieren

```bash
npm run test:alles                       # NICHT ueberspringen
rsync -avz --delete app/dist/ root@69.62.121.168:/var/www/klartext.celox.io/
ssh root@69.62.121.168 'chown -R www-data:www-data /var/www/klartext.celox.io && chmod -R u=rwX,go=rX /var/www/klartext.celox.io'
```

Kein Neustart noetig — es gibt keinen Dienst, nur Dateien.

## Fallstricke

**nginx 1.24 kennt kein `http2 on;`.** Nur die alte Form: `listen 443 ssl http2;`.
Ab 1.25 waere es andersherum.

**Ein `add_header` in einem `location`-Block wirft ALLE geerbten Header weg.**
`try_files … /index.html` leitet intern nach `location = /index.html` um — dort
muessen deshalb saemtliche Sicherheits-Header wiederholt stehen, sonst faehrt
ausgerechnet die Startseite ohne CSP aus.

**`expires 1y;` UND `add_header Cache-Control …` ergeben zwei widerspruechliche
Zeilen** in der Antwort. Nur eins von beidem, mit vollstaendigem Wert.

**`require-trusted-types-for 'script'` blockiert den `Worker`-Konstruktor**,
solange keine Richtlinie existiert. Die App bringt sie mit (`klartext-worker`),
und die CSP laesst genau diesen einen Namen zu. Wer die Direktive anfasst, muss
`npm run e2e` laufen lassen — der Testserver sendet dieselbe CSP wie nginx.

**Kein Umami auf dieser Domain.** Der zentrale Rollout (`/opt/umami/rollout.py`)
darf sie nicht einsammeln; im vhost steht ein Kommentar dazu.

**`camera=()` ist Absicht.** Phase 3 bringt das Abscannen von QR-Codes zur
Fingerprint-Pruefung — dann muss dort `camera=(self)` stehen, sonst scheitert
`getUserMedia` ohne erkennbaren Grund.

## Zustellserver (Modus B)

```bash
npm run relay:build                       # relay/dist
ssh root@69.62.121.168 'useradd -r -s /usr/sbin/nologin -d /opt/klartext-relay klartext || true'
ssh root@69.62.121.168 'mkdir -p /opt/klartext-relay/data'
rsync -avz --delete relay/dist/ root@69.62.121.168:/opt/klartext-relay/dist/
rsync -avz relay/package.json root@69.62.121.168:/opt/klartext-relay/
ssh root@69.62.121.168 'cd /opt/klartext-relay && npm install --omit=dev'
scp deploy/klartext-relay.service root@69.62.121.168:/etc/systemd/system/
ssh root@69.62.121.168 'chown -R klartext:klartext /opt/klartext-relay && systemctl daemon-reload && systemctl enable --now klartext-relay'
```

**Port 4265, nur auf 127.0.0.1.** nginx reicht `/relay/` durch.

> ⚠️ Der erste Anlauf lief auf 4264 — dort horcht bereits gunicorn, und der
> Dienst drehte sich unbemerkt in einer Neustartschleife (`activating`, nicht
> `failed`, weil `Restart=` greift). Die Portliste in der Haus-Doku war nicht
> aktuell. **Vor jedem neuen Dienst selbst nachsehen** und danach den Zustand
> prüfen, nicht nur den Start absetzen:
> ```sh
> ss -tlnp | grep -oE '127\.0\.0\.1:4[0-9]{3}' | sort -u
> systemctl is-active klartext-relay   # muss `active` sagen, nicht `activating`
> ```

⚠️ **Der Zustellserver MUSS unter derselben Herkunft liegen.** Die CSP der App
erlaubt `connect-src 'self'`; ein Server auf einem anderen Host wird vom Browser
abgelehnt, bevor eine Anfrage hinausgeht. Das ist Absicht und keine Panne — so
kann klartext strukturell mit niemandem sonst sprechen. Aufgefallen im
zweiseitigen Abnahmetest, wo das Relay zunächst auf einem eigenen Port lief.

⚠️ **`proxy_read_timeout` muss über 25 s liegen** — der Server hält eine
Langabfrage so lange offen. `proxy_buffering off` braucht es NICHT; es ist eine
gewöhnliche Antwort, kein Datenstrom. Genau deshalb Long-Polling statt SSE.

⚠️ **Kein `X-Real-IP`, kein `X-Forwarded-For`.** Der Zustellserver soll die
Adresse des Absenders gar nicht erst sehen. Er drosselt dann über die Adresse
des Proxys — was bedeutet, dass sich alle Nutzer ein Kontingent teilen. Für
einen Freundeskreis ist das der richtige Tausch.

⚠️ **`node-sqlite3-wasm` statt `better-sqlite3`:** keine Übersetzung beim
Ausrollen, kein Compiler auf dem Server. `npm install --omit=dev` holt nur
fertige Dateien.

⚠️ **Die Relay-Datenbank gehört NICHT ins Backup.** Sie enthält ausschliesslich
Flüchtiges mit einer Aufbewahrung von sieben Tagen; eine Sicherung würde genau
das aufheben, was der Dienst vergessen soll. Der Ausschluss gehört in
`vps-data-backup.sh` — dessen SQLite-Suche ist dynamisch und nähme sie sonst
automatisch mit.

## Noch offen (Phase 5)

* Build-Hash und Subresource Integrity im UI — erst damit ist die Zusage aus
  `THREAT-MODEL.md` §1 ueberpruefbar.
* Reproduzierbarer Build wird zwar in CI geprueft, aber noch nicht
  veroeffentlicht (Hash pro Fassung).
* Service-Worker/PWA (Phase 2).
