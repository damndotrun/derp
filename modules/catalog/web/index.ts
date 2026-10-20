import type { WebModule } from '@/core/module-types.ts';
import { CatalogPage } from './CatalogPage.tsx';
import { messages } from './i18n.ts';

export default {
  id: 'catalog',
  messages,
  routes: [{ path: '/catalog', Component: CatalogPage }],
} satisfies WebModule;
