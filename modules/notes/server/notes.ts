import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { eq } from 'drizzle-orm';
import type { ModuleContext } from '@derp/server/module-api';
import {
  NOTES_EVENTS,
  type MaterialItem,
  type Note,
  type NoteEventData,
  type PhotoRef,
  type ProjectNotes,
  type Survey,
  type SurveyEventData,
  type SurveyPhoto,
} from '../shared.ts';
import { notesNotes, notesSurveys } from './schema.ts';

interface NoteRow {
  id: string;
  project_id: string;
  author_id: string;
  author_name: string;
  body: string;
  event_id: string | null;
  created_at: Date;
}

interface SurveyRow {
  id: string;
  project_id: string;
  author_id: string;
  author_name: string;
  location: string;
  condition: string;
  proposed_work: string;
  materials: MaterialItem[];
  photos: PhotoRef[];
  event_id: string | null;
  created_at: Date;
}

const SELECT_NOTES = `
  SELECT n.id, n.project_id, n.author_id, u.name AS author_name, n.body, n.event_id, n.created_at
  FROM notes_notes n JOIN users u ON u.id = n.author_id`;

const SELECT_SURVEYS = `
  SELECT s.id, s.project_id, s.author_id, u.name AS author_name, s.location, s.condition, s.proposed_work, s.materials,
         s.photos, s.event_id, s.created_at
  FROM notes_surveys s JOIN users u ON u.id = s.author_id`;

const toNote = (r: NoteRow): Note => ({
  id: r.id,
  projectId: r.project_id,
  author: { id: r.author_id, name: r.author_name },
  body: r.body,
  eventId: r.event_id,
  createdAt: r.created_at.toISOString(),
});

// A JSONB nem őrzi meg a kulcsok sorrendjét, ezért a tételt mindig ugyanabban az alakban adjuk vissza.
const material = (m: MaterialItem): MaterialItem => ({ name: m.name, quantity: Number(m.quantity), unit: m.unit });

/** A felmérések a fotók állapotával a dokumentumtárból. */
async function hydrateSurveys(pool: pg.Pool, rows: SurveyRow[]): Promise<Survey[]> {
  if (rows.length === 0) return [];
  const projectId = rows[0]!.project_id;
  const fileIds = [...new Set(rows.flatMap((r) => r.photos.map((p) => p.id)))];

  type FileRow = { id: string; name: string; mime: string; folder_id: string | null; has_thumb: boolean };
  const files = new Map<string, FileRow>();
  const deleted = new Set<string>();
  if (fileIds.length > 0) {
    const f = await pool.query<FileRow>(
      `SELECT f.id, f.name, f.mime, f.folder_id, b.has_thumb
       FROM docs_files f JOIN docs_blobs b ON b.sha256 = f.sha256
       WHERE f.id = ANY($1::uuid[]) AND f.project_id = $2`,
      [fileIds, projectId],
    );
    for (const row of f.rows) files.set(row.id, row);
    const d = await pool.query<{ id: string }>(
      `SELECT DISTINCT data->>'fileId' AS id FROM events
       WHERE project_id = $1 AND type = 'docs.file_deleted' AND data->>'fileId' = ANY($2::text[])`,
      [projectId, fileIds],
    );
    for (const row of d.rows) deleted.add(row.id);
  }

  const photo = (p: PhotoRef): SurveyPhoto => {
    const f = files.get(p.id);
    if (f) return { id: p.id, name: f.name, status: 'ready', mime: f.mime, hasThumb: f.has_thumb, folderId: f.folder_id };
    return { id: p.id, name: p.name, status: deleted.has(p.id) ? 'deleted' : 'pending', mime: null, hasThumb: false, folderId: null };
  };

  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    author: { id: r.author_id, name: r.author_name },
    location: r.location,
    condition: r.condition,
    proposedWork: r.proposed_work,
    materials: r.materials.map(material),
    photos: r.photos.map(photo),
    eventId: r.event_id,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function getNote(pool: pg.Pool, id: string): Promise<Note | null> {
  const res = await pool.query<NoteRow>(`${SELECT_NOTES} WHERE n.id = $1`, [id]);
  return res.rows[0] ? toNote(res.rows[0]) : null;
}

export async function getSurvey(pool: pg.Pool, id: string): Promise<Survey | null> {
  const res = await pool.query<SurveyRow>(`${SELECT_SURVEYS} WHERE s.id = $1`, [id]);
  return (await hydrateSurveys(pool, res.rows))[0] ?? null;
}

/** Egy projekt jegyzetei és felmérései, a legújabbal kezdve. */
export async function listProjectNotes(pool: pg.Pool, projectId: string): Promise<ProjectNotes> {
  const notes = await pool.query<NoteRow>(`${SELECT_NOTES} WHERE n.project_id = $1 ORDER BY n.created_at DESC, n.id DESC`, [projectId]);
  const surveys = await pool.query<SurveyRow>(`${SELECT_SURVEYS} WHERE s.project_id = $1 ORDER BY s.created_at DESC, s.id DESC`, [projectId]);
  return { notes: notes.rows.map(toNote), surveys: await hydrateSurveys(pool, surveys.rows) };
}

const excerpt = (s: string, max = 80) => {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

export interface NoteInput {
  id: string;
  projectId: string;
  body: string;
}

const sameNote = (n: Note, input: NoteInput, authorId: string) =>
  n.projectId === input.projectId && n.author.id === authorId && n.body === input.body;

/**
 * Új jegyzet a kliens által kiosztott azonosítóval. Ugyanazzal az azonosítóval és tartalommal újraküldve a meglévőt
 * adja vissza (`created: false`), eltérő tartalommal (más szerzővel, más projektben) 409.
 */
export async function createNote(ctx: ModuleContext, req: FastifyRequest, input: NoteInput): Promise<{ note: Note; created: boolean }> {
  const user = req.user!;
  const conflict = () => ctx.errors.conflict('Ez a jegyzetazonosító már egy másik jegyzethez tartozik');
  const existing = await getNote(ctx.pool, input.id);
  if (existing) {
    if (!sameNote(existing, input, user.id)) throw conflict();
    return { note: existing, created: false };
  }

  let created = false;
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(notesNotes)
      .values({ id: input.id, projectId: input.projectId, authorId: user.id, body: input.body })
      .onConflictDoNothing()
      .returning();
    // Ugyanaz az azonosító közben egy párhuzamos kérésből került be.
    if (!row) return;

    const data: NoteEventData = { noteId: row.id, body: row.body };
    const eventId = await ctx.appendEvent(
      {
        projectId: input.projectId,
        type: NOTES_EVENTS.noteAdded,
        source: 'user',
        title: `Helyszíni jegyzet: ${excerpt(row.body)}`,
        actorId: user.id,
        data: { ...data },
      },
      tx,
    );
    await tx.update(notesNotes).set({ eventId }).where(eq(notesNotes.id, row.id));
    await ctx.audit(req, { action: 'create', entity: 'note', entityId: row.id, label: excerpt(row.body, 60), projectId: input.projectId }, tx);
    created = true;
  });

  const note = (await getNote(ctx.pool, input.id))!;
  if (!created && !sameNote(note, input, user.id)) throw conflict();
  return { note, created };
}

export interface SurveyInput {
  id: string;
  projectId: string;
  location: string;
  condition: string;
  proposedWork: string;
  materials: MaterialItem[];
  photos: PhotoRef[];
}

const materialsKey = (items: MaterialItem[]) => JSON.stringify(items.map(material));

/** Ugyanaz a felmérés-e (újraküldés), vagy az azonosító egy másik felmérésé. */
const sameSurvey = (s: Survey, input: SurveyInput, authorId: string) =>
  s.projectId === input.projectId &&
  s.author.id === authorId &&
  s.location === input.location &&
  s.condition === input.condition &&
  s.proposedWork === input.proposedWork &&
  materialsKey(s.materials) === materialsKey(input.materials) &&
  s.photos.map((p) => p.id).join() === input.photos.map((p) => p.id).join();

/**
 * Új felmérés a kliens által kiosztott azonosítóval (újraküldve nem duplikál, eltérő tartalommal 409). A felmérés
 * eseményt kap az idővonalra; a fotók feltöltésekor a kliens ezt adja meg `parentEventId`-ként, így a fotók az
 * idővonalon a felmérés alatt, egy csoportban látszanak.
 */
export async function createSurvey(ctx: ModuleContext, req: FastifyRequest, input: SurveyInput): Promise<{ survey: Survey; created: boolean }> {
  const user = req.user!;
  const conflict = () => ctx.errors.conflict('Ez a felmérésazonosító már egy másik felméréshez tartozik');
  const existing = await getSurvey(ctx.pool, input.id);
  if (existing) {
    if (!sameSurvey(existing, input, user.id)) throw conflict();
    return { survey: existing, created: false };
  }

  if (input.photos.length > 0) {
    const foreign = await ctx.pool.query('SELECT 1 FROM docs_files WHERE id = ANY($1::uuid[]) AND project_id <> $2 LIMIT 1', [
      input.photos.map((p) => p.id),
      input.projectId,
    ]);
    if (foreign.rowCount) throw ctx.errors.badRequest('A csatolt fotó egy másik projekthez tartozik');
  }

  const materials = input.materials.map(material);
  let created = false;
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(notesSurveys)
      .values({
        id: input.id,
        projectId: input.projectId,
        authorId: user.id,
        location: input.location,
        condition: input.condition,
        proposedWork: input.proposedWork,
        materials,
        photos: input.photos,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return;

    const data: SurveyEventData = {
      surveyId: row.id,
      location: row.location,
      condition: row.condition,
      proposedWork: row.proposedWork,
      materials,
      photos: input.photos.length,
    };
    const eventId = await ctx.appendEvent(
      {
        projectId: input.projectId,
        type: NOTES_EVENTS.surveyAdded,
        source: 'user',
        title: `Felmérés: ${excerpt(row.location)}`,
        actorId: user.id,
        data: { ...data },
      },
      tx,
    );
    await tx.update(notesSurveys).set({ eventId }).where(eq(notesSurveys.id, row.id));
    await ctx.audit(req, { action: 'create', entity: 'survey', entityId: row.id, label: excerpt(row.location, 60), projectId: input.projectId }, tx);
    created = true;
  });

  const survey = (await getSurvey(ctx.pool, input.id))!;
  if (!created && !sameSurvey(survey, input, user.id)) throw conflict();
  return { survey, created };
}
