import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Role, User } from '@derp/shared';
import type { Db } from './db.ts';
import { forbidden, unauthorized } from './errors.ts';
import { projectMembers, projects } from './schema.ts';

// Szerepkörök (spec, Döntések): `admin` minden + beállítások, `iroda` minden projekt, `terepes` csak a hozzá rendelt
// projektek (és azok ügyfeleinek elérhetősége).

/** preHandler: csak a megadott szerepkörök mehetnek tovább (különben 403). */
export const requireRole =
  (...roles: Role[]): preHandlerAsyncHookHandler =>
  async (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
  };

/** Az irodai szerepkörök (admin, iroda) minden projektet látnak és kezelnek. */
export const OFFICE_ROLES: Role[] = ['admin', 'iroda'];

export const seesAllProjects = (user: User): boolean => user.role !== 'terepes';

/** Feltétel a `projects` táblára: a felhasználó által látható projektek (`undefined` = mind). */
export function visibleProjectsWhere(user: User): SQL | undefined {
  if (seesAllProjects(user)) return undefined;
  return sql`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.userId} = ${user.id})`;
}

export async function isProjectMember(db: Db, projectId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return !!row;
}

/** A felhasználó által látható projektek azonosítói; `null`, ha mindet látja. */
export async function visibleProjectIds(db: Db, user: User): Promise<string[] | null> {
  if (seesAllProjects(user)) return null;
  const rows = await db
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, user.id));
  return rows.map((r) => r.id);
}
