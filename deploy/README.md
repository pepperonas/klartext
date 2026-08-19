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

## Noch offen (Phase 5)

* Build-Hash und Subresource Integrity im UI — erst damit ist die Zusage aus
  `THREAT-MODEL.md` §1 ueberpruefbar.
* Reproduzierbarer Build wird zwar in CI geprueft, aber noch nicht
  veroeffentlicht (Hash pro Fassung).
* Service-Worker/PWA (Phase 2).
