import { useQuery } from '@tanstack/react-query';
import { Select } from '@/components/ui/select';
import { api } from './api.ts';
import { t } from './i18n.ts';

export const clientsKey = ['clients'] as const;

/** Ügyfélválasztó (üres érték = nincs ügyfél). */
export function ClientSelect({ id, value, onChange }: { id: string; value: string; onChange: (id: string) => void }) {
  const clients = useQuery({ queryKey: clientsKey, queryFn: api.clients });
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('projects.noClient')}</option>
      {clients.data?.items.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}
