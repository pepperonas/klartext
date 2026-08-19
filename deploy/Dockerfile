# Der Zustellserver als Abbild — für alle, die ihn nicht per systemd betreiben.
#
# ⚠️ Die APP steckt bewusst NICHT mit drin. Sie ist statisch und gehört hinter
#    denselben Webserver, der auch /relay/ weiterreicht: die CSP der App lautet
#    `connect-src 'self'`, der Zustellserver MUSS also unter derselben Herkunft
#    erreichbar sein. Zwei getrennte Herkünfte funktionieren nicht — das ist
#    Absicht, nicht Vergesslichkeit.

FROM node:22-alpine AS bau
WORKDIR /bau
COPY package.json package-lock.json ./
COPY relay/package.json relay/
COPY app/package.json app/
# `npm ci` braucht die Arbeitsbereiche aus dem Lock; die App-Abhängigkeiten
# holt es dabei mit, im fertigen Abbild landen sie nicht.
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY relay ./relay
RUN npx tsc -p relay/tsconfig.build.json && rm -rf relay/dist/src

FROM node:22-alpine
# Kein root. Der Dienst nimmt Daten von aussen entgegen.
RUN addgroup -S klartext && adduser -S -G klartext klartext
WORKDIR /opt/klartext-relay
COPY package.json package-lock.json ./
COPY relay/package.json relay/
RUN npm ci --omit=dev --ignore-scripts --workspace @klartext/relay \
    && npm cache clean --force
COPY --from=bau /bau/relay/dist ./dist
RUN mkdir -p data && chown -R klartext:klartext /opt/klartext-relay
USER klartext
ENV PORT=4265 HOST=127.0.0.1 KLARTEXT_DB=/opt/klartext-relay/data/relay.db
EXPOSE 4265
CMD ["node", "dist/server.js"]
