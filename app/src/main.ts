import 'virtual:tokens.css';
import './ui/stil.css';

import { CryptoClient } from './crypto/client.ts';
import { erlaube, vertraue } from './trusted.ts';
import type { VaultStatus } from './crypto/protocol.ts';
import { el, suche } from './ui/dom.ts';
import { Navigation } from './ui/nav.ts';
import { Router, type Weg } from './ui/router.ts';
import { Schlosskerbe } from './ui/schlosskerbe.ts';
import { AnlegenAblauf } from './ui/views/anlegen.ts';
import { ExportAnsicht } from './ui/views/export.ts';
import { Postfach } from './relay/postfach.ts';
import { EinladungAnsicht } from './ui/views/einladung.ts';
import { EinstellungenAnsicht } from './ui/views/einstellungen.ts';
import { GespraechAnsicht } from './ui/views/gespraech.ts';
import { infoAnsicht } from './ui/views/info.ts';
import { KontakteAnsicht } from './ui/views/kontakte.ts';
import { SchluesselAnsicht } from './ui/views/schluessel.ts';
import { WerkzeugAnsicht } from './ui/views/werkzeug.ts';

const client = CryptoClient.erzeuge();
const router = new Router();
const kerbe = new Schlosskerbe();
const bereich = el('main', { class: 'haupt', id: 'haupt' });

const nav = new Navigation((weg) => { router.gehe(weg); });

const schluessel = new SchluesselAnsicht({
  client,
  beiAnlegen: () => { ablauf = null; router.gehe({ ziel: 'neu', schritt: 1 }); },
  beiExport: (fingerprint) => { router.gehe({ ziel: 'export', kurz: fingerprint.slice(-16) }); },
  beiInfo: () => { router.gehe({ ziel: 'info' }); },
});

const werkzeug = new WerkzeugAnsicht({
  client,
  beiEntsperren: () => { router.gehe({ ziel: 'schluessel' }); },
  beiAnlegen: () => { router.gehe({ ziel: 'neu', schritt: 1 }); },
});

const postfach = new Postfach(client);

const kontakte = new KontakteAnsicht({
  client,
  beiEinladen: () => { router.gehe({ ziel: 'einladen' }); },
  beiGespraech: (fingerprint) => { router.gehe({ ziel: 'gespraech', kurz: fingerprint.slice(-16) }); },
});

const gespraech = new GespraechAnsicht({
  client, postfach,
  beiZurueck: () => { router.gehe({ ziel: 'kontakte' }); },
});

const einstellungen = new EinstellungenAnsicht({
  client,
  beiInfo: () => { router.gehe({ ziel: 'info' }); },
});

const einladung = new EinladungAnsicht({
  beiEinladen: () => { router.gehe({ ziel: 'einladen' }); },
  client,
  beiKontakte: () => { router.gehe({ ziel: 'kontakte' }); },
  beiSchluessel: () => { router.gehe({ ziel: 'schluessel' }); },
});

const exportAnsicht = new ExportAnsicht({
  client,
  beiZurueck: () => { router.gehe({ ziel: 'schluessel' }); },
});

/** Der Ablauf lebt nur, solange er läuft — mit ihm die Passphrase im Speicher. */
let ablauf: AnlegenAblauf | null = null;

function ablaufHolen(): AnlegenAblauf {
  ablauf ??= new AnlegenAblauf({
    client,
    beiSchritt: (schritt) => { router.gehe({ ziel: 'neu', schritt }); },
    beiFertig: () => { ablauf = null; router.gehe({ ziel: 'schluessel' }); },
    beiAbbruch: () => { ablauf = null; router.gehe({ ziel: 'schluessel' }); },
  });
  return ablauf;
}

// ------------------------------------------------------------------- Rahmen

function kopfzeile(): HTMLElement {
  // Die Wortmarke führt nach Hause statt auf "#" zu zeigen und nichts zu tun.
  const marke = el('button', { class: 'wortmarke', type: 'button', text: 'klartext', 'aria-label': 'klartext — zur Übersicht' });
  marke.addEventListener('click', () => { router.gehe({ ziel: 'schluessel' }); });

  const sperren = el('button', { class: 'knopf still', type: 'button', text: 'Sperren' });
  sperren.addEventListener('click', () => { void client.sperre('manual'); });

  const thema = el('button', {
    class: 'knopf still', type: 'button', text: 'Thema',
    'aria-label': 'Zwischen hellem und dunklem Thema wechseln',
  });
  thema.addEventListener('click', wechsleThema);

  // Die Sperranzeige ist selbst bedienbar: anklicken sperrt bzw. springt zur
  // Eingabe. Eine Anzeige, die aussieht wie ein Bedienelement, sollte eines sein.
  kerbe.wurzel.addEventListener('click', () => {
    if (client.status.state === 'unlocked') void client.sperre('manual');
    else document.querySelector<HTMLInputElement>('#pw')?.focus();
  });

  return el('header', { class: 'kopf' },
    marke, kerbe.wurzel,
    el('div', { class: 'kopf-knoepfe' }, sperren, thema));
}

function fusszeile(): HTMLElement {
  const grenzen = el('button', { class: 'fuss-link', type: 'button', text: 'Was klartext nicht kann' });
  grenzen.addEventListener('click', () => { router.gehe({ ziel: 'info' }); });

  return el('footer', { class: 'fuss' },
    grenzen,
    el('p', { text: `© ${String(new Date().getFullYear())} Martin Pfeffer | ` },
      el('a', { href: 'https://celox.io', text: 'celox.io' })));
}

/**
 * Themawechsel als Kreis-Aufblende.
 *
 * ⚠️ Der Standard-Übergang des Browsers MUSS abgeschaltet werden, sonst blendet
 *    er old und new zusätzlich ineinander und legt sie mit `plus-lighter`
 *    übereinander — zwei volle Bilder addieren sich zu einer ausgewaschenen
 *    Fläche. Die Regeln stehen in stil.css unter `.thema-wechsel`.
 */
function wechsleThema(ereignis: MouseEvent): void {
  const wurzel = document.documentElement;
  const neu = aktuellesThema() === 'dunkel' ? 'hell' : 'dunkel';
  const anwenden = (): void => { wurzel.dataset['theme'] = neu; };

  if (globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches || !('startViewTransition' in document)) {
    anwenden();
    return;
  }
  const x = ereignis.clientX;
  const y = ereignis.clientY;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  wurzel.style.setProperty('--kt-reveal-x', `${String(x)}px`);
  wurzel.style.setProperty('--kt-reveal-y', `${String(y)}px`);
  wurzel.style.setProperty('--kt-reveal-r', `${String(radius)}px`);
  wurzel.classList.add('thema-wechsel');
  const uebergang = document.startViewTransition(anwenden);
  void uebergang.finished.finally(() => { wurzel.classList.remove('thema-wechsel'); });
}

function aktuellesThema(): 'hell' | 'dunkel' {
  const gesetzt = document.documentElement.dataset['theme'];
  if (gesetzt === 'hell' || gesetzt === 'dunkel') return gesetzt;
  return globalThis.matchMedia('(prefers-color-scheme: light)').matches ? 'hell' : 'dunkel';
}

// ------------------------------------------------------------------ Anzeige

function setzeInhalt(knoten: HTMLElement): void {
  while (bereich.firstChild !== null) bereich.removeChild(bereich.firstChild);
  bereich.appendChild(knoten);
}

async function zeige(weg: Weg): Promise<void> {
  nav.markiere(weg);
  // ⚠️ Ein weiterlaufender Kamerastrom hinter einer verlassenen Ansicht wäre
  //    unentschuldbar. Beim Wegnavigieren wird er ausdrücklich abgeschaltet.
  if (weg.ziel !== 'kontakte') kontakte.verlasse();
  // ⚠️ Ebenso die Langabfrage: eine offene Verbindung hinter einer verlassenen
  //    Ansicht verrät dem Server Anwesenheit, die ihn nichts angeht.
  if (weg.ziel !== 'gespraech') gespraech.verlasse();
  const status = client.status;

  if (weg.ziel === 'info') { setzeInhalt(infoAnsicht()); return; }

  if (weg.ziel === 'einstellungen') {
    setzeInhalt(einstellungen.wurzel);
    await einstellungen.zeichne();
    return;
  }

  if (weg.ziel === 'gespraech') {
    if (status.state !== 'unlocked') { router.ersetze({ ziel: 'schluessel' }); return; }
    setzeInhalt(gespraech.wurzel);
    await gespraech.zeichne(weg.kurz);
    return;
  }

  if (weg.ziel === 'kontakte') {
    setzeInhalt(kontakte.wurzel);
    await kontakte.zeichne(status);
    return;
  }

  if (weg.ziel === 'einladen') {
    setzeInhalt(einladung.wurzel);
    await einladung.zeichneErzeugen();
    return;
  }

  if (weg.ziel === 'empfangen') {
    // ⚠️ Das Fragment wird aus location gelesen, nicht aus dem Weg — es soll
    //    nirgends durch die App gereicht werden, wo es versehentlich in eine
    //    Adresse oder ein Protokoll geraten könnte.
    setzeInhalt(einladung.wurzel);
    await einladung.zeichneEmpfangen(location.hash);
    return;
  }

  if (weg.ziel === 'werkzeug') {
    setzeInhalt(werkzeug.wurzel);
    await werkzeug.zeichne(status);
    return;
  }

  // Anlegen und Exportieren setzen einen entsperrten (bzw. leeren) Bund voraus.
  if (weg.ziel === 'neu') {
    if (status.state === 'locked') { router.ersetze({ ziel: 'schluessel' }); return; }
    const a = ablaufHolen();
    setzeInhalt(a.wurzel);
    a.zeigeSchritt(weg.schritt);
    return;
  }

  if (weg.ziel === 'export') {
    if (status.state !== 'unlocked') { router.ersetze({ ziel: 'schluessel' }); return; }
    setzeInhalt(exportAnsicht.wurzel);
    await exportAnsicht.zeichne(weg.kurz);
    return;
  }

  setzeInhalt(schluessel.wurzel);
  await schluessel.zeichne(status);
}

// -------------------------------------------------------------------- Start

async function starte(): Promise<void> {
  const wurzel = suche('#app');
  wurzel.appendChild(kopfzeile());
  wurzel.appendChild(nav.wurzel);
  wurzel.appendChild(bereich);
  wurzel.appendChild(fusszeile());

  await client.ladeEinstellungen();
  client.verdrahteSperrausloeser();

  let letzterZustand: VaultStatus['state'] | null = null;
  client.beobachte((status) => {
    kerbe.zeige(status);
    // „Sperren" nur zeigen, wenn es etwas zu sperren gibt. Ein Knopf, der
    // nichts tut, ist schlimmer als keiner — er behauptet eine Möglichkeit.
    document.querySelector('.kopf-knoepfe button')?.classList.toggle('weg', status.state !== 'unlocked');

    if (status.state !== letzterZustand) {
      letzterZustand = status.state;
      void zeige(router.aktuell);
    }
  });

  router.starte((weg) => { void zeige(weg); });
  await client.aktualisiereStatus();
}

void starte();

/**
 * Service Worker anmelden — dafür, dass Modus A auch im Flugmodus läuft.
 *
 * Bewusst NACH dem Start und ohne Warten: die App funktioniert auch ohne ihn,
 * und ein Fehler hier darf sie nicht aufhalten.
 */
const SW_URL = erlaube('/sw.js');

if ('serviceWorker' in navigator) {
  globalThis.addEventListener('load', () => {
    // ⚠️ `register()` ist ebenfalls eine TrustedScriptURL-Senke. Ohne die
    //    Richtlinie blockiert die CSP die Anmeldung STILL — die App läuft
    //    weiter, nur der Flugmodus funktioniert nie. Gefunden allein dadurch,
    //    dass der Datenabfluss-Test die Browser-Konsole mitliest.
    void navigator.serviceWorker.register(vertraue(SW_URL), { scope: '/' }).catch(() => {
      // Ohne Service Worker fehlt nur der Offline-Betrieb — kein Grund zur Aufregung.
    });
  });
}
