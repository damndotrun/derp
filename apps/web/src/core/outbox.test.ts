import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api.ts';
import { classifyError, FOREGROUND_TIMEOUT_MS, MemoryStore, Outbox, RETRY_DELAYS_MS, type OutboxEnv } from './outbox.ts';

const USER = 'u1';
const meta = (id: string) => ({ id, projectId: 'p1', label: `Elem ${id}` });

/** Vezérelhető környezet: hálózat, Access-átirányítás, időzítők kézzel indítva. */
function setup(opts: { online?: boolean; access?: boolean } = {}) {
  const state = { online: opts.online ?? true, access: opts.access ?? false };
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const env: OutboxEnv = {
    isOnline: () => state.online,
    accessRedirect: async () => state.access,
    withLock: (fn) => fn(),
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (h) => {
      if (h) (h as { cleared: boolean }).cleared = true;
    },
  };
  const store = new MemoryStore();
  const box = new Outbox(store, env);
  // Egy idempotens „szerver”: az elemet azonosító szerint tárolja; a `fail` sor a következő válaszokat írja elő.
  const server = new Map<string, unknown>();
  const sent: string[] = [];
  const fail: unknown[] = [];
  box.register('t.item', {
    send: async (payload: { id: string }) => {
      sent.push(payload.id);
      const err = fail.shift();
      if (err) throw err;
      if (!server.has(payload.id)) server.set(payload.id, payload);
      return { saved: payload.id };
    },
  });
  box.setUser(USER);
  const pending = () => timers.filter((t) => !t.cleared);
  return { box, store, state, server, sent, fail, timers, pending };
}

describe('offline sor', () => {
  it('a hibák osztályozása: 401 belépés, a többi 4xx végleges, a hálózati hiba és az 5xx átmeneti', () => {
    expect(classifyError(new ApiError(401, 'unauthorized', ''))).toBe('auth');
    expect(classifyError(new ApiError(409, 'conflict', ''))).toBe('permanent');
    expect(classifyError(new ApiError(403, 'forbidden', ''))).toBe('permanent');
    expect(classifyError(new ApiError(429, 'too_many', ''))).toBe('transient');
    expect(classifyError(new ApiError(503, 'http', ''))).toBe('transient');
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('transient');
  });

  it('online: azonnal felmegy, a sor kiürül', async () => {
    const { box, store, server } = setup();
    await expect(box.submit('t.item', { id: 'a' }, meta('a'))).resolves.toEqual({ status: 'sent', result: { saved: 'a' } });
    expect([...server.keys()]).toEqual(['a']);
    expect(await store.all()).toEqual([]);
  });

  it('offline: a sorban vár; online-ra váltva a felvétel sorrendjében megy fel, és újra lejátszva sem küldi még egyszer', async () => {
    const { box, store, state, server, sent } = setup({ online: false });
    for (const id of ['a', 'b', 'c']) await expect(box.submit('t.item', { id }, meta(id))).resolves.toEqual({ status: 'queued' });
    expect((await store.all()).map((i) => [i.id, i.state])).toEqual([
      ['a', 'waiting'],
      ['b', 'waiting'],
      ['c', 'waiting'],
    ]);
    expect(sent).toEqual([]);

    state.online = true;
    await box.run();
    expect([...server.keys()]).toEqual(['a', 'b', 'c']);
    await box.run();
    expect(sent).toEqual(['a', 'b', 'c']);
    expect(await store.all()).toEqual([]);
  });

  it('hálózati hiba: a sor megmarad, és növekvő várakozással újrapróbálja', async () => {
    const { box, store, fail, pending, server } = setup();
    fail.push(new TypeError('Failed to fetch'));
    await expect(box.submit('t.item', { id: 'a' }, meta('a'))).resolves.toEqual({ status: 'queued' });
    expect((await store.all())[0]).toMatchObject({ state: 'waiting', attempts: 1, error: 'Failed to fetch' });
    expect(pending().map((t) => t.ms)).toContain(RETRY_DELAYS_MS[0]);

    fail.push(new TypeError('Failed to fetch'));
    pending().find((t) => t.ms === RETRY_DELAYS_MS[0])!.fn();
    await vi.waitFor(async () => expect((await store.all())[0]?.attempts).toBe(2));
    expect(pending().map((t) => t.ms)).toContain(RETRY_DELAYS_MS[1]);

    pending().find((t) => t.ms === RETRY_DELAYS_MS[1])!.fn();
    await vi.waitFor(async () => expect(await store.all()).toEqual([]));
    expect([...server.keys()]).toEqual(['a']);
  });

  it('401: a sor megmarad, belépést kér; újbóli belépés után felmegy', async () => {
    const { box, store, fail, server, sent } = setup();
    const onAuth = vi.fn();
    box.onAuthRequired = onAuth;
    // A munkamenet lejárt: amíg nincs újra belépés, minden próbálkozás 401 (az új elem a régebbi mögé áll be).
    fail.push(new ApiError(401, 'unauthorized', 'Be kell jelentkezni'), new ApiError(401, 'unauthorized', 'Be kell jelentkezni'));
    await expect(box.submit('t.item', { id: 'a' }, meta('a'))).resolves.toEqual({ status: 'queued' });
    await expect(box.submit('t.item', { id: 'b' }, meta('b'))).resolves.toEqual({ status: 'queued' });
    expect(sent).toEqual(['a', 'a']);
    expect(box.getSnapshot().authRequired).toBe('session');
    expect(onAuth).toHaveBeenCalledWith('session');
    expect((await store.all()).map((i) => i.id)).toEqual(['a', 'b']);
    expect(server.size).toBe(0);

    box.setUser(USER);
    expect(box.getSnapshot().authRequired).toBeNull();
    await box.run();
    expect([...server.keys()]).toEqual(['a', 'b']);
  });

  it('a Cloudflare Access átirányítása (hálózati hiba mögött) is belépést kér', async () => {
    const { box, fail } = setup({ access: true });
    fail.push(new TypeError('Failed to fetch'));
    await expect(box.submit('t.item', { id: 'a' }, meta('a'))).resolves.toEqual({ status: 'queued' });
    expect(box.getSnapshot().authRequired).toBe('access');
  });

  it('épp most küldött elemnél a szerver hibája az űrlapra megy, az elem kikerül a sorból', async () => {
    const { box, store, fail } = setup();
    fail.push(new ApiError(400, 'bad_request', 'Hiányzó mező'));
    await expect(box.submit('t.item', { id: 'a' }, meta('a'))).rejects.toThrow('Hiányzó mező');
    expect(await store.all()).toEqual([]);
  });

  it('a háttérben végleges hibát kapott elem „sikertelen”, a többi megy tovább; újra vagy elvethető', async () => {
    const { box, store, state, fail, server } = setup({ online: false });
    await box.submit('t.item', { id: 'a' }, meta('a'));
    await box.submit('t.item', { id: 'b' }, meta('b'));
    state.online = true;
    fail.push(new ApiError(403, 'forbidden', 'Nincs jogosultság'));
    await box.run();
    expect([...server.keys()]).toEqual(['b']);
    const [failed] = await store.all();
    expect(failed).toMatchObject({ id: 'a', state: 'failed', error: 'Nincs jogosultság' });

    await box.retry(failed!.seq!);
    await vi.waitFor(async () => expect(await store.all()).toEqual([]));
    expect([...server.keys()]).toEqual(['b', 'a']);

    state.online = false;
    await box.submit('t.item', { id: 'c' }, meta('c'));
    await box.discard((await store.all())[0]!.seq!);
    expect(await store.all()).toEqual([]);
  });

  it('más felhasználó elemét nem küldi el', async () => {
    const { box, store, state, server } = setup({ online: false });
    await box.submit('t.item', { id: 'a' }, meta('a'));
    box.setUser('u2');
    state.online = true;
    await box.run();
    expect(server.size).toBe(0);
    expect((await store.all()).map((i) => i.userId)).toEqual([USER]);
  });

  it('lassú kapcsolatnál a felület egy idő után „feltöltésre vár”-t kap, a küldés a háttérben befejeződik', async () => {
    const { box, store, timers } = setup();
    let release!: () => void;
    box.register('t.slow', { send: () => new Promise<void>((r) => (release = r)) });
    const outcome = box.submit('t.slow', { id: 's' }, meta('s'));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    timers.find((t) => t.ms === FOREGROUND_TIMEOUT_MS)!.fn();
    await expect(outcome).resolves.toEqual({ status: 'queued' });
    await vi.waitFor(async () => expect((await store.all())[0]?.state).toBe('waiting'));
    release();
    await vi.waitFor(async () => expect(await store.all()).toEqual([]));
  });

  it('ismeretlen elemfajtát nem fogad el; belépés nélkül nem küld', async () => {
    const { box } = setup();
    await expect(box.submit('t.nincs', {}, meta('x'))).rejects.toThrow(/Ismeretlen/);
    box.setUser(null);
    await expect(box.submit('t.item', { id: 'a' }, meta('a'))).rejects.toMatchObject({ status: 401 });
  });
});
