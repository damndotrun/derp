import type { WebModule } from '@/core/module-types.ts';
import { messages } from './i18n.ts';
import { MinePage } from './MinePage.tsx';
import { SchedulePage } from './SchedulePage.tsx';
import { VisitEvent } from './VisitEvent.tsx';

export default {
  id: 'visits',
  messages,
  routes: [
    { path: '/visits/schedule', Component: SchedulePage },
    { path: '/visits/mine', Component: MinePage },
  ],
  eventRenderers: {
    'visits.scheduled': VisitEvent,
    'visits.updated': VisitEvent,
    'visits.cancelled': VisitEvent,
  },
} satisfies WebModule;
