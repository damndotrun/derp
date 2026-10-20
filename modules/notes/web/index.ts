import type { WebModule } from '@/core/module-types.ts';
import { messages } from './i18n.ts';
import { NoteAddedEvent, SurveyAddedEvent } from './NotesEvents.tsx';
import { NotesHomePage } from './NotesHomePage.tsx';
import { ProjectNotesPage } from './ProjectNotesPage.tsx';
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
} satisfies WebModule;
