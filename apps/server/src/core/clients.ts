import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  Client,
  ClientCreate,
  ClientDetail,
  ClientList,
  ClientUpdate,
  Contact,
  ContactCreate,
  ContactUpdate,
  type User,
} from '@derp/shared';
import { OFFICE_ROLES, requireRole, seesAllProjects } from './access.ts';
import { recordView, writeAudit } from './audit.ts';
import type { Db } from './db.ts';
import { conflict, forbidden, notFound } from './errors.ts';
import { clientContacts, clients, projectMembers, projects } from './schema.ts';

type ClientRow = typeof clients.$inferSelect;
type ContactRow = typeof clientContacts.$inferSelect;

const toClientDto = (c: ClientRow): Client => ({
  id: c.id,
  name: c.name,
  address: c.address,
  note: c.note,
  version: c.version,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

const toContactDto = (c: ContactRow): Contact => ({
  id: c.id,
  clientId: c.clientId,
  name: c.name,
  position: c.position,
  phone: c.phone,
  email: c.email,
  note: c.note,
  version: c.version,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

const IdParams = z.object({ id: z.uuid() });
const activeClient = (id: string) => and(eq(clients.id, id), isNull(clients.deletedAt));
const activeContact = (id: string) => and(eq(clientContacts.id, id), isNull(clientContacts.deletedAt));

/** A módosított mezők régi és új értéke (az auditnaplóba). */
function diff<T extends Record<string, unknown>>(current: T, fields: Partial<T>): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(fields)) {
    if (to !== undefined && to !== current[key]) changes[key] = { from: current[key], to };
  }
  return changes;
}

/**
 * A terepes felhasználó egy ügyfelet (és kapcsolattartóit) csak akkor lát, ha egy hozzá rendelt, nem törölt projekt
 * ügyfele. Feltétel a `clients` táblára (`undefined` = mind).
 */
function visibleClientsWhere(user: User) {
  if (seesAllProjects(user)) return undefined;
  return sql`exists (
    select 1 from ${projects} join ${projectMembers} on ${projectMembers.projectId} = ${projects.id}
    where ${projects.clientId} = ${clients.id} and ${projects.deletedAt} is null and ${projectMembers.userId} = ${user.id})`;
}

export async function clientRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;
  const r = app.withTypeProvider<ZodTypeProvider>();
  const office = requireRole(...OFFICE_ROLES);

  r.get('/api/clients', { schema: { response: { 200: ClientList } } }, async (req) => {
    const rows = await db
      .select()
      .from(clients)
      .where(and(isNull(clients.deletedAt), visibleClientsWhere(req.user!)))
      .orderBy(asc(sql`lower(${clients.name})`));
    return { items: rows.map(toClientDto) };
  });

  r.post('/api/clients', { preHandler: office, schema: { body: ClientCreate, response: { 201: Client } } }, async (req, reply) => {
    const row = await db.transaction(async (tx) => {
      const [c] = await tx.insert(clients).values(req.body).returning();
      await writeAudit(tx, { userId: req.user!.id, action: 'create', entityType: 'client', entityId: c!.id, label: c!.name });
      return c!;
    });
    return reply.code(201).send(toClientDto(row));
  });

  r.get('/api/clients/:id', { schema: { params: IdParams, response: { 200: ClientDetail } } }, async (req) => {
    const [row] = await db.select().from(clients).where(activeClient(req.params.id)).limit(1);
    if (!row) throw notFound('Az ügyfél nem található');
    const where = visibleClientsWhere(req.user!);
    if (where) {
      const [visible] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, row.id), where));
      if (!visible) throw forbidden('Nincs jogosultságod ehhez az ügyfélhez');
    }
    const contacts = await db
      .select()
      .from(clientContacts)
      .where(and(eq(clientContacts.clientId, row.id), isNull(clientContacts.deletedAt)))
      .orderBy(asc(clientContacts.createdAt));
    // A kapcsolattartók elérhetősége személyes adat: a megtekintés az auditnaplóba kerül.
    await recordView(db, { userId: req.user!.id, entityType: 'client', entityId: row.id, label: row.name });
    return { ...toClientDto(row), contacts: contacts.map(toContactDto) };
  });

  r.patch(
    '/api/clients/:id',
    { preHandler: office, schema: { params: IdParams, body: ClientUpdate, response: { 200: Client } } },
    async (req) => {
      const { version, ...fields } = req.body;
      return toClientDto(
        await db.transaction(async (tx) => {
          const [current] = await tx.select().from(clients).where(activeClient(req.params.id)).for('update');
          if (!current) throw notFound('Az ügyfél nem található');
          if (current.version !== version) throw conflict('Az ügyfelet közben más módosította; töltsd újra az oldalt');
          const changes = diff(current, fields);
          if (Object.keys(changes).length === 0) return current;
          const [row] = await tx
            .update(clients)
            .set({ ...fields, version: current.version + 1, updatedAt: new Date() })
            .where(eq(clients.id, current.id))
            .returning();
          await writeAudit(tx, {
            userId: req.user!.id,
            action: 'update',
            entityType: 'client',
            entityId: current.id,
            label: row!.name,
            data: { changes },
          });
          return row!;
        }),
      );
    },
  );

  // Törléskor az ügyfél rejtett lesz; a hozzá tartozó projektek az ügyfél nevét továbbra is mutatják.
  r.delete('/api/clients/:id', { preHandler: office, schema: { params: IdParams } }, async (req, reply) => {
    await db.transaction(async (tx) => {
      const [row] = await tx.update(clients).set({ deletedAt: new Date() }).where(activeClient(req.params.id)).returning();
      if (!row) throw notFound('Az ügyfél nem található');
      await writeAudit(tx, { userId: req.user!.id, action: 'delete', entityType: 'client', entityId: row.id, label: row.name });
    });
    return reply.code(204).send();
  });

  r.post(
    '/api/clients/:id/contacts',
    { preHandler: office, schema: { params: IdParams, body: ContactCreate, response: { 201: Contact } } },
    async (req, reply) => {
      const row = await db.transaction(async (tx) => {
        const [client] = await tx.select().from(clients).where(activeClient(req.params.id)).for('update');
        if (!client) throw notFound('Az ügyfél nem található');
        const [c] = await tx
          .insert(clientContacts)
          .values({ ...req.body, clientId: client.id })
          .returning();
        await writeAudit(tx, {
          userId: req.user!.id,
          action: 'create',
          entityType: 'contact',
          entityId: c!.id,
          label: `${c!.name} (${client.name})`,
        });
        return c!;
      });
      return reply.code(201).send(toContactDto(row));
    },
  );

  r.patch(
    '/api/contacts/:id',
    { preHandler: office, schema: { params: IdParams, body: ContactUpdate, response: { 200: Contact } } },
    async (req) => {
      const { version, ...fields } = req.body;
      return toContactDto(
        await db.transaction(async (tx) => {
          const [current] = await tx.select().from(clientContacts).where(activeContact(req.params.id)).for('update');
          if (!current) throw notFound('A kapcsolattartó nem található');
          if (current.version !== version) throw conflict('A kapcsolattartót közben más módosította; töltsd újra az oldalt');
          const changes = diff(current, fields);
          if (Object.keys(changes).length === 0) return current;
          const [row] = await tx
            .update(clientContacts)
            .set({ ...fields, version: current.version + 1, updatedAt: new Date() })
            .where(eq(clientContacts.id, current.id))
            .returning();
          await writeAudit(tx, {
            userId: req.user!.id,
            action: 'update',
            entityType: 'contact',
            entityId: current.id,
            label: row!.name,
            data: { changes },
          });
          return row!;
        }),
      );
    },
  );

  r.delete('/api/contacts/:id', { preHandler: office, schema: { params: IdParams } }, async (req, reply) => {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(clientContacts)
        .set({ deletedAt: new Date() })
        .where(activeContact(req.params.id))
        .returning();
      if (!row) throw notFound('A kapcsolattartó nem található');
      await writeAudit(tx, { userId: req.user!.id, action: 'delete', entityType: 'contact', entityId: row.id, label: row.name });
    });
    return reply.code(204).send();
  });
}
