import { sql } from 'drizzle-orm';
import type { Db } from '@derp/server/module-api';
import type { Rule } from '../shared.ts';

const rows = async <T>(db: Pick<Db, 'execute'>, q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)).rows as T[];

interface RuleRow {
  id: string;
  pattern: string;
  project_id: string;
  project_name: string;
  position: number;
}

const toRule = (r: RuleRow): Rule => ({ id: r.id, pattern: r.pattern, projectId: r.project_id, projectName: r.project_name, position: r.position });

const SELECT_RULES = sql`
  SELECT r.id, r.pattern, r.project_id, p.name AS project_name, r.position
  FROM gmail_rules r JOIN projects p ON p.id = r.project_id`;

/** A szabályok a kiértékelés sorrendjében (az első illeszkedő nyer). */
export async function listRules(db: Db): Promise<Rule[]> {
  return (await rows<RuleRow>(db, sql`${SELECT_RULES} ORDER BY r.position, r.created_at, r.id`)).map(toRule);
}

export async function getRule(db: Db, id: string): Promise<Rule | null> {
  const [r] = await rows<RuleRow>(db, sql`${SELECT_RULES} WHERE r.id = ${id}`);
  return r ? toRule(r) : null;
}

/** Új szabály a lista végére. */
export async function createRule(db: Db, input: { pattern: string; projectId: string; userId: string }): Promise<Rule> {
  const [r] = await rows<{ id: string }>(
    db,
    sql`INSERT INTO gmail_rules (pattern, project_id, position, created_by)
        VALUES (${input.pattern}, ${input.projectId}, (SELECT coalesce(max(position) + 1, 0) FROM gmail_rules), ${input.userId})
        RETURNING id`,
  );
  return (await getRule(db, r!.id))!;
}

/** Minta, projekt vagy hely módosítása; a hely 0-tól számolt index a listában (a többi szabály eltolódik). */
export async function updateRule(db: Db, id: string, input: { pattern?: string; projectId?: string; position?: number }): Promise<Rule | null> {
  const found = await db.transaction(async (tx) => {
    // A teljes lista zárolva, hogy a párhuzamos átrendezés ne keverje össze a sorrendet.
    const ids = (await rows<{ id: string }>(tx, sql`SELECT id FROM gmail_rules ORDER BY position, created_at, id FOR UPDATE`)).map((r) => r.id);
    if (!ids.includes(id)) return false;
    if (input.pattern !== undefined) await tx.execute(sql`UPDATE gmail_rules SET pattern = ${input.pattern} WHERE id = ${id}`);
    if (input.projectId !== undefined) await tx.execute(sql`UPDATE gmail_rules SET project_id = ${input.projectId} WHERE id = ${id}`);
    if (input.position !== undefined) {
      const order = ids.filter((x) => x !== id);
      order.splice(Math.min(input.position, order.length), 0, id);
      for (const [i, ruleId] of order.entries()) await tx.execute(sql`UPDATE gmail_rules SET position = ${i} WHERE id = ${ruleId}`);
    }
    return true;
  });
  return found ? getRule(db, id) : null;
}

export async function deleteRule(db: Db, id: string): Promise<Rule | null> {
  const rule = await getRule(db, id);
  if (rule) await db.execute(sql`DELETE FROM gmail_rules WHERE id = ${id}`);
  return rule;
}
