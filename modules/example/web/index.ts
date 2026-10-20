import type { WebModule } from '@/core/module-types.ts';
import { ExamplePage } from './ExamplePage.tsx';
import { messages } from './i18n.ts';
import { PingedEvent } from './PingedEvent.tsx';

export default {
  id: 'example',
  messages,
  routes: [{ path: '/example', Component: ExamplePage }],
  eventRenderers: { 'example.pinged': PingedEvent },
} satisfies WebModule;
