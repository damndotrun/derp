import { request } from '@/core/api.ts';
import type { Note, NoteCreate, ProjectNotes, Survey, SurveyCreate } from '../shared.ts';

export const notesKey = (projectId: string) => ['notes', projectId] as const;
export const surveyKey = (surveyId: string) => ['notes', 'survey', surveyId] as const;

export const notesApi = {
  project: (projectId: string) => request<ProjectNotes>('GET', `/api/notes/projects/${projectId}`),
  survey: (surveyId: string) => request<Survey>('GET', `/api/notes/surveys/${surveyId}`),
  /** Idempotens: ugyanazzal az azonosítóval újraküldve ugyanazt a jegyzetet adja (200). */
  saveNote: (projectId: string, noteId: string, body: NoteCreate) => request<Note>('PUT', `/api/notes/projects/${projectId}/notes/${noteId}`, body),
  /** Idempotens: ugyanazzal az azonosítóval újraküldve ugyanazt a felmérést adja (200). */
  saveSurvey: (projectId: string, surveyId: string, body: SurveyCreate) =>
    request<Survey>('PUT', `/api/notes/projects/${projectId}/surveys/${surveyId}`, body),
};
