/**
 * „Was klartext nicht kann".
 *
 * Der Masterprompt verlangt, dass die Grenzen aus THREAT-MODEL.md von der
 * Startseite aus in einem Tipp erreichbar sind. Das ist kein Kleingedrucktes:
 * eine App, die Sicherheit verspricht, muss zuerst sagen, wo das Versprechen
 * aufhört. Die Punkte stehen hier im Wortlaut des Dokuments; ein Test hält
 * fest, dass es genauso viele sind wie dort.
 */

import { buildKennung, kurzform } from '../../build-kennung.ts';
import { el } from '../dom.ts';

/**
 * Zeigt, welcher Bau gerade läuft — und sagt in einem Satz, was das wert ist.
 *
 * ⚠️ Die Versuchung wäre, hier „geprüft" oder „verifiziert" zu schreiben.
 *    Geprüft hat niemand: die Zahl steht in derselben Datei, die der Server
 *    geschickt hat. Sie ist ein Vergleichswert, kein Nachweis — und der Text
 *    sagt genau das, samt dem Befehl, mit dem man es von aussen nachrechnet.
 */
function baustand(): HTMLElement {
  const kennung = buildKennung();
  if (kennung === null) {
    return el('section', { class: 'karte' },
      el('h3', { text: 'Welcher Bau läuft hier?' }),
      el('p', {
        text:
          'Diese Fassung trägt keine Baukennung — sie läuft aus dem Entwicklungsserver. ' +
          'Der ausgelieferte Stand auf klartext.celox.io trägt eine.',
      }));
  }

  return el('section', { class: 'karte' },
    el('h3', { text: 'Welcher Bau läuft hier?' }),
    el('p', { class: 'fingerprint', text: kurzform(kennung) }),
    el('p', {
      text:
        'Der Quelltext liegt offen, und zwei Bauläufe aus demselben Stand ergeben ' +
        'Byte für Byte dieselben Dateien. Wer nachrechnen will, baut das Repo und ' +
        'vergleicht mit dem, was der Server schickt:',
    }),
    el('pre', { class: 'befehl', text: 'curl -s https://klartext.celox.io/build.json' }),
    el('p', { class: 'hinweis' },
      el('strong', { text: 'Das ist ein Vergleichswert, kein Nachweis. ' }),
      'Ein Server, der dir falschen Code schickt, kann dir auch eine falsche Zahl ' +
      'schicken. Sie taugt dazu, eine Abweichung zu bemerken — von aussen, oder wenn ' +
      'etwas versehentlich auseinanderläuft. Gegen einen Server, der dich gezielt ' +
      'belügt, hilft nur GnuPG auf einem Rechner, den du selbst kontrollierst.'));
}

interface Grenze {
  readonly titel: string;
  readonly text: string;
}

const GRENZEN: readonly Grenze[] = [
  {
    titel: 'Der Server liefert bei jedem Aufruf den Code aus, der deine Schlüssel anfasst',
    text:
      'Eine Webanwendung wird nicht einmal installiert und dann geprüft — sie wird bei jedem ' +
      'Aufruf neu geladen. Wer den Server kontrolliert, kann dir morgen eine Fassung ' +
      'ausliefern, die deinen Schlüssel abzieht. Keine Gestaltung löst das. Nachprüfbar wird ' +
      'es dadurch, dass der Quelltext offenliegt und der Build reproduzierbar ist. Wenn dein ' +
      'Gegner die Betreiberin der Seite ist, nimm GnuPG auf einem Rechner, den du selbst ' +
      'kontrollierst — klartext liest und schreibt dasselbe Format.',
  },
  {
    titel: 'PGP hat keine Forward Secrecy',
    text:
      'Wer heute deinen Ciphertext aufzeichnet und in fünf Jahren an deinen privaten Schlüssel ' +
      'kommt, kann alles rückwirkend lesen. Signal kann das besser: dort wechseln die Schlüssel ' +
      'fortlaufend. PGP hat dieses Verfahren nicht, und klartext kann es nicht nachrüsten, ohne ' +
      'die GnuPG-Kompatibilität aufzugeben, die der Grund für seine Existenz ist.',
  },
  {
    titel: 'Das Relay sieht Metadaten, auch wenn es den Inhalt nicht sieht',
    text:
      'Der Zustellserver (Modus B, freiwillig) speichert nur Postfach-Kennung, ' +
      'Ciphertext, Zeitstempel und Verfallszeit. Trotzdem sieht er, dass ein Postfach zu einem ' +
      'Zeitpunkt etwas bekommt und wie groß es ist. Modus B ist Bequemlichkeit, kein ' +
      'Sicherheitsgewinn. Modus A braucht überhaupt keinen Server.',
  },
  {
    titel: 'Der Server prüft nicht, ob das Eingeworfene verschlüsselt ist',
    text:
      'Er nimmt Bytes entgegen und legt sie ab; ob es ein PGP-Block ist oder blanker Text, kann ' +
      'er nicht beurteilen — dafür müsste er hineinsehen. Verschlüsselt wird ausschließlich im ' +
      'Browser, bevor etwas dein Gerät verlässt. Und dein Postfach steht jedem offen, der deinen ' +
      'öffentlichen Schlüssel hat: so kann dir jemand schreiben, ohne dass es ein Verzeichnis ' +
      'gibt — unerwünschte Post eingeschlossen. Lesen kann es nur, wer den privaten Schlüssel hat.',
  },
  {
    titel: 'Der Browser ist die Angriffsfläche',
    text:
      'Jede installierte Erweiterung kann grundsätzlich lesen, was auf dieser Seite steht — auch ' +
      'entschlüsselte Nachrichten und das Feld, in das du deine Passphrase tippst. Dagegen ' +
      'gerichtet: eine strenge Content-Security-Policy, Trusted Types, kein innerHTML im ganzen ' +
      'Quelltext, eine einzige Laufzeit-Abhängigkeit, keine fremden Server. Gegen eine bösartige ' +
      'Erweiterung in deinem eigenen Browser hilft das nicht.',
  },
  {
    titel: 'JavaScript kann Speicher nicht zuverlässig löschen',
    text:
      'Die App sperrt sich nach Leerlauf und beim Verlassen des Tabs und lässt dabei die ' +
      'Verweise auf das Schlüsselmaterial fallen. Mehr ist technisch nicht drin: Zeichenketten ' +
      'sind unveränderlich, über die Freigabe entscheidet die Speicherbereinigung. Der ' +
      'Auto-Lock verkleinert das Zeitfenster. Er schließt es nicht.',
  },
  {
    titel: 'Fingerprints sind SHA-1',
    text:
      'Ein v4-OpenPGP-Fingerprint ist 160 Bit SHA-1 — genau das stellt die Kompatibilität zu ' +
      'jedem GnuPG her. SHA-1 ist gegen Chosen-Prefix-Kollisionen gefallen. Für den Abgleich am ' +
      'Telefon ist das heute in Ordnung, denn ein Angreifer bräuchte einen zweiten Schlüssel mit ' +
      'demselben Fingerprint. Gesagt gehört es trotzdem.',
  },
  {
    titel: 'Ein unverifizierter Kontakt kann jemand anderes sein',
    text:
      'Bekommst du einen öffentlichen Schlüssel über einen Kanal, den ein Angreifer ' +
      'kontrolliert, kann er dir seinen eigenen unterschieben, mitlesen und weiterreichen. ' +
      'Beide Seiten sehen nichts. Dagegen hilft nur der Abgleich des Fingerprints über einen ' +
      'zweiten Kanal — vorlesen am Telefon, QR-Code beim Treffen.',
  },
  {
    titel: 'Die Passphrase ist die ganze Sicherheit deines Schlüsselbunds',
    text:
      'Argon2id mit 64 MiB macht Raten teuer. Es macht es nicht unmöglich. Gegen ' +
      '„Sommer2024!" hilft kein Ableitungsverfahren der Welt. Vier oder fünf zufällige Wörter ' +
      'sind besser als ein kurzes Wirrwarr aus Sonderzeichen.',
  },
];

export function infoAnsicht(): HTMLElement {
  return el(
    'div',
    { class: 'ansicht' },
    el('h2', { class: 'ansicht-titel', text: 'Was klartext nicht kann' }),
    el('section', { class: 'karte' },
      el('p', {
        text:
          'Der Name ist doppeldeutig, und beides ist Absicht: Klartext ist der Zustand vor der ' +
          'Verschlüsselung — und das Versprechen, offen zu sagen, was diese App leistet und was ' +
          'nicht. Hier steht der zweite Teil.',
      }),
      el('p', { class: 'hinweis', text: 'Kein „militärisch", kein „100 % sicher". Nur Sätze, die man nachprüfen kann.' })),

    el('section', { class: 'karte' },
      el('h3', { text: 'Wogegen die App schützt' }),
      el('p', {
        text:
          'Gegen jemanden, der die Nachricht unterwegs mitliest: im Messenger, beim Mailanbieter, ' +
          'im WLAN. Dafür ist PGP gebaut, und dafür taugt es.',
      }),
      el('p', {
        text:
          'Und gegen jemanden, der später an dein Gerät kommt: der private Schlüssel liegt nur ' +
          'mit Argon2id verschlüsselt in diesem Browser. Ohne Passphrase ist er ein Haufen Zufall.',
      }),
      el('p', { class: 'hinweis', text: 'Das ist die ganze Liste. Alles Weitere steht unten.' })),

    ...GRENZEN.map((g, i) => el('section', { class: 'karte grenze' },
      el('h3', {}, el('span', { class: 'grenze-nr', text: String(i + 1) }), g.titel),
      el('p', { text: g.text }))),

    baustand(),

    el('section', { class: 'karte' },
      el('h3', { text: 'Bewusst nicht gelöst' }),
      el('ul', { class: 'liste' },
        el('li', { text: 'Verschlüsselte Betreffzeilen und Absender — PGP verschlüsselt den Inhalt, nicht den Umschlag.' }),
        el('li', { text: 'Abstreitbarkeit — eine Signatur beweist dauerhaft, dass du es warst. Wer abstreiten können will, signiert nicht.' }),
        el('li', { text: 'Schutz gegen ein kompromittiertes Betriebssystem — ein Keylogger sieht die Passphrase beim Tippen.' }),
        el('li', { text: 'Anonymität — klartext verbirgt Inhalte, nicht dich.' }))),
  );
}
