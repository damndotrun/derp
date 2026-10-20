import { useQueryClient } from '@tanstack/react-query';
import { request } from '@/core/api.ts';
import { useModules } from '@/core/modules.ts';
import { useLiveEvents } from '@/core/stream.ts';
import type { Account, AccountList, MessageDetail, Rule, RuleCreate, RuleList, RuleUpdate, SyncResults, ThreadDetail, ThreadList } from '../shared.ts';

export const gmailKey = ['gmail'] as const;
export const threadsKey = ['gmail', 'threads'] as const;
export const rulesKey = ['gmail', 'rules'] as const;
export const accountsKey = ['gmail', 'accounts'] as const;
export const messageKey = (id: string) => ['gmail', 'message', id] as const;

export const gmailApi = {
  unassigned: (limit: number, view: 'open' | 'dismissed' = 'open') => request<ThreadList>('GET', `/api/gmail/threads?limit=${limit}&view=${view}`),
  dismiss: (id: string, dismissed: boolean) => request<ThreadDetail>('PUT', `/api/gmail/threads/${id}/dismissed`, { dismissed }),
  thread: (id: string) => request<ThreadDetail>('GET', `/api/gmail/threads/${id}`),
  assign: (id: string, projectId: string) => request<ThreadDetail>('PUT', `/api/gmail/threads/${id}/project`, { projectId }),
  message: (id: string) => request<MessageDetail>('GET', `/api/gmail/messages/${id}`),
  sync: () => request<SyncResults>('POST', '/api/gmail/sync'),
  rules: () => request<RuleList>('GET', '/api/gmail/rules'),
  createRule: (body: RuleCreate) => request<Rule>('POST', '/api/gmail/rules', body),
  updateRule: (id: string, body: RuleUpdate) => request<Rule>('PATCH', `/api/gmail/rules/${id}`, body),
  deleteRule: (id: string) => request<void>('DELETE', `/api/gmail/rules/${id}`),
  accounts: () => request<AccountList>('GET', '/api/gmail/accounts'),
  addAccount: (email: string) => request<Account>('POST', '/api/gmail/accounts', { email }),
};

/** Megkapta-e a bejelentkezett felhasználó a modul jogosultságát (a szerver úgyis ellenőrzi). */
export function useGmailPermission(key: 'gmail.assign' | 'gmail.rules' | 'gmail.accounts'): boolean {
  const modules = useModules();
  return modules.data?.items.find((m) => m.id === 'gmail')?.permissions.includes(key) ?? false;
}

/** Levélesemény (pl. betöltés egy hozzárendelt szálba) esetén a levelek nézetei újratöltődnek. */
export function useLiveGmail(): void {
  const queryClient = useQueryClient();
  useLiveEvents((e) => {
    if (e.type.startsWith('gmail.')) void queryClient.invalidateQueries({ queryKey: gmailKey });
  });
}
