import type { WebModule } from '@/core/module-types.ts';
import { AccountsPage } from './AccountsPage.tsx';
import { GmailMessageEvent, GmailThreadMovedEvent } from './GmailMessageEvent.tsx';
import { messages } from './i18n.ts';
import { InboxPage } from './InboxPage.tsx';
import { RulesPage } from './RulesPage.tsx';

export default {
  id: 'gmail',
  messages,
  routes: [
    { path: '/gmail', Component: InboxPage },
    { path: '/gmail/rules', Component: RulesPage },
    { path: '/gmail/accounts', Component: AccountsPage },
  ],
  eventRenderers: { 'gmail.message': GmailMessageEvent, 'gmail.thread_moved': GmailThreadMovedEvent },
} satisfies WebModule;
