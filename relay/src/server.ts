/**
 * Der Zustellserver — Modus B.
 *
 * ⚠️ Er ist eine BEQUEMLICHKEIT, kein Sicherheitsgewinn. Modus A braucht ihn
 *    nicht, und die Oberfläche sagt das an der Stelle, an der man ihn
 *    einschaltet.
 *
 * Was er sieht: Postfach-Kennung, Ciphertext, Zeitstempel, Verfallszeit.
 * Was er NICHT sieht: Klartext, Schlüssel, Namen, Absender.
 *
 * ## Warum Long-Polling und nicht SSE
 *
 * `EventSource` kann keine Kopfzeilen setzen. Mit SSE müsste das Lesetoken in
 * die Adresse — und Abfragen landen in jedem Proxy-Protokoll der Welt. Genau
 * das wollen wir nicht. Long-Polling braucht am nginx nur ein erhöhtes
 * `proxy_read_timeout`, kein `proxy_buffering off`, kein Sonderverhalten.
 * Weniger bewegliche Teile heisst hier: weniger, das falsch stehen kann.
 */

import { randomBytes } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import { Herausforderungen, neuesToken, pruefeBesitz, tokenHash, tokenStimmt } from './auth.ts';
import { Speicher, STANDARD_GRENZEN, type Grenzen } from './db.ts';
import { Drossel } from './drossel.ts';
import { istKennung } from './postfach.ts';

export const LANGE_ABFRAGE_MAX_S = 25;
const AUFRAEUM_INTERVALL_MS = 10 * 60_000;

export interface ServerOptionen {
  readonly datenbank: string;
  readonly grenzen?: Grenzen;
  /** Einspeisbare Uhr — für Tests, damit niemand an der Systemzeit dreht. */
  readonly jetzt?: () => number;
}

export function baueServer(optionen: ServerOptionen): FastifyInstance {
  const jetzt = optionen.jetzt ?? Date.now;
  const grenzen = optionen.grenzen ?? STANDARD_GRENZEN;
  const speicher = new Speicher(optionen.datenbank, grenzen);
  const herausforderungen = new Herausforderungen();

  // Absenden: 30 je Minute und IP, 60 je Stunde und Postfach.
  const drosselIp = new Drossel(30, 60);
  const drosselPostfach = new Drossel(60, 3600);
  /**
   * Einrichten ist teuer (Signaturprüfung), also gedrosselt — aber nicht zu
   * eng.
   *
   * ⚠️ Die Drossel zählt pro IP, und hinter einem gemeinsamen Anschluss teilen
   *    sich alle Bewohner eine. Fünf Vorgänge in fünf Minuten sperrten damit
   *    schon einen Haushalt aus, in dem zwei Leute nacheinander ihr Postfach
   *    einrichten — im Abnahmetest ist genau das passiert. Zwanzig schützen
   *    immer noch vor Missbrauch und stehen niemandem im Weg.
   */
  const drosselEinrichten = new Drossel(20, 300);

  const app = Fastify({
    // ⚠️ KEIN Zugriffsprotokoll. Fastifys Voreinstellung schreibt IP, Pfad und
    //    Dauer jeder Anfrage — bei einem Dienst, der Metadaten vermeiden soll,
    //    wäre das genau das Gegenteil. `logger: false` schaltet beides ab; die
    //    frühere Zusatzoption `disableRequestLogging` ist abgekündigt und wäre
    //    hier ohnehin doppelt gemoppelt.
    logger: false,
    bodyLimit: grenzen.maxNachricht + 4096,
    trustProxy: true,
  });

  /** Wartende Langabfragen je Postfach — damit ein Absenden sie sofort weckt. */
  const wartende = new Map<string, Set<() => void>>();

  function wecke(kennung: string): void {
    for (const auf of wartende.get(kennung) ?? []) auf();
    wartende.delete(kennung);
  }

  function ip(anfrage: FastifyRequest): string {
    return anfrage.ip;
  }

  // -------------------------------------------------------------- Absenden

  // ⚠️ Der Rumpf ist `| undefined` typisiert, weil er es zur Laufzeit auch ist:
  //    eine POST-Anfrage ohne Inhalt liefert kein Objekt. Fastifys Typen sind
  //    an der Stelle optimistischer als die Wirklichkeit, und ein Zugriff ohne
  //    Absicherung wäre ein Absturz, den jeder mit curl auslösen kann.
  app.post<{ Params: { kennung: string }; Body: { blob?: unknown } | undefined }>(
    '/v1/mailbox/:kennung',
    async (anfrage, antwort) => {
      const { kennung } = anfrage.params;
      if (!istKennung(kennung)) return await antwort.code(400).send({ fehler: 'kennung' });

      const t = jetzt();
      if (!drosselIp.erlaubt(ip(anfrage), t) || !drosselPostfach.erlaubt(kennung, t)) {
        return await antwort.code(429).send({ fehler: 'zu-viele' });
      }

      const blob = anfrage.body?.blob;
      if (typeof blob !== 'string' || blob.length === 0) {
        return await antwort.code(400).send({ fehler: 'kein-inhalt' });
      }
      if (Buffer.byteLength(blob, 'utf8') > grenzen.maxNachricht) {
        return await antwort.code(413).send({ fehler: 'zu-gross' });
      }
      // ⚠️ Nur Ciphertext. Der Server prüft NICHT, ob er entschlüsselbar ist —
      //    das könnte er gar nicht —, aber er nimmt auch nichts an, was
      //    offensichtlich Klartext ist.
      if (!blob.includes('-----BEGIN PGP MESSAGE-----')) {
        return await antwort.code(400).send({ fehler: 'kein-ciphertext' });
      }

      const belegung = speicher.belegung(kennung);
      if (belegung.anzahl >= grenzen.maxProPostfach ||
          belegung.bytes + blob.length > grenzen.maxBytesProPostfach) {
        return await antwort.code(507).send({ fehler: 'postfach-voll' });
      }

      const id = randomBytes(12).toString('base64url');
      speicher.lege({
        id, mailbox_id: kennung, blob,
        created_at: Math.floor(t / 1000),
        expires_at: Math.floor(t / 1000) + grenzen.ttl,
      });
      wecke(kennung);
      return await antwort.code(202).send({ id });
    },
  );

  // ------------------------------------------------------------- Einrichten

  app.post<{ Body: { kennung?: unknown } | undefined }>('/v1/challenge', async (anfrage, antwort) => {
    const t = jetzt();
    if (!drosselEinrichten.erlaubt(ip(anfrage), t)) {
      return await antwort.code(429).send({ fehler: 'zu-viele' });
    }
    const kennung = anfrage.body?.kennung;
    if (!istKennung(kennung)) return await antwort.code(400).send({ fehler: 'kennung' });
    return await antwort.send(herausforderungen.stelle(kennung, t));
  });

  app.post<{ Body: { kennung?: unknown; schluessel?: unknown; nonce?: unknown; signatur?: unknown } | undefined }>(
    '/v1/register',
    async (anfrage, antwort) => {
      const t = jetzt();
      if (!drosselEinrichten.erlaubt(ip(anfrage), t)) {
        return await antwort.code(429).send({ fehler: 'zu-viele' });
      }
      const { kennung, schluessel, nonce, signatur } = anfrage.body ?? {};
      if (!istKennung(kennung) || typeof schluessel !== 'string' ||
          typeof nonce !== 'string' || typeof signatur !== 'string') {
        return await antwort.code(400).send({ fehler: 'unvollstaendig' });
      }
      if (!herausforderungen.verbrauche(nonce, kennung, t)) {
        return await antwort.code(401).send({ fehler: 'herausforderung' });
      }

      const geprueft = await pruefeBesitz(kennung, schluessel, nonce, signatur);
      if (!geprueft.ok) return await antwort.code(401).send({ fehler: geprueft.fehler });

      // ⚠️ Ab hier wird der öffentliche Schlüssel NICHT mehr angefasst. Was
      //    bleibt, ist der Hash eines Zufallstokens.
      const token = neuesToken();
      speicher.legePostfachAn(kennung, tokenHash(token), Math.floor(t / 1000));
      return await antwort.send({ token });
    },
  );

  // ---------------------------------------------------------------- Abholen

  function berechtigt(anfrage: FastifyRequest, kennung: string): boolean {
    const kopf = anfrage.headers.authorization ?? '';
    const token = kopf.startsWith('Bearer ') ? kopf.slice(7) : '';
    if (token.length === 0) return false;
    const postfach = speicher.postfach(kennung);
    if (postfach === undefined) return false;
    return tokenStimmt(token, postfach.token_hash);
  }

  app.get<{ Params: { kennung: string }; Querystring: { wait?: string } | undefined }>(
    '/v1/mailbox/:kennung/messages',
    async (anfrage, antwort) => {
      const { kennung } = anfrage.params;
      if (!istKennung(kennung)) return await antwort.code(400).send({ fehler: 'kennung' });
      if (!berechtigt(anfrage, kennung)) return await antwort.code(401).send({ fehler: 'nicht-berechtigt' });

      const sofort = speicher.hole(kennung, Math.floor(jetzt() / 1000));
      if (sofort.length > 0) return await antwort.send({ nachrichten: alsAntwort(sofort) });

      // Langabfrage: bis zu `wait` Sekunden offen halten. Ein Absenden weckt
      // sofort auf, sonst kommt eine leere Antwort.
      const warten = Math.min(LANGE_ABFRAGE_MAX_S, Math.max(0, Number(anfrage.query?.wait ?? 0)));
      if (warten === 0) return await antwort.send({ nachrichten: [] });

      await new Promise<void>((weiter) => {
        const zeitgeber = setTimeout(() => { loese(); weiter(); }, warten * 1000);
        const auf = (): void => { clearTimeout(zeitgeber); loese(); weiter(); };
        const loese = (): void => { wartende.get(kennung)?.delete(auf); };
        const menge = wartende.get(kennung) ?? new Set<() => void>();
        menge.add(auf);
        wartende.set(kennung, menge);
      });

      return await antwort.send({ nachrichten: alsAntwort(speicher.hole(kennung, Math.floor(jetzt() / 1000))) });
    },
  );

  app.delete<{ Params: { kennung: string }; Body: { ids?: unknown } | undefined }>(
    '/v1/mailbox/:kennung/messages',
    async (anfrage, antwort) => {
      const { kennung } = anfrage.params;
      if (!istKennung(kennung)) return await antwort.code(400).send({ fehler: 'kennung' });
      if (!berechtigt(anfrage, kennung)) return await antwort.code(401).send({ fehler: 'nicht-berechtigt' });

      const ids = anfrage.body?.ids;
      if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) {
        return await antwort.code(400).send({ fehler: 'ids' });
      }
      return await antwort.send({ geloescht: speicher.loesche(kennung, ids as string[]) });
    },
  );

  app.get('/v1/status', async (_anfrage, antwort) =>
    await antwort.send({ dienst: 'klartext-relay', grenzen }));

  // ------------------------------------------------------------ Aufräumen

  const aufraeumer: ReturnType<typeof setInterval> = setInterval(() => {
    const t = jetzt();
    speicher.raeumeAuf(Math.floor(t / 1000));
    drosselIp.raeumeAuf(t);
    drosselPostfach.raeumeAuf(t);
    drosselEinrichten.raeumeAuf(t);
  }, AUFRAEUM_INTERVALL_MS);
  // Der Zeitgeber darf den Prozess nicht am Leben halten.
  if (typeof aufraeumer === 'object') aufraeumer.unref();

  app.addHook('onClose', async () => {
    clearInterval(aufraeumer);
    speicher.schliesse();
    await Promise.resolve();
  });

  // Für Tests zugänglich, ohne die Kapselung im Betrieb aufzugeben.
  Object.defineProperty(app, 'speicher', { value: speicher, enumerable: false });
  return app;
}

function alsAntwort(nachrichten: readonly { id: string; blob: string; created_at: number }[]) {
  return nachrichten.map((n) => ({ id: n.id, blob: n.blob, erstellt: n.created_at }));
}

/**
 * Direkt gestartet: horchen.
 *
 * ⚠️ Beide Endungen prüfen. Der Quelltext heisst `server.ts`, das
 *    ausgelieferte Ergebnis `server.js` — mit nur einer der beiden startet der
 *    Server entweder im Betrieb nicht oder er startet mitten im Testlauf.
 *    Ersteres ist genau passiert: der gebaute Server tat gar nichts und gab
 *    dabei auch nichts aus.
 */
if (/[/\\]server\.(ts|js)$/.test(process.argv[1] ?? '')) {
  const app = baueServer({ datenbank: process.env['KLARTEXT_DB'] ?? './data/relay.db' });
  const port = Number(process.env['PORT'] ?? 4265);

  // ⚠️ Die Vorgabe ist 127.0.0.1 und bleibt es. Der Dienst gehört hinter einen
  //    Webserver, der ihn unter DERSELBEN Herkunft wie die App weiterreicht —
  //    die CSP der App lautet `connect-src 'self'`, alles andere lehnt der
  //    Browser ab, bevor eine Anfrage hinausgeht.
  //
  //    Umstellbar ist es trotzdem, denn in einem Container ist 127.0.0.1 die
  //    Container-Schleife: der Dienst wäre von aussen unerreichbar und die
  //    Portweiterleitung liefe ins Leere. Wer HOST setzt, tut es also bewusst;
  //    ein Test hält fest, dass die VORGABE sich nie ändert.
  const host = process.env['HOST'] ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1') {
    process.stderr.write(
      `Achtung: der Zustellserver horcht auf ${host}, nicht nur auf der Schleife. ` +
        'Das ist nur richtig, wenn davor ein Webserver steht, der ihn unter derselben ' +
        'Herkunft wie die App ausliefert.\n',
    );
  }

  app.listen({ port, host }).catch((fehler: unknown) => {
    process.stderr.write(`Start fehlgeschlagen: ${String(fehler)}\n`);
    process.exit(1);
  });
}
