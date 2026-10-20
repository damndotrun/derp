import { request } from '@/core/api.ts';
import type { ChatMessage, MessageCreate, MessagePage, PeopleList, UnreadSummary } from '../shared.ts';

export const chatKey = (projectId: string) => ['chat', projectId] as const;
export const unreadKey = ['chat', 'unread'] as const;

export const chatApi = {
  messages: (projectId: string, before?: number) =>
    request<MessagePage>('GET', `/api/chat/projects/${projectId}/messages${before ? `?before=${before}` : ''}`),
  /** Idempotens: ugyanazzal az azonosítóval újraküldve ugyanazt az üzenetet adja (200). */
  send: (projectId: string, messageId: string, body: MessageCreate) =>
    request<ChatMessage>('PUT', `/api/chat/projects/${projectId}/messages/${messageId}`, body),
  markRead: (projectId: string, seq: number) => request<{ lastReadSeq: number }>('PUT', `/api/chat/projects/${projectId}/read`, { seq }),
  people: (projectId: string) => request<PeopleList>('GET', `/api/chat/projects/${projectId}/people`),
  unread: () => request<UnreadSummary>('GET', '/api/chat/unread'),
};
