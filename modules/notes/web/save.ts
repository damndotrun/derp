// Jegyzet és felmérés mentése. Az offline sor (8.) is ezt használja: előbb `prepareNote` / `prepareSurvey` (kliens
// oldali azonosítók és időbélyeg, kicsinyített fotók; az eredmény IndexedDB-be tehető), majd `sendNote` /
// `sendSurvey` (újrajátszva sem duplikál). A felmérés és a fotói egy elem (`notes.survey`), a jegyzet `notes.note`.
import { ApiError } from '@/core/api.ts';
import type { DocsFile } from '../../docs/shared.ts';
import { docsApi } from '../../docs/web/api.ts';
import { newId, prepareUpload, sendUpload, type PreparedUpload } from '../../docs/web/upload.ts';
import { SURVEY_FOLDER, type MaterialItem, type Note, type Survey } from '../shared.ts';
import { notesApi } from './api.ts';

export interface PreparedNote {
  id: string;
  projectId: string;
  body: string;
  /** Kliens oldali időbélyeg (ISO): offline írt jegyzetnél a terepi időpont lesz az esemény ideje. */
  capturedAt?: string;
}

export function prepareNote(projectId: string, body: string): PreparedNote {
  return { id: newId(), projectId, body: body.trim(), capturedAt: new Date().toISOString() };
}

export function sendNote(n: PreparedNote): Promise<Note> {
  return notesApi.saveNote(n.projectId, n.id, { body: n.body, capturedAt: n.capturedAt });
}

export interface SurveyFields {
  location: string;
  condition: string;
  proposedWork: string;
  materials: MaterialItem[];
}

export interface PreparedSurvey extends SurveyFields {
  id: string;
  projectId: string;
  /** A fotók a dokumentumtárba; a mappát és a szülő-eseményt a küldés tölti ki. */
  photos: PreparedUpload[];
  /** Kliens oldali időbélyeg (ISO): offline kitöltött felmérésnél a terepi időpont (a fotóké is ez). */
  capturedAt?: string;
}

export async function prepareSurvey(projectId: string, fields: SurveyFields, files: File[] = []): Promise<PreparedSurvey> {
  const capturedAt = new Date().toISOString();
  return {
    id: newId(),
    projectId,
    location: fields.location.trim(),
    condition: fields.condition.trim(),
    proposedWork: fields.proposedWork.trim(),
    materials: fields.materials.map((m) => ({ name: m.name.trim(), quantity: m.quantity, unit: m.unit.trim() })),
    photos: await Promise.all(files.map((f) => prepareUpload(projectId, f, { capturedAt }))),
    capturedAt,
  };
}

/** A projekt dokumentumtárának „Felmérések” mappája (a gyökérben); ha nincs, létrehozza. */
export async function surveyFolderId(projectId: string): Promise<string> {
  const find = async () =>
    (await docsApi.project(projectId)).folders.find((f) => f.parentId === null && f.name.toLowerCase() === SURVEY_FOLDER.toLowerCase());
  const existing = await find();
  if (existing) return existing.id;
  try {
    return (await docsApi.createFolder(projectId, { name: SURVEY_FOLDER })).id;
  } catch (err) {
    // Közben más hozta létre.
    if (err instanceof ApiError && err.status === 409) {
      const created = await find();
      if (created) return created.id;
    }
    throw err;
  }
}

export interface SurveyProgress {
  survey?: Survey;
  uploaded: number;
}

/**
 * Elmenti a felmérést (idempotens `PUT`), majd a fotókat a dokumentumtár „Felmérések” mappájába, a felmérés
 * eseménye alá (`parentEventId`), így az idővonalon egy csoportban látszanak. Megszakadás után ugyanazzal a
 * `PreparedSurvey`-vel újra hívható: a már elmentett felmérés és a már feltöltött fotók nem duplikálódnak.
 */
export async function sendSurvey(s: PreparedSurvey, onProgress?: (p: SurveyProgress) => void): Promise<{ survey: Survey; files: DocsFile[] }> {
  const survey = await notesApi.saveSurvey(s.projectId, s.id, {
    location: s.location,
    condition: s.condition,
    proposedWork: s.proposedWork,
    materials: s.materials,
    photos: s.photos.map((p) => ({ id: p.id, name: p.name })),
    capturedAt: s.capturedAt,
  });
  onProgress?.({ survey, uploaded: 0 });
  const files: DocsFile[] = [];
  if (s.photos.length > 0) {
    const folderId = await surveyFolderId(s.projectId);
    for (const p of s.photos) {
      files.push(await sendUpload({ ...p, folderId, parentEventId: survey.eventId, capturedAt: s.capturedAt ?? p.capturedAt }));
      onProgress?.({ survey, uploaded: files.length });
    }
  }
  return { survey, files };
}

/** Magyar formátumú mennyiség („2,5”, „2.5”, „1 000”) számmá; ha nem pozitív szám, `null`. */
export function parseQuantity(text: string): number | null {
  const s = text.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}
