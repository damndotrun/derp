import type { WebModule } from '@/core/module-types.ts';
import { ChatHomePage } from './ChatHomePage.tsx';
import { ChatMessageEvent } from './ChatMessageEvent.tsx';
import { messages } from './i18n.ts';
import { ProjectChatPage } from './ProjectChatPage.tsx';
import { ChatMenuBadge, ProjectChatBadge } from './unread.tsx';

export default {
  id: 'chat',
  messages,
  routes: [
    { path: '/chat', Component: ChatHomePage },
    { path: '/chat/:projectId', Component: ProjectChatPage },
  ],
  eventRenderers: { 'chat.message_posted': ChatMessageEvent },
  projectLinks: [{ labelKey: 'chat.projectLink', to: (projectId) => `/chat/${projectId}`, Badge: ProjectChatBadge }],
  menuBadges: { '/chat': ChatMenuBadge },
} satisfies WebModule;
