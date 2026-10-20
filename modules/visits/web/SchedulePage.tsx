import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api } from '@/core/api.ts';
import { t as coreT } from '@/core/i18n.ts';
import { isOffice, useSession, useUser } from '@/core/session.ts';
import { cn } from '@/lib/utils';
import type { Visit } from '../shared/schemas.ts';
import { addDays, localDate, localRange, weekStart } from '../shared/time.ts';
import { useLiveVisits, visitsApi, visitsKey } from './api.ts';
import { IcsCard } from './IcsCard.tsx';
import { t } from './i18n.ts';
import { colleagueRows, dayLabel, timeRange, viewDays } from './layout.ts';
import { ConflictBadge, ConflictNote, StatusBadge } from './parts.tsx';
import { VisitForm, type VisitFormValues } from './VisitForm.tsx';

type Mode = 'day' | 'week';

/** Napi/heti nézet kollégánként; az iroda innen vesz fel, módosít és töröl kiszállást. */
export function SchedulePage() {
  const user = useUser();
  const office = isOffice(user);
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const today = localDate(new Date(), tz);
  const [mode, setMode] = useState<Mode>('week');
  const [anchor, setAnchor] = useState(today);
  const [userId, setUserId] = useState('');
  const [editing, setEditing] = useState<Visit | null>(null);
  useLiveVisits();

  const first = mode === 'week' ? weekStart(anchor) : anchor;
  const days = viewDays(first, mode === 'week' ? 7 : 1);
  const range = localRange(first, days.length, tz);
  const query = { from: range.from.toISOString(), to: range.to.toISOString(), userId: userId || undefined };
  const visits = useQuery({ queryKey: [...visitsKey, 'list', query], queryFn: () => visitsApi.list(query) });
  const users = useQuery({ queryKey: ['users'], queryFn: api.users, enabled: office });
  const rows = colleagueRows(visits.data?.items ?? [], days, tz, userId || undefined);
  const step = (dir: 1 | -1) => setAnchor(addDays(anchor, dir * days.length));

  const period = days.length === 1 ? dayLabel(days[0]!) : `${dayLabel(days[0]!)} – ${dayLabel(days.at(-1)!)}`;
  const onPick = office ? (v: Visit) => setEditing(v) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('visits.title')}</h1>

      {office && !editing && <NewVisit timeZone={tz} defaultDate={anchor} onScheduled={(v) => setAnchor(localDate(v.startsAt, tz))} />}
      {office && editing && <EditVisit key={editing.id} visit={editing} timeZone={tz} onDone={() => setEditing(null)} />}

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t('visits.view.label')} className="flex">
              {(['day', 'week'] as const).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={mode === m ? 'default' : 'outline'}
                  aria-pressed={mode === m}
                  className={m === 'day' ? 'rounded-r-none' : 'rounded-l-none'}
                  onClick={() => setMode(m)}
                >
                  {t(`visits.view.${m}`)}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="outline" aria-label={t('visits.prev')} onClick={() => step(-1)}>
              ‹
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAnchor(today)}>
              {t('visits.today')}
            </Button>
            <Button size="sm" variant="outline" aria-label={t('visits.next')} onClick={() => step(1)}>
              ›
            </Button>
            <CardTitle className="ml-1 text-base">{period}</CardTitle>
          </div>
          {office && (
            <div className="flex max-w-xs flex-col gap-1.5">
              <Label htmlFor="visits-colleague">{t('visits.colleagueFilter')}</Label>
              <Select id="visits-colleague" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">{t('visits.allColleagues')}</option>
                {users.data?.items
                  .filter((u) => u.active)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </Select>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {visits.isPending && <p>{coreT('common.loading')}</p>}
          {visits.isError && <p className="text-destructive">{visits.error.message}</p>}
          {visits.isSuccess && rows.length === 0 && <p className="text-muted-foreground">{t('visits.empty')}</p>}
          {rows.length > 0 && (
            <>
              <ScheduleTable rows={rows} days={days} timeZone={tz} mode={mode} onPick={onPick} />
              <DayList rows={rows} days={days} timeZone={tz} onPick={onPick} />
            </>
          )}
        </CardContent>
      </Card>

      <IcsCard />
    </div>
  );
}

interface ViewProps {
  rows: ReturnType<typeof colleagueRows>;
  days: string[];
  timeZone: string;
  onPick?: (v: Visit) => void;
}

/** Asztali nézet: sorok a kollégák, oszlopok a napok. */
function ScheduleTable({ rows, days, timeZone, mode, onPick }: ViewProps & { mode: Mode }) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table aria-label={t(mode === 'week' ? 'visits.weekTable' : 'visits.dayTable')} className="w-full table-fixed border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="w-40 border-b p-2 text-left font-medium">
              {t('visits.colleague')}
            </th>
            {days.map((d) => (
              <th key={d} scope="col" className="border-b p-2 text-left font-medium">
                {dayLabel(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.colleague.id} className="align-top">
              <th scope="row" className="border-b p-2 text-left font-medium">
                {row.colleague.name}
              </th>
              {row.cells.map((cell, i) => (
                <td key={days[i]} className="border-b p-1">
                  <div className="flex flex-col gap-1">
                    {cell.map((v) => (
                      <VisitChip key={v.id} visit={v} timeZone={timeZone} onPick={onPick} />
                    ))}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Telefonos nézet: naponként, azon belül kollégánként. */
function DayList({ rows, days, timeZone, onPick }: ViewProps) {
  return (
    <div className="flex flex-col gap-4 md:hidden">
      {days.map((d, i) => {
        const people = rows.filter((r) => r.cells[i]!.length > 0);
        if (people.length === 0) return null;
        return (
          <section key={d} aria-label={dayLabel(d)}>
            <h3 className="mb-2 text-sm font-semibold">{dayLabel(d)}</h3>
            <div className="flex flex-col gap-3">
              {people.map((r) => (
                <div key={r.colleague.id}>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{r.colleague.name}</p>
                  <div className="flex flex-col gap-1">
                    {r.cells[i]!.map((v) => (
                      <VisitChip key={v.id} visit={v} timeZone={timeZone} onPick={onPick} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function VisitChip({ visit, timeZone, onPick }: { visit: Visit; timeZone: string; onPick?: (v: Visit) => void }) {
  const conflict = visit.conflicts.length > 0;
  const body = (
    <>
      <span className="flex flex-wrap items-center gap-1">
        <span className="whitespace-nowrap font-medium tabular-nums">{timeRange(visit, timeZone, t('visits.overnight'))}</span>
        {visit.status !== 'utemezett' && <StatusBadge status={visit.status} />}
        {conflict && <ConflictBadge visit={visit} timeZone={timeZone} />}
      </span>
      <span className="block truncate">{visit.projectName}</span>
      {visit.address && <span className="block truncate text-xs text-muted-foreground">{visit.address}</span>}
    </>
  );
  const className = cn(
    'block w-full rounded-md border p-2 text-left text-sm',
    conflict ? 'border-destructive' : 'border-border',
    visit.status === 'elmaradt' && 'opacity-60',
  );
  return (
    <article aria-label={`${visit.projectName} ${timeRange(visit, timeZone, t('visits.overnight'))}`}>
      {onPick ? (
        <button type="button" className={cn(className, 'hover:bg-accent')} onClick={() => onPick(visit)}>
          {body}
        </button>
      ) : (
        <Link to={`/projects/${visit.projectId}`} className={cn(className, 'hover:bg-accent')}>
          {body}
        </Link>
      )}
    </article>
  );
}

function NewVisit({ timeZone, defaultDate, onScheduled }: { timeZone: string; defaultDate: string; onScheduled: (v: Visit) => void }) {
  const queryClient = useQueryClient();
  const [formKey, setFormKey] = useState(0);
  const create = useMutation({
    mutationFn: (v: VisitFormValues) => visitsApi.create(v),
    onSuccess: async (v) => {
      await queryClient.invalidateQueries({ queryKey: visitsKey });
      setFormKey((k) => k + 1);
      onScheduled(v);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('visits.new')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <VisitForm
          key={formKey}
          timeZone={timeZone}
          defaultDate={defaultDate}
          submitLabel={t('visits.schedule')}
          pending={create.isPending}
          onSubmit={(v) => create.mutate(v)}
        />
        {create.isSuccess && (
          <div role="status" className="text-sm">
            <p>{t('visits.scheduled')}</p>
            <ConflictNote visit={create.data} timeZone={timeZone} />
          </div>
        )}
        {create.error && (
          <p role="alert" className="text-sm text-destructive">
            {create.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function EditVisit({ visit, timeZone, onDone }: { visit: Visit; timeZone: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: visitsKey });
  const update = useMutation({
    mutationFn: ({ projectId: _p, ...v }: VisitFormValues) => visitsApi.update(visit.id, { version: visit.version, ...v }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: () => visitsApi.remove(visit.id),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const error = update.error ?? remove.error;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('visits.edit')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ConflictNote visit={visit} timeZone={timeZone} />
        <VisitForm
          visit={visit}
          timeZone={timeZone}
          defaultDate={localDate(visit.startsAt, timeZone)}
          submitLabel={coreT('common.save')}
          pending={update.isPending}
          onSubmit={(v) => update.mutate(v)}
          onCancel={onDone}
        />
        <div>
          <Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {t('visits.delete')}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
