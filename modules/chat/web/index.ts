import type { WebModule } from '@/core/module-types.ts';
import { ChatHomePage } from './ChatHomePage.tsx';
import { ChatMessageEvent } from './ChatMessageEvent.tsx';
import { messages } from './i18n.ts';
import { ProjectChatPage } from './ProjectChatPage.tsx';
import { sendMessage, type PreparedMessage, type SendProgress } from './send.ts';
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
  // Terepi mód (8.): az üzenet (a csatolmányaival együtt egy elem) offline is megírható; a projekt chatje a telefonon.
  outbox: {
    'chat.message': { send: (m: PreparedMessage, { onProgress }) => sendMessage(m, onProgress as ((p: SendProgress) => void) | undefined) },
  },
  offlineUrls: {
    global: ['/api/chat/unread'],
    project: (projectId) => [`/api/chat/projects/${projectId}/messages`, `/api/chat/projects/${projectId}/people`],
  },
} satisfies WebModule;
