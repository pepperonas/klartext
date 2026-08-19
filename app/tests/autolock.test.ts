import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoLock } from '../src/worker/autolock.ts';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('AutoLock', () => {
  it('sperrt nach der eingestellten Frist', () => {
    const gesperrt = vi.fn();
    const lock = new AutoLock(gesperrt);
    lock.konfiguriere(15);
    lock.beruehre();

    vi.advanceTimersByTime(14 * 60_000);
    expect(gesperrt).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_001);
    expect(gesperrt).toHaveBeenCalledOnce();
  });

  it('jede Beruehrung setzt die Frist zurueck', () => {
    const gesperrt = vi.fn();
    const lock = new AutoLock(gesperrt);
    lock.konfiguriere(1);
    lock.beruehre();

    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(50_000);
      lock.beruehre();
    }
    expect(gesperrt).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_001);
    expect(gesperrt).toHaveBeenCalledOnce();
  });

  it('0 Minuten heisst: nie sperren', () => {
    const gesperrt = vi.fn();
    const lock = new AutoLock(gesperrt);
    lock.konfiguriere(0);
    lock.beruehre();
    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(gesperrt).not.toHaveBeenCalled();
    expect(lock.lockAt).toBeNull();
  });

  it('eine Umstellung waehrend des Laufs wirkt sofort', () => {
    const gesperrt = vi.fn();
    const lock = new AutoLock(gesperrt);
    lock.konfiguriere(15);
    lock.beruehre();
    lock.konfiguriere(1);
    vi.advanceTimersByTime(60_001);
    expect(gesperrt).toHaveBeenCalledOnce();
  });

  it('stoppe() verhindert die Sperre und raeumt lockAt ab', () => {
    const gesperrt = vi.fn();
    const lock = new AutoLock(gesperrt);
    lock.konfiguriere(1);
    lock.beruehre();
    expect(lock.lockAt).not.toBeNull();
    lock.stoppe();
    vi.advanceTimersByTime(10 * 60_000);
    expect(gesperrt).not.toHaveBeenCalled();
    expect(lock.lockAt).toBeNull();
  });

  it('feuert genau einmal, nicht wiederholt', () => {
    const gesperrt = vi.fn();
    const lock = new AutoLock(gesperrt);
    lock.konfiguriere(1);
    lock.beruehre();
    vi.advanceTimersByTime(10 * 60_000);
    expect(gesperrt).toHaveBeenCalledOnce();
  });
});
