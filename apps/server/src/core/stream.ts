import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import pg from 'pg';
import { z } from 'zod';
import { CORE_EVENTS, type User } from '@derp/shared';
import { visibleProjectIds } from './access.ts';
import type { Db } from './db.ts';
import { eventBySeq, eventsAfter, lastEventSeq, type SequencedEvent } from './events.ts';

export const EVENTS_CHANNEL = 'derp_events';
/** A Cloudflare kb. 100 s tétlenség után bontaná a kapcsolatot. */
export const PING_MS = 25_000;
/** Ennél több kimaradt esemény helyett `reset` megy: a kliens mindent újratölt. */
export const BACKLOG_LIMIT = 500;
const RECONNECT_MS = 2_000;

export interface StreamSubscriber {
  /** A kapcsolat felhasználója (szerepkör-változáskor a kapcsolatai lezárulnak). */
  userId: string;
  event(e: SequencedEvent): void;
  /** Események maradhattak ki (pl. a LISTEN-kapcsolat újraépült): a kliens töltse újra az adatait. */
  reset(): void;
  close(): void;
}

/**
 * Folyamatonként egy LISTEN-kapcsolat a `derp_events` csatornára; az új eseményeket visszaolvassa és minden
 * SSE-kapcsolatnak továbbadja. Több szerverfolyamat esetén mindegyik a saját LISTEN-jén át kapja meg ugyanazt.
 */
export class EventHub {
  private client: pg.Client | null = null;
  private readonly subscribers = new Set<StreamSubscriber>();
  private stopped = false;
  private retry: NodeJS.Timeout | null = null;
  // A NOTIFY-ok commit-sorrendben jönnek; a visszaolvasást sorba fűzzük, hogy a sorrend megmaradjon.
  private chain: Promise<void> = Promise.resolve();

  private readonly db: Db;
  private readonly connectionString: string;
  private readonly log: FastifyBaseLogger;

  constructor(db: Db, connectionString: string, log: FastifyBaseLogger) {
    this.db = db;
    this.connectionString = connectionString;
    this.log = log;
  }

  async start(): Promise<void> {
    await this.connect(false);
  }

  private async connect(isReconnect: boolean): Promise<void> {
    const client = new pg.Client({ connectionString: this.connectionString });
    client.on('notification', (msg) => {
      const seq = Number(msg.payload);
      if (Number.isSafeInteger(seq)) this.chain = this.chain.then(() => this.dispatch(seq));
    });
    client.on('error', (err) => {
      this.log.error({ err }, 'eseményfolyam: a LISTEN-kapcsolat hibára futott');
      this.scheduleReconnect(client);
    });
    client.on('end', () => this.scheduleReconnect(client));
    try {
      await client.connect();
      await client.query(`LISTEN ${EVENTS_CHANNEL}`);
    } catch (err) {
      this.log.error({ err }, 'eseményfolyam: a LISTEN nem sikerült, újrapróbálom');
      this.scheduleReconnect(client);
      return;
    }
    if (this.stopped) {
      await client.end().catch(() => {});
      return;
    }
    this.client = client;
    if (isReconnect) for (const s of this.subscribers) s.reset();
  }

  private scheduleReconnect(failed: pg.Client): void {
    if (this.stopped || this.retry || (this.client && this.client !== failed)) return;
    this.client = null;
    failed.removeAllListeners('end');
    void failed.end().catch(() => {});
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect(true);
    }, RECONNECT_MS);
  }

  private async dispatch(seq: number): Promise<void> {
    if (this.subscribers.size === 0) return;
    try {
      const e = await eventBySeq(this.db, seq);
      if (e) for (const s of this.subscribers) s.event(e);
    } catch (err) {
      this.log.error({ err, seq }, 'eseményfolyam: az esemény visszaolvasása nem sikerült');
      for (const s of this.subscribers) s.reset();
    }
  }

  subscribe(s: StreamSubscriber): () => void {
    this.subscribers.add(s);
    return () => this.subscribers.delete(s);
  }

  /** Lezárja a nyitott SSE-kapcsolatokat (leálláskor, hogy a szerver bezárhasson). */
  closeStreams(): void {
    for (const s of this.subscribers) s.close();
  }

  /**
   * Egy felhasználó kapcsolatainak lezárása (pl. megváltozott a szerepköre vagy kikapcsolták): a kliens újracsatlakozik,
   * és az új kapcsolat már a friss jogosultsággal szűr. Csak ebben a folyamatban nyitott kapcsolatokra hat.
   */
  closeUserStreams(userId: string): void {
    for (const s of this.subscribers) if (s.userId === userId) s.close();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners('end');
      await client.end().catch(() => {});
    }
  }
}

/**
 * Egy kapcsolat láthatósági szűrője. Az admin és az iroda minden eseményt lát; a terepes csak a hozzá rendelt
 * projektekéit (projekt nélküli eseményt nem). A hozzárendelés-események (`core.member_added` / `_removed`, a
 * `data.userId`-val) sorrendben frissítik a hozzárendelt projektek halmazát, így a kapcsolat élete alatti változás is
 * érvényesül: a hozzárendelés eseményét már megkapja, a levételét még igen, az utána jövőket már nem.
 */
export class StreamVisibility {
  private readonly user: User;
  private readonly memberOf: Set<string> | null;

  constructor(user: User, projectIds: string[] | null) {
    this.user = user;
    this.memberOf = projectIds ? new Set(projectIds) : null;
  }

  /** Eseményenként egyszer, sorrendben hívandó. */
  accept({ event: e }: SequencedEvent): boolean {
    if (!this.memberOf) return true;
    if (!e.projectId) return false;
    const self = e.data.userId === this.user.id;
    if (self && e.type === CORE_EVENTS.memberAdded) this.memberOf.add(e.projectId);
    const visible = this.memberOf.has(e.projectId);
    if (self && e.type === CORE_EVENTS.memberRemoved) this.memberOf.delete(e.projectId);
    return visible;
  }
}

const StreamQuery = z.object({ lastEventId: z.string().regex(/^\d+$/).optional() });

/**
 * `GET /api/stream`: Server-Sent Events a közös eseménynaplóból. Üzenetek:
 * - `event: event`, `id: <seq>`, `data: TimelineEvent` — új esemény;
 * - `event: ready`, `id: <seq>` — a folyam él, eddig a sorszámig mindent megkapott a kliens;
 * - `event: reset` — események maradhattak ki, a kliens töltse újra az adatait;
 * - `: ping` komment `PING_MS`-enként.
 * Újracsatlakozáskor a `Last-Event-ID` fejléc (vagy a `lastEventId` paraméter) utáni események jönnek először.
 */
export async function streamRoutes(app: FastifyInstance, opts: { db: Db; hub: EventHub; pingMs: number }): Promise<void> {
  const { db, hub, pingMs } = opts;
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/api/stream', { schema: { querystring: StreamQuery } }, async (req, reply) => {
    const header = req.headers['last-event-id'];
    const rawLast = (Array.isArray(header) ? header[0] : header) ?? req.query.lastEventId;
    const lastSeq = rawLast && /^\d+$/.test(rawLast) ? Number(rawLast) : null;
    const user = req.user!;

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const write = (chunk: string) => {
      if (!res.writableEnded && !res.destroyed) res.write(chunk);
    };
    const sendEvent = (e: SequencedEvent) => write(`id: ${e.seq}\nevent: event\ndata: ${JSON.stringify(e.event)}\n\n`);
    write('retry: 3000\n\n');

    // A feliratkozás a láthatóság betöltése és a visszamenőleges lekérdezés előtt történik; ami közben jön, sorba áll.
    // Minden esemény egyszer megy át a szűrőn: a felépítés közben (visszamenőleges és sorba állt) feldolgozottakat a
    // `seen` tartja nyilván, az élő NOTIFY ezeket már nem küldi újra.
    let queue: SequencedEvent[] | null = [];
    const seen = new Set<number>();
    let visibility: StreamVisibility | null = null;
    let ping: NodeJS.Timeout | null = null;
    const deliver = (e: SequencedEvent, track: boolean) => {
      if (seen.has(e.seq)) return;
      if (track) seen.add(e.seq);
      if (visibility!.accept(e)) sendEvent(e);
    };
    const subscriber: StreamSubscriber = {
      userId: user.id,
      event: (e) => {
        if (queue) queue.push(e);
        else deliver(e, false);
      },
      reset: () => write('event: reset\ndata: {}\n\n'),
      close: () => res.end(),
    };
    const unsubscribe = hub.subscribe(subscriber);
    res.on('close', () => {
      unsubscribe();
      if (ping) clearInterval(ping);
    });

    try {
      visibility = new StreamVisibility(user, await visibleProjectIds(db, user));
      let readySeq: number;
      if (lastSeq === null) {
        readySeq = await lastEventSeq(db);
      } else {
        const backlog = await eventsAfter(db, lastSeq, BACKLOG_LIMIT + 1);
        if (backlog.length > BACKLOG_LIMIT) {
          readySeq = await lastEventSeq(db);
          subscriber.reset();
        } else {
          for (const e of backlog) deliver(e, true);
          readySeq = backlog.at(-1)?.seq ?? lastSeq;
        }
      }
      write(`id: ${readySeq}\nevent: ready\ndata: {}\n\n`);
      const pending = queue;
      queue = null;
      for (const e of pending) deliver(e, true);
      // Ha a kliens közben bontott, a `close` már lefutott; ilyenkor nincs mit pingelni.
      if (!res.destroyed && !res.writableEnded) ping = setInterval(() => write(': ping\n\n'), pingMs);
    } catch (err) {
      req.log.error({ err }, 'eseményfolyam: a kapcsolat felépítése nem sikerült');
      res.end();
    }
  });
}
