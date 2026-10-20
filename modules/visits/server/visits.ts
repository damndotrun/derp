import type pg from 'pg';
import type { Visit, VisitAssignee, VisitConflict, VisitStatus } from '../shared/schemas.ts';

// Olvasó lekérdezések a kiszállásokhoz. A mag tábláit (projects, clients, users, project_members) a modul nyers
// SQL-lel olvassa, mert a magból futásidőben nem importál.

type Queryable = Pick<pg.Pool, 'query'>;

/** Ki kérdez: a látható projektek (`null` = mind) és a felhasználó; a terepes csak a saját kiszállásait látja. */
export interface Viewer {
  userId: string;
  visibleProjectIds: string[] | null;
}

/** Szűrés a `visits_visit v` sorokra; a paraméterek `$n` sorszámát a `where` maga számolja. */
export interface VisitFilter {
  ids?: string[];
  /** A `[from, to)` időszakkal átfedők. */
  from?: Date;
  to?: Date;
  /** Csak ennek a kollégának a kiszállásai. */
  userId?: string;
  /** Csak ezek a kezdés utániak (ICS-feed). */
  startsAfter?: Date;
}

interface VisitRow {
  id: string;
  project_id: string;
  project_name: string;
  client_name: string | null;
  starts_at: Date;
  ends_at: Date;
  address: string;
  task: string;
  status: VisitStatus;
  version: number;
  assignees: VisitAssignee[];
}

function buildWhere(filter: VisitFilter, viewer: Viewer | null): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const conds = ['v.deleted_at IS NULL', 'p.deleted_at IS NULL'];
  if (filter.ids) conds.push(`v.id = ANY(${p(filter.ids)}::uuid[])`);
  if (filter.from) conds.push(`v.ends_at > ${p(filter.from)}`);
  if (filter.to) conds.push(`v.starts_at < ${p(filter.to)}`);
  if (filter.startsAfter) conds.push(`v.starts_at >= ${p(filter.startsAfter)}`);
  if (filter.userId) conds.push(`EXISTS (SELECT 1 FROM visits_assignee a WHERE a.visit_id = v.id AND a.user_id = ${p(filter.userId)})`);
  if (viewer && viewer.visibleProjectIds !== null) {
    conds.push(`v.project_id = ANY(${p(viewer.visibleProjectIds)}::uuid[])`);
    conds.push(`EXISTS (SELECT 1 FROM visits_assignee a WHERE a.visit_id = v.id AND a.user_id = ${p(viewer.userId)})`);
  }
  return { where: conds.join(' AND '), params };
}

/** A szűrésnek megfelelő kiszállások kezdés szerint, a kollégákkal és az ütközésekkel. `viewer` nélkül nincs szűrés. */
export async function listVisits(db: Queryable, filter: VisitFilter, viewer: Viewer | null): Promise<Visit[]> {
  const { where, params } = buildWhere(filter, viewer);
  const { rows } = await db.query<VisitRow>(
    `SELECT v.id, v.project_id, p.name AS project_name, c.name AS client_name, v.starts_at, v.ends_at, v.address, v.task,
            v.status, v.version,
            COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
                        FROM visits_assignee a JOIN users u ON u.id = a.user_id WHERE a.visit_id = v.id), '[]') AS assignees
       FROM visits_visit v
       JOIN projects p ON p.id = v.project_id
       LEFT JOIN clients c ON c.id = p.client_id
      WHERE ${where}
      ORDER BY v.starts_at, v.id`,
    params,
  );
  const conflicts = await findConflicts(
    db,
    rows.map((r) => r.id),
    viewer?.visibleProjectIds ?? null,
  );
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    clientName: r.client_name,
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
    address: r.address,
    task: r.task,
    status: r.status,
    version: r.version,
    assignees: r.assignees,
    conflicts: conflicts.get(r.id) ?? [],
  }));
}

export async function getVisit(db: Queryable, id: string, viewer: Viewer | null): Promise<Visit | null> {
  const [v] = await listVisits(db, { ids: [id] }, viewer);
  return v ?? null;
}

/**
 * Ütközés: ugyanannak a kollégának két, időben átfedő kiszállása (az egymásba érő vég és kezdet nem az). A törölt
 * és az „elmaradt” állapotú kiszállás nem ütközik. A nem látható projekt nevét a válasz nem adja ki.
 */
export async function findConflicts(
  db: Queryable,
  visitIds: string[],
  visibleProjectIds: string[] | null,
): Promise<Map<string, VisitConflict[]>> {
  const result = new Map<string, VisitConflict[]>();
  if (visitIds.length === 0) return result;
  const { rows } = await db.query<{
    visit_id: string;
    other_id: string;
    user_id: string;
    user_name: string;
    starts_at: Date;
    ends_at: Date;
    project_id: string;
    project_name: string;
  }>(
    `SELECT a1.visit_id, o.id AS other_id, a1.user_id, u.name AS user_name, o.starts_at, o.ends_at, o.project_id,
            p.name AS project_name
       FROM visits_assignee a1
       JOIN visits_visit v ON v.id = a1.visit_id
       JOIN visits_assignee a2 ON a2.user_id = a1.user_id AND a2.visit_id <> a1.visit_id
       JOIN visits_visit o ON o.id = a2.visit_id
       JOIN projects p ON p.id = o.project_id
       JOIN users u ON u.id = a1.user_id
      WHERE a1.visit_id = ANY($1::uuid[])
        AND v.status <> 'elmaradt' AND o.status <> 'elmaradt'
        AND o.deleted_at IS NULL AND p.deleted_at IS NULL
        AND o.starts_at < v.ends_at AND v.starts_at < o.ends_at
      ORDER BY o.starts_at, u.name`,
    [visitIds],
  );
  for (const r of rows) {
    const list = result.get(r.visit_id) ?? [];
    list.push({
      visitId: r.other_id,
      userId: r.user_id,
      userName: r.user_name,
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at.toISOString(),
      projectName: visibleProjectIds === null || visibleProjectIds.includes(r.project_id) ? r.project_name : null,
    });
    result.set(r.visit_id, list);
  }
  return result;
}

/** A kiszállás projektje (törölt kiszállásra `null`). */
export async function visitProjectId(db: Queryable, id: string): Promise<string | null> {
  const { rows } = await db.query<{ project_id: string }>(
    'SELECT project_id FROM visits_visit WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return rows[0]?.project_id ?? null;
}

export interface AssigneeCheck {
  assignees: VisitAssignee[];
  /** Hibaüzenet, ha valamelyik kolléga nem osztható be. */
  error: string | null;
}

/**
 * A beosztandó kollégák: létező, aktív felhasználók; a terepes csak akkor, ha a projekthez hozzá van rendelve (különben
 * a kiszállást sem látná). A sorrend a név szerinti.
 */
export async function checkAssignees(db: Queryable, projectId: string, userIds: string[]): Promise<AssigneeCheck> {
  const { rows } = await db.query<{ id: string; name: string; role: string; member: boolean }>(
    `SELECT u.id, u.name, u.role,
            EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = $1 AND m.user_id = u.id) AS member
       FROM users u
      WHERE u.id = ANY($2::uuid[]) AND u.deactivated_at IS NULL
      ORDER BY u.name`,
    [projectId, userIds],
  );
  const assignees = rows.map((r) => ({ id: r.id, name: r.name }));
  if (rows.length !== userIds.length) return { assignees, error: 'Ismeretlen vagy kikapcsolt felhasználó' };
  const outside = rows.filter((r) => r.role === 'terepes' && !r.member);
  if (outside.length > 0) {
    return { assignees, error: `Előbb a projekthez kell rendelni: ${outside.map((r) => r.name).join(', ')}` };
  }
  return { assignees, error: null };
}
