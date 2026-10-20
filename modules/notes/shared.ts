// A jegyzet és felmérés szerver és kliens közötti adatformái (a szerver ezekkel validál, a kliens a típusokat használja).
import { z } from 'zod';

export const MAX_TEXT = 4000;
export const MAX_LOCATION = 300;
export const MAX_MATERIALS = 100;
export const MAX_PHOTOS = 30;

const required = (max: number) => z.string().trim().min(1, 'kötelező mező').max(max);

/**
 * Kliens oldali időbélyeg (pl. offline írt jegyzet, felmérés): ez lesz az esemény ideje (a jövőbeli helyett a szerver
 * ideje, a 30 napnál régebbit a szerver nem veszi figyelembe). Az újraküldés összevetésében nem számít.
 */
const CapturedAt = z.iso.datetime({ offset: true }).optional();

/** Fotó a felmérés létrehozásakor: a kliens által kiosztott `docs_files.id` és a fájl neve. */
export const PhotoRef = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(255) });
export type PhotoRef = z.infer<typeof PhotoRef>;

/** A becsült anyag egy tétele. */
export const MaterialItem = z.object({
  name: required(255),
  quantity: z.number().positive('a mennyiség legyen pozitív').max(1_000_000_000),
  unit: required(20),
});
export type MaterialItem = z.infer<typeof MaterialItem>;

/** `PUT /api/notes/projects/:projectId/notes/:noteId` törzse: szabad szöveges helyszíni jegyzet. */
export const NoteCreate = z.object({ body: required(MAX_TEXT), capturedAt: CapturedAt });
export type NoteCreate = z.input<typeof NoteCreate>;

/** `PUT /api/notes/projects/:projectId/surveys/:surveyId` törzse: a felmérés kötelező mezői és a csatolt fotók. */
export const SurveyCreate = z
  .object({
    location: required(MAX_LOCATION),
    condition: required(MAX_TEXT),
    proposedWork: required(MAX_TEXT),
    materials: z.array(MaterialItem).min(1, 'legalább egy anyagtétel kell').max(MAX_MATERIALS),
    photos: z.array(PhotoRef).max(MAX_PHOTOS).default([]),
    capturedAt: CapturedAt,
  })
  .refine((s) => new Set(s.photos.map((p) => p.id)).size === s.photos.length, 'Egy fotó kétszer szerepel');
export type SurveyCreate = z.input<typeof SurveyCreate>;

export const Person = z.object({ id: z.uuid(), name: z.string() });
export type Person = z.infer<typeof Person>;

/**
 * Fotó a felmérésben: `ready`, ha a dokumentumtárban van; `pending`, ha még nem töltődött fel (pl. az offline sorban
 * vár); `deleted`, ha azóta törölték a dokumentumtárból.
 */
export const SurveyPhoto = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(['ready', 'pending', 'deleted']),
  mime: z.string().nullable(),
  hasThumb: z.boolean(),
  folderId: z.uuid().nullable(),
});
export type SurveyPhoto = z.infer<typeof SurveyPhoto>;

export const Note = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  author: Person,
  body: z.string(),
  eventId: z.uuid().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Note = z.infer<typeof Note>;

export const Survey = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  author: Person,
  location: z.string(),
  condition: z.string(),
  proposedWork: z.string(),
  materials: z.array(MaterialItem),
  photos: z.array(SurveyPhoto),
  /** A felmérés eseménye; a fotók feltöltésekor a kliens ezt adja meg `parentEventId`-ként. */
  eventId: z.uuid().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Survey = z.infer<typeof Survey>;

/** Egy projekt jegyzetei és felmérései, mindkettő a legújabbal kezdve. */
export const ProjectNotes = z.object({ notes: z.array(Note), surveys: z.array(Survey) });
export type ProjectNotes = z.infer<typeof ProjectNotes>;

export const NOTES_EVENTS = {
  noteAdded: 'notes.note_added',
  surveyAdded: 'notes.survey_added',
} as const;

/** A `notes.note_added` esemény `data` mezője. */
export interface NoteEventData {
  noteId: string;
  body: string;
}

/** A `notes.survey_added` esemény `data` mezője (a felmérés teljes szövege, hogy az idővonalon kibontva olvasható legyen). */
export interface SurveyEventData {
  surveyId: string;
  location: string;
  condition: string;
  proposedWork: string;
  materials: MaterialItem[];
  /** A csatolt fotók száma; a fotók feltöltési eseményei a felmérés eseménye alatt (`parentId`). */
  photos: number;
}

/** A dokumentumtár mappája, ahová a felmérések fotói kerülnek (a projekt gyökerében). */
export const SURVEY_FOLDER = 'Felmérések';
