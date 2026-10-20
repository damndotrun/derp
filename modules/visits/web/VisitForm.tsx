import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/core/api.ts';
import { t as coreT } from '@/core/i18n.ts';
import { VisitStatus, type Visit } from '../shared/schemas.ts';
import { addDays, localDate, localTime, zonedToUtc } from '../shared/time.ts';
import { t } from './i18n.ts';

export interface VisitFormValues {
  projectId: string;
  assigneeIds: string[];
  startsAt: string;
  endsAt: string;
  address: string;
  task: string;
  status: VisitStatus;
}

interface Props {
  timeZone: string;
  /** Szerkesztésnél a meglévő kiszállás (a projekt nem módosítható). */
  visit?: Visit;
  /** Új kiszállásnál az alapértelmezett nap. */
  defaultDate: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: VisitFormValues) => void;
  onCancel?: () => void;
}

/** A kiszállás űrlapja: projekt, kollégák, nap, kezdés–vége (TZ_DISPLAY szerint), cím, feladat, állapot. */
export function VisitForm({ timeZone, visit, defaultDate, submitLabel, pending, onSubmit, onCancel }: Props) {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects, enabled: !visit });
  const users = useQuery({ queryKey: ['users'], queryFn: api.users });
  const [projectId, setProjectId] = useState(visit?.projectId ?? '');
  const [assigneeIds, setAssigneeIds] = useState<string[]>(visit?.assignees.map((a) => a.id) ?? []);
  const [date, setDate] = useState(visit ? localDate(visit.startsAt, timeZone) : defaultDate);
  const [start, setStart] = useState(visit ? localTime(visit.startsAt, timeZone) : '08:00');
  const [end, setEnd] = useState(visit ? localTime(visit.endsAt, timeZone) : '10:00');
  const [address, setAddress] = useState(visit?.address ?? '');
  const [task, setTask] = useState(visit?.task ?? '');
  const [status, setStatus] = useState<VisitStatus>(visit?.status ?? 'utemezett');
  const [missingAssignee, setMissingAssignee] = useState(false);

  const id = (name: string) => `visit-${visit?.id ?? 'new'}-${name}`;
  // Az inaktív felhasználók közül csak a már beosztottak látszanak (hogy le lehessen venni őket).
  const candidates = (users.data?.items ?? []).filter((u) => u.active || assigneeIds.includes(u.id));

  const toggle = (userId: string, on: boolean) => {
    setMissingAssignee(false);
    setAssigneeIds((ids) => (on ? [...ids, userId] : ids.filter((i) => i !== userId)));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (assigneeIds.length === 0) {
      setMissingAssignee(true);
      return;
    }
    const startsAt = zonedToUtc(date, start, timeZone);
    // A kezdésnél nem későbbi vége a következő napra esik (éjszakai munka).
    const endsAt = zonedToUtc(end > start ? date : addDays(date, 1), end, timeZone);
    onSubmit({
      projectId,
      assigneeIds,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      address,
      task,
      status,
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor={id('project')}>{t('visits.project')}</Label>
        {visit ? (
          <p id={id('project')} className="text-sm font-medium">
            {visit.projectName}
          </p>
        ) : (
          <Select id={id('project')} required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{t('visits.chooseProject')}</option>
            {projects.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
        <legend className="mb-1.5 text-sm font-medium">{t('visits.assignees')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {candidates.map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={assigneeIds.includes(u.id)}
                onChange={(e) => toggle(u.id, e.target.checked)}
              />
              {u.name} <span className="text-muted-foreground">({coreT(`role.${u.role}`)})</span>
            </label>
          ))}
        </div>
        {missingAssignee && (
          <p role="alert" className="text-sm text-destructive">
            {t('visits.chooseAssignee')}
          </p>
        )}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id('date')}>{t('visits.date')}</Label>
        <Input id={id('date')} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id('start')}>{t('visits.start')}</Label>
          <Input id={id('start')} type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id('end')}>{t('visits.end')}</Label>
          <Input
            id={id('end')}
            type="time"
            required
            value={end}
            title={t('visits.endHint')}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor={id('address')}>{t('visits.address')}</Label>
        <Input id={id('address')} value={address} maxLength={500} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor={id('task')}>{t('visits.task')}</Label>
        <Textarea id={id('task')} rows={3} value={task} maxLength={4000} onChange={(e) => setTask(e.target.value)} />
      </div>
      {visit && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id('status')}>{t('visits.status')}</Label>
          <Select id={id('status')} value={status} onChange={(e) => setStatus(e.target.value as VisitStatus)}>
            {VisitStatus.options.map((s) => (
              <option key={s} value={s}>
                {t(`visits.status.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {coreT('common.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
