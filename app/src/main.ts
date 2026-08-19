import 'virtual:tokens.css';
import './ui/stil.css';

import { CryptoClient } from './crypto/client.ts';
import type { VaultStatus } from './crypto/protocol.ts';
import { el, suche } from './ui/dom.ts';
import { Schlosskerbe } from './ui/schlosskerbe.ts';
import { SchluesselAnsicht } from './ui/views/schluessel.ts';

const client = CryptoClient.erzeuge();
const kerbe = new Schlosskerbe();
const ansicht = new SchluesselAnsicht(client);

function kopfzeile(): HTMLElement {
  const sperren = el('button', { class: 'knopf still', type: 'button', text: 'Sperren' });
  sperren.addEventListener('click', () => { void client.sperre('manual'); });

  const thema = el('button', {
    class: 'knopf still',
    type: 'button',
    text: 'Thema',
    'aria-label': 'Zwischen hellem und dunklem Thema wechseln',
  });
  thema.addEventListener('click', wechsleThema);

  return el(
    'header',
    { class: 'kopf' },
    el('a', { class: 'wortmarke', href: '#', 'aria-label': 'klartext — Startseite' }, 'klartext'),
    kerbe.wurzel,
    el('div', { class: 'kopf-knoepfe' }, sperren, thema),
  );
}

function fusszeile(): HTMLElement {
  return el(
    'footer',
    { class: 'fuss' },
    el('p', { text: `© ${String(new Date().getFullYear())} Martin Pfeffer | ` }, el('a', { href: 'https://celox.io', text: 'celox.io' })),
  );
}

/**
 * Themawechsel als Kreis-Aufblende ueber die View-Transitions-API.
 *
 * ⚠️ Der Standard-Uebergang des Browsers MUSS dabei abgeschaltet werden. Sonst
 *    blendet er old und new zusaetzlich ineinander und legt sie mit
 *    `mix-blend-mode: plus-lighter` uebereinander — zwei volle Bilder addieren
 *    sich dann zu einer ausgewaschenen Flaeche, und im Kreis steht die falsche
 *    Farbe. Die Regeln dafuer stehen in stil.css unter `.thema-wechsel`.
 */
function wechsleThema(ereignis: MouseEvent): void {
  const wurzel = document.documentElement;
  const neu = aktuellesThema() === 'dunkel' ? 'hell' : 'dunkel';

  const anwenden = (): void => { wurzel.dataset['theme'] = neu; };

  const reduziert = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduziert || !('startViewTransition' in document)) { anwenden(); return; }

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

function haupt(): HTMLElement {
  return el('main', { class: 'haupt', id: 'haupt' }, ansicht.wurzel);
}

async function starte(): Promise<void> {
  const wurzel = suche('#app');
  wurzel.appendChild(kopfzeile());
  wurzel.appendChild(haupt());
  wurzel.appendChild(fusszeile());

  await client.ladeEinstellungen();
  client.verdrahteSperrausloeser();

  let letzterZustand: VaultStatus['state'] | null = null;
  client.beobachte((status) => {
    kerbe.zeige(status);
    // Nur bei echtem Zustandswechsel neu zeichnen — sonst reisst jeder
    // Auto-Lock-Tick dem Nutzer das Formular unter den Fingern weg.
    if (status.state !== letzterZustand) {
      letzterZustand = status.state;
      void ansicht.zeichne(status);
    }
  });
  await client.aktualisiereStatus();
}

void starte();
