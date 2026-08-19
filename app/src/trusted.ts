/**
 * Trusted-Types-Richtlinie für die beiden Skript-Adressen dieser App.
 *
 * Die CSP verlangt `require-trusted-types-for 'script'`. Damit sind BEIDE
 * Senken betroffen:
 *
 *   · `new Worker(url)`                    — der Krypto-Worker
 *   · `navigator.serviceWorker.register()` — der Offline-Worker
 *
 * ⚠️ Der zweite Fall war zunächst übersehen. Die Folge war heimtückisch: die
 *    App lief, der Offline-Test lief (sein Server sendete keine CSP), und nur
 *    in Produktion registrierte sich der Service Worker still nicht — der
 *    Flugmodus hätte also nie funktioniert. Aufgefallen ist es allein daran,
 *    dass der Datenabfluss-Test die Browser-Konsole mitliest.
 *
 * Die Richtlinie ist keine Formalie: sie lässt ausschließlich die beiden
 * bekannten Adressen durch. Wer eine dritte hineinreicht, bekommt eine
 * Ausnahme statt eines fremden Skripts.
 */

interface TrustedTypesFabrik {
  createPolicy: (
    name: string,
    regeln: { createScriptURL: (eingabe: string) => string },
  ) => { createScriptURL: (eingabe: string) => string };
}

export const POLICY_NAME = 'klartext-worker';

const ERLAUBT = new Set<string>();
let politik: { createScriptURL: (eingabe: string) => string } | null = null;

/**
 * Meldet eine Adresse als zulässig an. Beim Modulstart aufrufen.
 *
 * ⚠️ Hier wird bewusst NICHT aufgelöst: `erlaube` läuft auf oberster Ebene von
 *    `client.ts`, und ein Modul, das beim blossen Import `location` braucht,
 *    lässt sich ausserhalb des Browsers nicht einmal laden — auch nicht zum
 *    Testen. Aufgelöst wird erst in `vertraue`, und dort gibt es `location`.
 */
export function erlaube(url: string): string {
  ERLAUBT.add(url);
  return url;
}

function aufgeloest(url: string): string {
  return new URL(url, location.href).href;
}

/**
 * Gibt die Adresse in einer Form zurück, die die CSP annimmt.
 *
 * Ohne Trusted Types (ältere Browser) ist das die Adresse selbst — die
 * Prüfung findet trotzdem statt.
 */
export function vertraue(url: string): string {
  const zulaessig = new Set([...ERLAUBT].map(aufgeloest));
  if (!zulaessig.has(aufgeloest(url))) {
    throw new Error(`Nicht freigegebene Skript-Adresse: ${url}`);
  }

  const fabrik = (globalThis as { trustedTypes?: TrustedTypesFabrik }).trustedTypes;
  if (fabrik === undefined) return url;

  // createPolicy wirft beim zweiten Aufruf mit demselben Namen.
  politik ??= fabrik.createPolicy(POLICY_NAME, {
    createScriptURL: (eingabe) => {
      const zulaessigJetzt = new Set([...ERLAUBT].map(aufgeloest));
      if (!zulaessigJetzt.has(aufgeloest(eingabe))) {
        throw new Error('Nicht freigegebene Skript-Adresse.');
      }
      return eingabe;
    },
  });
  return politik.createScriptURL(url);
}
