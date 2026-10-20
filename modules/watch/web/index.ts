import type { WebModule } from '@/core/module-types.ts';
import { messages } from './i18n.ts';
import { ProjectWatchPage } from './ProjectWatchPage.tsx';
import { WatchFileEvent } from './WatchEvents.tsx';
import { WatchHomePage } from './WatchHomePage.tsx';

export default {
  id: 'watch',
  messages,
  routes: [
    { path: '/watch', Component: WatchHomePage },
    { path: '/watch/:projectId', Component: ProjectWatchPage },
  ],
  eventRenderers: {
    'watch.file_added': WatchFileEvent,
    'watch.file_modified': WatchFileEvent,
    'watch.file_deleted': WatchFileEvent,
    'watch.file_renamed': WatchFileEvent,
  },
  projectLinks: [{ labelKey: 'watch.projectLink', to: (projectId) => `/watch/${projectId}` }],
} satisfies WebModule;
