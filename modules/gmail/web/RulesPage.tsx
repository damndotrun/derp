import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api } from '@/core/api.ts';
import { t as coreT } from '@/core/i18n.ts';
import { RoleGate } from '@/core/RoleGate.tsx';
import type { Rule } from '../shared.ts';
import { gmailApi, gmailKey, rulesKey } from './api.ts';
import { t } from './i18n.ts';
import { GmailNav } from './parts.tsx';

/** A hozzárendelési szabályok szerkesztője: az első illeszkedő szabály projektje a javaslat. */
export function RulesPage() {
  return (
    <RoleGate roles={['admin', 'iroda']}>
      <Rules />
    </RoleGate>
  );
}

function Rules() {
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: rulesKey, queryFn: gmailApi.rules });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [pattern, setPattern] = useState('');
  const [projectId, setProjectId] = useState('');
  // A szabályok a javaslatot is változtatják, ezért a levelek nézetei is frissülnek.
  const refresh = () => queryClient.invalidateQueries({ queryKey: gmailKey });

  const create = useMutation({
    mutationFn: () => gmailApi.createRule({ pattern, projectId }),
    onSuccess: () => {
      setPattern('');
      void refresh();
    },
  });
  const update = useMutation({ mutationFn: (v: { id: string; position: number }) => gmailApi.updateRule(v.id, { position: v.position }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => gmailApi.deleteRule(id), onSuccess: refresh });
  const items = rules.data?.items ?? [];
  const error = create.error ?? update.error ?? remove.error;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('gmail.title')}</h1>
      <GmailNav />
      <Card>
        <CardHeader>
          <CardTitle>{t('gmail.rules.title')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('gmail.rules.help')}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="gmail-rule-pattern">{t('gmail.rules.pattern')}</Label>
              <Input id="gmail-rule-pattern" value={pattern} maxLength={200} required onChange={(e) => setPattern(e.target.value)} />
            </div>
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="gmail-rule-project">{t('gmail.rules.project')}</Label>
              <Select id="gmail-rule-project" value={projectId} required onChange={(e) => setProjectId(e.target.value)}>
                <option value="">{t('gmail.inbox.chooseProject')}</option>
                {(projects.data?.items ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={create.isPending || !pattern.trim() || !projectId}>
              {t('gmail.rules.add')}
            </Button>
          </form>
          {error && <p className="text-sm text-destructive">{error.message}</p>}
          {rules.data && items.length === 0 && <p className="text-sm text-muted-foreground">{t('gmail.rules.empty')}</p>}
          {items.length > 0 && (
            <ol aria-label={t('gmail.rules.list')} className="flex flex-col divide-y">
              {items.map((rule, i) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  first={i === 0}
                  last={i === items.length - 1}
                  onMove={(dir) => update.mutate({ id: rule.id, position: i + dir })}
                  onDelete={() => remove.mutate(rule.id)}
                />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RuleRow({ rule, first, last, onMove, onDelete }: { rule: Rule; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void; onDelete: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <code className="rounded bg-muted px-1.5 py-0.5 text-sm break-all">{rule.pattern}</code>
      <span aria-hidden="true">→</span>
      <span className="flex-1 text-sm">{rule.projectName}</span>
      <Button size="sm" variant="ghost" disabled={first} aria-label={`${t('gmail.rules.up')}: ${rule.pattern}`} onClick={() => onMove(-1)}>
        ↑
      </Button>
      <Button size="sm" variant="ghost" disabled={last} aria-label={`${t('gmail.rules.down')}: ${rule.pattern}`} onClick={() => onMove(1)}>
        ↓
      </Button>
      <Button size="sm" variant="outline" aria-label={`${coreT('common.delete')}: ${rule.pattern}`} onClick={onDelete}>
        {coreT('common.delete')}
      </Button>
    </li>
  );
}
