/**
 * Der Worker-Client — die Seite der Grenze, die im Main-Thread liegt.
 *
 * Geprüft werden die Dinge, die man ihm nicht ansieht: dass Antworten der
 * richtigen Anfrage zugeordnet werden, dass Fehler als Fehler ankommen, und
 * dass die Sperr-Auslöser wirklich sperren.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `client.ts` meldet beim Laden die Worker-Adresse an. Das braucht kein
// `location` mehr (siehe trusted.ts), aber der Vollständigkeit halber steht
// hier eine, damit ein späterer Aufruf von `vertraue` nicht stolpert.
vi.stubGlobal('location', { href: 'https://klartext.celox.io/' });

import { CryptoClient } from '../src/crypto/client.ts';
import { KlartextError } from '../src/crypto/errors.ts';
import type { AnyRequest, AnyResponse, VaultStatus } from '../src/crypto/protocol.ts';

const OFFEN: VaultStatus = { state: 'unlocked', keyCount: 1, lockAt: Date.now() + 60_000, lastLockReason: null };
const ZU: VaultStatus = { state: 'locked', keyCount: 1, lockAt: null, lastLockReason: 'manual' };

/** Worker-Attrappe, die jede Anfrage protokolliert und von Hand beantwortet. */
class WorkerStub {
  readonly gesendet: AnyRequest[] = [];
  #abnehmer: ((e: MessageEvent<AnyResponse>) => void) | null = null;

  addEventListener(_typ: string, fn: (e: MessageEvent<AnyResponse>) => void): void {
    this.#abnehmer = fn;
  }
  postMessage(nachricht: AnyRequest): void { this.gesendet.push(nachricht); }

  antworte(nachricht: AnyResponse): void {
    this.#abnehmer?.({ data: nachricht } as MessageEvent<AnyResponse>);
  }
  /** Beantwortet die n-te Anfrage erfolgreich. */
  erfolg(index: number, result: unknown): void {
    const id = this.gesendet[index]?.id ?? -1;
    this.antworte({ type: 'reply', id, ok: true, result });
  }
}

function aufbau(): { client: CryptoClient; worker: WorkerStub } {
  const worker = new WorkerStub();
  return { client: new CryptoClient(worker as unknown as Worker), worker };
}

describe('Zuordnung von Anfragen und Antworten', () => {
  it('ordnet auch bei vertauschter Reihenfolge richtig zu', async () => {
    // ⚠️ Der Worker arbeitet nebenläufig; eine spätere Anfrage kann zuerst
    //    fertig sein. Ohne saubere Zuordnung bekäme der Aufrufer ein fremdes
    //    Ergebnis — bei Schlüsseln eine üble Verwechslung.
    const { client, worker } = aufbau();
    const erste = client.ruf('vault.status', {});
    const zweite = client.ruf('keys.list', {});

    worker.erfolg(1, ['zweite']);
    worker.erfolg(0, OFFEN);

    await expect(zweite).resolves.toEqual(['zweite']);
    await expect(erste).resolves.toEqual(OFFEN);
  });

  it('vergibt aufsteigende, eindeutige Kennungen', () => {
    const { client, worker } = aufbau();
    void client.ruf('vault.status', {});
    void client.ruf('vault.status', {});
    void client.ruf('keys.list', {});
    const ids = worker.gesendet.map((n) => n.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('reicht den Operationsnamen und die Nutzlast durch', () => {
    const { client, worker } = aufbau();
    void client.ruf('vault.unlock', { passphrase: 'geheim' });
    expect(worker.gesendet[0]).toMatchObject({ op: 'vault.unlock', passphrase: 'geheim' });
  });

  it('macht aus einem Wire-Fehler wieder einen KlartextError', async () => {
    const { client, worker } = aufbau();
    const versprechen = client.ruf('vault.unlock', { passphrase: 'falsch' });
    const id = worker.gesendet[0]?.id ?? -1;
    worker.antworte({
      type: 'reply', id, ok: false,
      error: { code: 'WRONG_PASSPHRASE', message: 'Passphrase falsch.' },
    });
    await expect(versprechen).rejects.toBeInstanceOf(KlartextError);
    await expect(versprechen).rejects.toMatchObject({ code: 'WRONG_PASSPHRASE' });
  });

  it('ignoriert eine Antwort auf eine unbekannte Kennung, statt zu stürzen', () => {
    const { client, worker } = aufbau();
    void client.ruf('vault.status', {});
    expect(() => { worker.antworte({ type: 'reply', id: 9999, ok: true, result: null }); }).not.toThrow();
  });

  it('ignoriert die Bereitmeldung', () => {
    const { worker } = aufbau();
    expect(() => { worker.antworte({ type: 'ready' }); }).not.toThrow();
  });
});

describe('Zustandsbeobachtung', () => {
  it('meldet den aktuellen Stand sofort beim Anmelden', () => {
    const { client } = aufbau();
    const gesehen: VaultStatus[] = [];
    client.beobachte((s) => gesehen.push(s));
    expect(gesehen).toHaveLength(1);
    expect(gesehen[0]?.state).toBe('empty');
  });

  it('meldet jede Änderung an alle Beobachter', () => {
    const { client, worker } = aufbau();
    const a: VaultStatus[] = [];
    const b: VaultStatus[] = [];
    client.beobachte((s) => a.push(s));
    client.beobachte((s) => b.push(s));
    worker.antworte({ type: 'event', event: { kind: 'vault.changed', status: OFFEN } });
    expect(a.at(-1)?.state).toBe('unlocked');
    expect(b.at(-1)?.state).toBe('unlocked');
  });

  it('lässt sich abmelden', () => {
    const { client, worker } = aufbau();
    const gesehen: VaultStatus[] = [];
    const ab = client.beobachte((s) => gesehen.push(s));
    ab();
    worker.antworte({ type: 'event', event: { kind: 'vault.changed', status: OFFEN } });
    expect(gesehen).toHaveLength(1);
  });
});

describe('Sperr-Auslöser', () => {
  let ziel: {
    document: { visibilityState: string; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void };
    addEventListener: (t: string, f: () => void) => void;
    removeEventListener: (t: string, f: () => void) => void;
  };
  let abnehmer: Map<string, () => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    abnehmer = new Map();
    ziel = {
      document: {
        visibilityState: 'visible',
        addEventListener: (t, f) => { abnehmer.set(`doc:${t}`, f); },
        removeEventListener: (t) => { abnehmer.delete(`doc:${t}`); },
      },
      addEventListener: (t, f) => { abnehmer.set(t, f); },
      removeEventListener: (t) => { abnehmer.delete(t); },
    };
  });
  afterEach(() => { vi.useRealTimers(); });

  function verdrahte(): { client: CryptoClient; worker: WorkerStub; ab: () => void } {
    const { client, worker } = aufbau();
    worker.antworte({ type: 'event', event: { kind: 'vault.changed', status: OFFEN } });
    const ab = client.verdrahteSperrausloeser(ziel as unknown as Window);
    return { client, worker, ab };
  }

  it('sperrt beim Verlassen der Seite sofort', () => {
    const { worker } = verdrahte();
    abnehmer.get('pagehide')?.();
    expect(worker.gesendet.some((n) => n.op === 'vault.lock')).toBe(true);
  });

  it('sperrt nach Tab-Wechsel erst nach der Karenzzeit', () => {
    const { client, worker } = verdrahte();
    // Voreinstellung: 30 s. Der Kern-Ablauf ist verschlüsseln, Tab wechseln,
    // woanders einfügen — bei 0 s sperrte genau diese Handbewegung.
    expect(client.einstellungen.lockOnHiddenSeconds).toBe(30);
    ziel.document.visibilityState = 'hidden';
    abnehmer.get('doc:visibilitychange')?.();
    expect(worker.gesendet.some((n) => n.op === 'vault.lock')).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(worker.gesendet.some((n) => n.op === 'vault.lock')).toBe(true);
  });

  it('nimmt die Sperre zurück, wenn der Tab rechtzeitig wieder sichtbar wird', () => {
    const { worker } = verdrahte();
    ziel.document.visibilityState = 'hidden';
    abnehmer.get('doc:visibilitychange')?.();
    vi.advanceTimersByTime(10_000);
    ziel.document.visibilityState = 'visible';
    abnehmer.get('doc:visibilitychange')?.();
    vi.advanceTimersByTime(60_000);
    expect(worker.gesendet.some((n) => n.op === 'vault.lock')).toBe(false);
  });

  it('meldet Nutzeraktivität nur bei entsperrtem Bund', async () => {
    const { client, worker } = verdrahte();
    abnehmer.get('keydown')?.();
    await Promise.resolve();
    expect(worker.gesendet.some((n) => n.op === 'vault.touch')).toBe(true);

    worker.gesendet.length = 0;
    worker.antworte({ type: 'event', event: { kind: 'vault.changed', status: ZU } });
    abnehmer.get('keydown')?.();
    await Promise.resolve();
    expect(worker.gesendet.some((n) => n.op === 'vault.touch')).toBe(false);
    void client;
  });

  it('räumt alle Abnehmer wieder ab', () => {
    const { ab } = verdrahte();
    expect(abnehmer.size).toBeGreaterThan(0);
    ab();
    expect(abnehmer.size).toBe(0);
  });
});
