/**
 * Einladungslinks.
 *
 * Ein Link, den man dem Gegenüber schickt: er trägt den eigenen öffentlichen
 * Schlüssel, damit die andere Seite ihn nicht von Hand kopieren muss.
 *
 * ⚠️ Die Nutzlast steht im **Fragment** (hinter `#`), nicht in der Abfrage.
 *    Fragmente schickt der Browser NIE an einen Server: sie stehen in keinem
 *    Zugriffsprotokoll, in keinem Proxy-Mitschnitt, in keiner Referrer-Zeile.
 *    Bei `?k=…` läge der Schlüssel in jedem Log zwischen hier und dort.
 *
 * ⚠️ Der Fingerprint reist NICHT mit — er wird beim Empfänger aus dem Schlüssel
 *    gerechnet. Ein mitgeschickter Fingerprint wäre eine zweite Wahrheit neben
 *    dem Schlüssel, und zwei Wahrheiten kann jemand auseinanderlaufen lassen.
 *    So ist ein Widerspruch strukturell unmöglich.
 *
 * ## Kompaktes Binärformat statt JSON
 *
 * Der erste Anlauf packte den ASCII-armored Schlüssel in JSON und kodierte das
 * Ganze noch einmal base64 — ein RSA-4096-Link wurde damit **4606 Zeichen**
 * lang. Messenger kappen ab etwa 2000, und ein QR-Code dieser Grösse wäre
 * unlesbar. Der Schlüssel reist deshalb binär, und alles zusammen wird genau
 * einmal kodiert.
 *
 * ```
 *  0      Fassung                        (1 Byte)
 *  1..9   Kennung                        (9 Bytes)
 * 10..13  Ablauf, Epochensekunden        (uint32, big endian)
 * 14..15  Länge des Namens               (uint16, big endian)
 * 16..    Name                           (UTF-8)
 *   ..    öffentlicher Schlüssel, binär  (Rest)
 * ```
 *
 * ## Was „einmalig" heisst — und was nicht
 *
 * Ohne Server lässt sich nicht erzwingen, dass ein Link nur einmal geöffnet
 * wird. Durchsetzbar sind der **Ablauf** (beide Seiten prüfen ihn) und die
 * Buchführung auf der eigenen Seite. Das ist weniger schlimm, als es klingt:
 * der Inhalt ist ein ÖFFENTLICHER Schlüssel, wer ihn abfängt, erfährt nichts
 * Geheimes. Die eigentliche Gefahr ist ein UNTERGESCHOBENER Schlüssel — und
 * dagegen hilft kein einmaliger Link, sondern nur der Fingerprint-Abgleich über
 * einen zweiten Kanal.
 */

export const EINLADUNG_PFAD = '/e';
export const STANDARD_GUELTIG_TAGE = 7;
export const FASSUNG = 1;

const KOPF_LAENGE = 16;
const ID_LAENGE = 9;
/** Grob: RSA-4096 wiegt ~800 Byte, alles darüber ist kein Schlüssel mehr. */
const MAX_SCHLUESSEL = 8192;
const MAX_NAME = 200;

export interface Einladung {
  readonly fassung: number;
  readonly id: string;
  readonly name: string;
  /** Öffentlicher Schlüssel, binär. Der Fingerprint wird daraus gerechnet. */
  readonly schluessel: Uint8Array;
  readonly laeuftAb: number;
}

// -------------------------------------------------------- base64url ohne =

export function nachBase64Url(bytes: Uint8Array): string {
  let roh = '';
  for (const b of bytes) roh += String.fromCharCode(b);
  return btoa(roh).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function ausBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new RangeError('Kein base64url.');
  const roh = text.replace(/-/g, '+').replace(/_/g, '/');
  const binaer = atob(roh + '='.repeat((4 - (roh.length % 4)) % 4));
  const bytes = new Uint8Array(binaer.length);
  for (let i = 0; i < binaer.length; i++) bytes[i] = binaer.charCodeAt(i);
  return bytes;
}

// ------------------------------------------------------------- Bauen/Lesen

export interface BauOptionen {
  readonly name: string;
  /** Öffentlicher Schlüssel, binär — kommt aus dem Worker. */
  readonly schluessel: Uint8Array;
  readonly herkunft: string;
  readonly gueltigTage?: number;
  readonly jetzt?: number;
  readonly id?: string;
}

export function baueEinladung(optionen: BauOptionen): { url: string; einladung: Einladung } {
  const jetzt = optionen.jetzt ?? Date.now();
  const tage = optionen.gueltigTage ?? STANDARD_GUELTIG_TAGE;
  const name = optionen.name.slice(0, MAX_NAME);
  const nameBytes = new TextEncoder().encode(name);
  const id = optionen.id ?? nachBase64Url(crypto.getRandomValues(new Uint8Array(ID_LAENGE)));
  const idBytes = ausBase64Url(id);

  if (idBytes.length !== ID_LAENGE) throw new RangeError('Kennung hat die falsche Länge.');
  if (optionen.schluessel.length === 0) throw new RangeError('Kein Schlüssel angegeben.');

  const laeuftAb = Math.floor(jetzt / 1000) + tage * 86_400;

  const puffer = new Uint8Array(KOPF_LAENGE + nameBytes.length + optionen.schluessel.length);
  const sicht = new DataView(puffer.buffer);
  puffer[0] = FASSUNG;
  puffer.set(idBytes, 1);
  sicht.setUint32(10, laeuftAb, false);
  sicht.setUint16(14, nameBytes.length, false);
  puffer.set(nameBytes, KOPF_LAENGE);
  puffer.set(optionen.schluessel, KOPF_LAENGE + nameBytes.length);

  const basis = optionen.herkunft.replace(/\/+$/, '');
  return {
    url: `${basis}${EINLADUNG_PFAD}#${nachBase64Url(puffer)}`,
    einladung: { fassung: FASSUNG, id, name, schluessel: optionen.schluessel, laeuftAb },
  };
}

export type LeseFehler =
  | 'keine-einladung' | 'unlesbar' | 'falsche-fassung' | 'abgelaufen' | 'unvollstaendig';

export type LeseErgebnis =
  | { readonly ok: true; readonly einladung: Einladung }
  | { readonly ok: false; readonly fehler: LeseFehler; readonly meldung: string };

const MELDUNGEN: Readonly<Record<LeseFehler, string>> = {
  'keine-einladung': 'In diesem Link steckt keine Einladung.',
  unlesbar: 'Der Link ist beschädigt — vermutlich beim Kopieren abgeschnitten.',
  'falsche-fassung': 'Diese Einladung stammt aus einer neueren Fassung von klartext.',
  abgelaufen: 'Diese Einladung ist abgelaufen. Bitte um eine neue.',
  unvollstaendig: 'In der Einladung fehlen Angaben.',
};

export function leseEinladung(fragment: string, jetzt: number = Date.now()): LeseErgebnis {
  const nutzlast = fragment.replace(/^#/, '').trim();
  if (nutzlast.length === 0) return fehler('keine-einladung');

  let bytes: Uint8Array;
  try {
    bytes = ausBase64Url(nutzlast);
  } catch {
    return fehler('unlesbar');
  }
  if (bytes.length <= KOPF_LAENGE) return fehler('unlesbar');

  const fassung = bytes[0];
  if (fassung !== FASSUNG) return fehler('falsche-fassung');

  const sicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const laeuftAb = sicht.getUint32(10, false);
  const nameLaenge = sicht.getUint16(14, false);

  const schluesselStart = KOPF_LAENGE + nameLaenge;
  if (nameLaenge > MAX_NAME || schluesselStart >= bytes.length) return fehler('unvollstaendig');

  const schluessel = bytes.slice(schluesselStart);
  if (schluessel.length === 0 || schluessel.length > MAX_SCHLUESSEL) return fehler('unvollstaendig');

  let name: string;
  try {
    name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(KOPF_LAENGE, schluesselStart));
  } catch {
    return fehler('unlesbar');
  }

  if (Math.floor(jetzt / 1000) > laeuftAb) return fehler('abgelaufen');

  return {
    ok: true,
    einladung: {
      fassung: FASSUNG,
      id: nachBase64Url(bytes.slice(1, 1 + ID_LAENGE)),
      name, schluessel, laeuftAb,
    },
  };
}

function fehler(art: LeseFehler): LeseErgebnis {
  return { ok: false, fehler: art, meldung: MELDUNGEN[art] };
}

/**
 * Passt dieser Link noch in einen QR-Code?
 *
 * Gemessene Wirklichkeit: ein RSA-4096-Zertifikat wiegt binär rund 2330 Byte
 * und ergibt einen Link von ~3140 Zeichen. Der grösste QR-Code überhaupt fasst
 * 2953 Byte — RSA-4096 passt also GRUNDSÄTZLICH nicht, und zwar in keiner
 * Fehlerkorrekturstufe. Curve25519 wiegt 491 Byte, der Link ~685 Zeichen, und
 * landet bei einer bequem scannbaren Version.
 *
 * Die Oberfläche sagt das im Klartext, statt einen Code anzubieten, den kein
 * Telefon liest — und macht daraus ein echtes Argument für Curve25519.
 */
export const QR_HOECHSTMASS = 2953;

export function passtInQr(url: string): boolean {
  return new TextEncoder().encode(url).length <= QR_HOECHSTMASS;
}

export function restlaufzeit(einladung: Einladung, jetzt: number = Date.now()): string {
  const sekunden = einladung.laeuftAb - Math.floor(jetzt / 1000);
  if (sekunden <= 0) return 'abgelaufen';
  const tage = Math.floor(sekunden / 86_400);
  if (tage >= 1) return `noch ${String(tage)} ${tage === 1 ? 'Tag' : 'Tage'}`;
  const stunden = Math.floor(sekunden / 3600);
  if (stunden >= 1) return `noch ${String(stunden)} ${stunden === 1 ? 'Stunde' : 'Stunden'}`;
  return `noch ${String(Math.max(1, Math.floor(sekunden / 60)))} Minuten`;
}
