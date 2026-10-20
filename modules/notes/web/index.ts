import type { WebModule } from '@/core/module-types.ts';
import { messages } from './i18n.ts';
import { NoteAddedEvent, SurveyAddedEvent } from './NotesEvents.tsx';
import { NotesHomePage } from './NotesHomePage.tsx';
import { ProjectNotesPage } from './ProjectNotesPage.tsx';
import { sendNote, sendSurvey, type PreparedNote, type PreparedSurvey, type SurveyProgress } from './save.ts';
import { SurveyPage } from './SurveyPage.tsx';

export default {
  id: 'notes',
  messages,
  routes: [
    { path: '/notes', Component: NotesHomePage },
    { path: '/notes/:projectId', Component: ProjectNotesPage },
    { path: '/notes/:projectId/surveys/:surveyId', Component: SurveyPage },
  ],
  eventRenderers: { 'notes.survey_added': SurveyAddedEvent, 'notes.note_added': NoteAddedEvent },
  projectLinks: [{ labelKey: 'notes.projectLink', to: (projectId) => `/notes/${projectId}` }],
  // Terepi mód (8.): a felmérés (a fotóival együtt egy elem) és a jegyzet offline is elkészülhet.
  outbox: {
    'notes.survey': { send: (s: PreparedSurvey, { onProgress }) => sendSurvey(s, onProgress as ((p: SurveyProgress) => void) | undefined) },
    'notes.note': { send: (n: PreparedNote) => sendNote(n) },
  },
  offlineUrls: { project: (projectId) => [`/api/notes/projects/${projectId}`] },
} satisfies WebModule;
