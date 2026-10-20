// Offline kimenő sor (terepi mód, 8. munkacsomag). A fotó, a jegyzet, a felmérés és a chat-üzenet előbb ide kerül
// (IndexedDB, így a lap bezárása és a telefon újraindítása után is megmarad), és innen megy fel, sorban, a modulok
// meglévő, idempotens végpontjain (a kliens oldali azonosítók miatt az újraküldés nem duplikál).
//
// - Küldéskor (`submit`) azonnal megpróbálja; ha nincs hálózat vagy a szerver nem érhető el, az elem a sorban marad
//   („feltöltésre vár”), és a felület ezt mutatja.
// - Lejátszás: az `online` eseménynél, app-megnyitáskor és amikor a lap újra látható (iOS-en nincs Background Sync),
//   valamint hiba után növekvő várakozással újra.
// - 401 (lejárt munkamenet) vagy a Cloudflare Access átirányítása: a sor megmarad, a felület belépést kér.
// - A háttérben küldött elem végleges hibánál (pl. 400, 403, 409) „sikertelen” lesz (újrapróbálható vagy elvethető),
//   szerverhibánál (5xx) később újra próbálkozik. Ha a felhasználó épp most küldte, és a szerver hibával válaszolt, a
//   hiba az űrlapon jelenik meg, az elem kikerül a sorból (az űrlap ugyanazzal az előkészített elemmel újraküldheti).
import Dexie, { type EntityTable } from 'dexie';
import { useEffect, useSyncExternalStore } from 'react';
import { ApiError } from './api.ts';

/** Egy elemfajta küldője (a modul `web/index.ts`-ének `outbox` mezőjéből). Újrajátszva sem duplikálhat. */
export interface OutboxHandler {
  send(payload: never, opts: { onProgress?: (progress: unknown) => void }): Promise<unknown>;
}

/** `new`: épp most került be, az első küldés folyik; `waiting`: feltöltésre vár; `failed`: végleges hiba. */
export type OutboxState = 'new' | 'waiting' | 'failed';

export interface OutboxItem {
  seq?: number;
  /** Az elem kliens oldali azonosítója (pl. az üzeneté). */
  id: string;
  /** `<modul>.<fajta>`, pl. `chat.message`. */
  kind: string;
  /** Akinek a nevében készült; más felhasználó belépésekor nem megy fel. */
  userId: string;
  projectId: string | null;
  /** Emberi olvasásra, pl. „Felmérés: Gépház”. */
  label: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
  state: OutboxState;
  error: string | null;
}

/** Miért kell belépni: lejárt munkamenet (401) vagy a Cloudflare Access átirányít. */
export type AuthRequired = 'session' | 'access' | null;

export type SubmitOutcome = { status: 'sent'; result: unknown } | { status: 'queued' };

/** A sor tárolója (böngészőben IndexedDB; ahol nincs, pl. a jsdom-tesztekben, memória). */
export interface OutboxStore {
  add(item: OutboxItem): Promise<number>;
  /** A felhasználó legrégebbi, még nem sikertelen eleme. */
  next(userId: string): Promise<OutboxItem | undefined>;
  update(seq: number, patch: Partial<OutboxItem>): Promise<void>;
  /** A felhasználó minden `new` elemét `waiting`-re állítja. */
  markWaiting(userId: string): Promise<void>;
  remove(seq: number): Promise<void>;
  all(): Promise<OutboxItem[]>;
  /** Változáskor (más lapról is) hívja. */
  watch(listener: () => void): () => void;
}

class DexieStore implements OutboxStore {
  private readonly db: Dexie & { items: EntityTable<OutboxItem, 'seq'> };

  constructor() {
    this.db = new Dexie('derp-outbox') as Dexie & { items: EntityTable<OutboxItem, 'seq'> };
    this.db.version(1).stores({ items: '++seq, userId' });
  }

  add(item: OutboxItem) {
    return this.db.items.add(item) as Promise<number>;
  }
  // Az index szerinti lekérdezés a felhasználón belül az elsődleges kulcs (a sorszám) szerint rendez.
  next(userId: string) {
    return this.db.items.where('userId').equals(userId).filter((i) => i.state !== 'failed').first();
  }
  async update(seq: number, patch: Partial<OutboxItem>) {
    await this.db.items.update(seq, patch);
  }
  async markWaiting(userId: string) {
    await this.db.items.where('userId').equals(userId).filter((i) => i.state === 'new').modify({ state: 'waiting' });
  }
  remove(seq: number) {
    return this.db.items.delete(seq);
  }
  all() {
    return this.db.items.orderBy('seq').toArray();
  }
  watch(listener: () => void) {
    // A Dexie élő lekérdezése minden írásnál újrafut, más lapról jövőnél is (BroadcastChannel).
    const sub = Dexie.liveQuery(() => this.db.items.toArray()).subscribe({ next: () => listener(), error: () => listener() });
    return () => sub.unsubscribe();
  }
}

export class MemoryStore implements OutboxStore {
  private items: OutboxItem[] = [];
  private nextSeq = 1;
  private readonly listeners = new Set<() => void>();

  private changed() {
    for (const l of this.listeners) l();
  }
  async add(item: OutboxItem) {
    const seq = this.nextSeq++;
    this.items.push({ ...item, seq });
    this.changed();
    return seq;
  }
  async next(userId: string) {
    return this.items.find((i) => i.userId === userId && i.state !== 'failed');
  }
  async update(seq: number, patch: Partial<OutboxItem>) {
    this.items = this.items.map((i) => (i.seq === seq ? { ...i, ...patch } : i));
    this.changed();
  }
  async markWaiting(userId: string) {
    this.items = this.items.map((i) => (i.userId === userId && i.state === 'new' ? { ...i, state: 'waiting' } : i));
    this.changed();
  }
  async remove(seq: number) {
    this.items = this.items.filter((i) => i.seq !== seq);
    this.changed();
  }
  async all() {
    return [...this.items];
  }
  watch(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}

/** Hiba után ennyi idő múlva próbálja újra (a sorszám a sikertelen próbálkozások száma). */
export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
/** Akadozó hálózatnál ennyi idő után a felület „feltöltésre vár”-t mutat (a küldés a háttérben folytatódik). */
export const FOREGROUND_TIMEOUT_MS = 15_000;

type Failure = 'auth' | 'permanent' | 'transient';

/** 401: belépés kell; a többi 4xx (kivéve 408, 429) végleges; a hálózati hiba és az 5xx átmeneti. */
export function classifyError(err: unknown): Failure {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'auth';
    if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) return 'permanent';
    return 'transient';
  }
  // A `fetch` hálózati hibája (offline, megszakadt kapcsolat, CORS-ba futó átirányítás) `TypeError`.
  if (err instanceof TypeError) return 'transient';
  return 'permanent';
}

export interface OutboxSnapshot {
  items: OutboxItem[];
  authRequired: AuthRequired;
  syncing: boolean;
}

interface Waiter {
  resolve: (o: SubmitOutcome) => void;
  reject: (err: unknown) => void;
  onProgress?: (progress: unknown) => void;
}

export interface OutboxEnv {
  isOnline(): boolean;
  /** Ha a hálózati hiba mögött a Cloudflare Access átirányítása áll (lejárt Access-munkamenet), `true`. */
  accessRedirect(): Promise<boolean>;
  /** Kölcsönös kizárás a lapok között (Web Locks), hogy két lap ne küldje egyszerre ugyanazt. */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const browserEnv: OutboxEnv = {
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  accessRedirect: async () => {
    try {
      const res = await fetch('/api/health', { redirect: 'manual', cache: 'no-store', credentials: 'same-origin' });
      return res.type === 'opaqueredirect';
    } catch {
      return false;
    }
  },
  withLock: (fn) => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks ? (locks.request('derp-outbox', fn) as Promise<Awaited<ReturnType<typeof fn>>>) : fn();
  },
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class Outbox {
  private readonly handlers = new Map<string, OutboxHandler>();
  private readonly waiters = new Map<number, Waiter>();
  private readonly listeners = new Set<() => void>();
  private snapshot: OutboxSnapshot = { items: [], authRequired: null, syncing: false };
  private userId: string | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private retryTimer: unknown = null;
  private unwatch: (() => void) | null = null;
  /** 401 vagy Access-átirányítás esetén (pl. a munkamenet újraellenőrzésére). */
  onAuthRequired: (reason: Exclude<AuthRequired, null>) => void = () => {};

  private readonly store: OutboxStore;
  private readonly env: OutboxEnv;

  constructor(store: OutboxStore, env: OutboxEnv = browserEnv) {
    this.store = store;
    this.env = env;
  }

  register(kind: string, handler: OutboxHandler): void {
    this.handlers.set(kind, handler);
  }

  /** A bejelentkezett felhasználó (a `Layout` állítja); belépés (újbóli belépés) után a sor azonnal indul. */
  setUser(userId: string | null): void {
    this.userId = userId;
    this.setSnapshot({ authRequired: null });
    if (userId) void this.run();
  }

  getSnapshot = (): OutboxSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (!this.unwatch) {
      this.unwatch = this.store.watch(() => void this.reload());
      void this.reload();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.unwatch?.();
        this.unwatch = null;
      }
    };
  };

  private setSnapshot(patch: Partial<OutboxSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  async reload(): Promise<void> {
    this.setSnapshot({ items: await this.store.all() });
  }

  /**
   * Az elem a sorba kerül és azonnal megpróbál felmenni. `sent`: a szerveren van (`result` a küldő eredménye);
   * `queued`: a sorban vár (nincs hálózat, belépés kell, vagy lassú a kapcsolat). Ha a szerver hibával válaszol (a
   * 401 kivételével), a hibát dobja, és az elem kikerül a sorból.
   */
  async submit(
    kind: string,
    payload: unknown,
    meta: { id: string; projectId: string | null; label: string },
    opts: { onProgress?: (progress: unknown) => void } = {},
  ): Promise<SubmitOutcome> {
    const handler = this.handlers.get(kind);
    if (!handler) throw new Error(`Ismeretlen elemfajta az offline sorban: ${kind}`);
    if (!this.userId) throw new ApiError(401, 'unauthorized', 'Be kell jelentkezni');
    const item: OutboxItem = {
      ...meta,
      kind,
      userId: this.userId,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
      state: 'new',
      error: null,
    };
    let seq: number;
    try {
      seq = await this.store.add(item);
    } catch {
      // Nincs használható IndexedDB (pl. korlátozott privát mód): küldés sor nélkül.
      return { status: 'sent', result: await handler.send(payload as never, opts) };
    }
    const outcome = new Promise<SubmitOutcome>((resolve, reject) => this.waiters.set(seq, { resolve, reject, onProgress: opts.onProgress }));
    const timer = this.env.setTimeout(() => {
      if (!this.waiters.has(seq)) return;
      this.settle(seq, { status: 'queued' });
      void this.store.update(seq, { state: 'waiting' });
    }, FOREGROUND_TIMEOUT_MS);
    void this.run();
    try {
      return await outcome;
    } finally {
      this.env.clearTimeout(timer);
    }
  }

  /** Lejátssza a sort (ha már fut, a végén még egyszer). */
  run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.env.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.env.withLock(() => this.drain());
        } while (this.again);
      } finally {
        this.running = null;
        this.setSnapshot({ syncing: false });
      }
    })();
    return this.running;
  }

  /** Egy sikertelen elem újra a sorba (a sorrendben a helyén marad). */
  async retry(seq: number): Promise<void> {
    await this.store.update(seq, { state: 'waiting', error: null });
    void this.run();
  }

  /** Egy elem elvetése (a felhasználó döntése; nem megy fel). */
  async discard(seq: number): Promise<void> {
    await this.store.remove(seq);
  }

  private settle(seq: number, outcome: SubmitOutcome) {
    this.waiters.get(seq)?.resolve(outcome);
    this.waiters.delete(seq);
  }

  private settleAll(outcome: SubmitOutcome) {
    for (const seq of [...this.waiters.keys()]) this.settle(seq, outcome);
  }

  private async drain(): Promise<void> {
    for (;;) {
      const userId = this.userId;
      if (!userId) return this.settleAll({ status: 'queued' });
      const item = await this.store.next(userId);
      if (!item) return;
      const seq = item.seq!;
      if (!this.env.isOnline()) {
        await this.store.markWaiting(userId);
        return this.settleAll({ status: 'queued' });
      }
      const handler = this.handlers.get(item.kind);
      if (!handler) {
        await this.store.update(seq, { state: 'failed', error: `Ismeretlen elemfajta: ${item.kind}` });
        continue;
      }
      this.setSnapshot({ syncing: true });
      try {
        const result = await handler.send(item.payload as never, { onProgress: this.waiters.get(seq)?.onProgress });
        await this.store.remove(seq);
        if (this.snapshot.authRequired) this.setSnapshot({ authRequired: null });
        this.settle(seq, { status: 'sent', result });
      } catch (err) {
        let failure = classifyError(err);
        // A hálózati hiba mögött lehet a Cloudflare Access átirányítása is (a `fetch` ezt nem különbözteti meg).
        if (err instanceof TypeError && this.env.isOnline() && (await this.env.accessRedirect())) failure = 'auth';
        const error = err instanceof Error ? err.message : String(err);
        // Ha a felhasználó épp most küldte, és a szerver hibával válaszolt (nem 401), a hiba az űrlapon jelenik meg
        // (ugyanúgy, mint sor nélkül), és az elem kikerül a sorból; az űrlap ugyanazzal az elemmel küldheti újra.
        const waiter = this.waiters.get(seq);
        if (waiter && failure !== 'auth' && err instanceof ApiError) {
          await this.store.remove(seq);
          this.waiters.delete(seq);
          waiter.reject(err);
          continue;
        }
        if (failure === 'permanent') {
          await this.store.update(seq, { state: 'failed', attempts: item.attempts + 1, error });
          continue;
        }
        await this.store.update(seq, { state: 'waiting', attempts: item.attempts + 1, error });
        await this.store.markWaiting(userId);
        this.settleAll({ status: 'queued' });
        if (failure === 'auth') {
          const reason = err instanceof ApiError && err.status === 401 ? 'session' : 'access';
          this.setSnapshot({ authRequired: reason });
          this.onAuthRequired(reason);
        } else {
          this.scheduleRetry(item.attempts + 1);
        }
        return;
      }
    }
  }

  private scheduleRetry(attempts: number) {
    const delay = RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length) - 1]!;
    this.env.clearTimeout(this.retryTimer);
    this.retryTimer = this.env.setTimeout(() => void this.run(), delay);
  }
}

const hasIndexedDb = typeof indexedDB !== 'undefined';

/** Az alkalmazás sora. */
export const outbox = new Outbox(hasIndexedDb ? new DexieStore() : new MemoryStore());

/**
 * A bejelentkezett felhasználó sora: belépéskor és app-megnyitáskor, az `online` eseménynél és amikor a lap újra
 * láthatóvá válik, lejátszik (iOS-en nincs Background Sync, ezért ezek az alkalmak).
 */
export function useOutboxSync(userId: string): void {
  useEffect(() => {
    outbox.setUser(userId);
    const kick = () => void outbox.run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick();
    };
    window.addEventListener('online', kick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', kick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId]);
}

/** A sor állapota (élőben frissül, más lapról is). */
export function useOutbox(): OutboxSnapshot {
  return useSyncExternalStore(outbox.subscribe, outbox.getSnapshot);
}

/**
 * A feltöltésre váró (és a sikertelen) elemek egy fajtából és projektből, pl. a chatben a várakozó üzenetek. Az épp
 * most küldött (első próbálkozás alatti) elem nincs benne: azt a küldő felület maga mutatja.
 */
export function usePendingItems(kind: string, projectId: string): OutboxItem[] {
  return useOutbox().items.filter((i) => i.kind === kind && i.projectId === projectId && i.state !== 'new');
}

/** Küldés a soron át; ld. `Outbox.submit`. */
export function submit(
  kind: string,
  payload: unknown,
  meta: { id: string; projectId: string | null; label: string },
  opts?: { onProgress?: (progress: unknown) => void },
): Promise<SubmitOutcome> {
  return outbox.submit(kind, payload, meta, opts);
}
