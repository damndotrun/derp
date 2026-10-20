import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t as coreT } from '@/core/i18n.ts';
import { formatFiller } from '../../catalog/shared/format.ts';
import type { CatalogItem } from '../../catalog/shared/schemas.ts';
import { catalogApi, catalogKey } from '../../catalog/web/api.ts';
import { t } from './i18n.ts';

/**
 * Cikkválasztó: keresés a cikktörzsben (`GET /api/catalog/items?q=`), a találat „Felvétel” gombjával tétel lesz. A
 * keresőszöveget a szülő tartja, hogy az oldalpanel (a felmérés anyagtételéből) is beállíthassa.
 */
export function ItemPicker({
  query,
  onQuery,
  onPick,
  inputRef,
}: {
  query: string;
  onQuery: (q: string) => void;
  onPick: (item: CatalogItem) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [q, setQ] = useState(query.trim());
  // Gépelés közben 250 ms szünet után keres.
  useEffect(() => {
    const timer = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useQuery({
    queryKey: [...catalogKey, 'list', q, 'picker'],
    queryFn: () => catalogApi.list({ q, limit: 8 }),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="quote-catalog-search">{t('quotes.catalogSearch')}</Label>
      <Input
        id="quote-catalog-search"
        ref={inputRef}
        type="search"
        value={query}
        placeholder={t('quotes.catalogPlaceholder')}
        onChange={(e) => onQuery(e.target.value)}
      />
      {q && results.isPending && <p className="text-sm">{coreT('common.loading')}</p>}
      {q && results.isError && <p className="text-sm text-destructive">{results.error.message}</p>}
      {q && results.data?.items.length === 0 && <p className="text-sm text-muted-foreground">{t('quotes.catalogNoMatch')}</p>}
      {q && results.data && results.data.items.length > 0 && (
        <ul aria-label={t('quotes.catalogResults')} className="flex flex-col divide-y rounded-md border">
          {results.data.items.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                <span className="block break-words text-sm">{c.name}</span>
                <span className="block text-xs text-muted-foreground">
                  <span className="font-mono">{c.sku}</span> · {formatFiller(c.netUnitPriceFiller)} / {c.unit} · {c.vatRate}%
                </span>
              </span>
              <Button type="button" size="sm" variant="outline" aria-label={`${t('quotes.catalogAdd')}: ${c.name}`} onClick={() => onPick(c)}>
                + {t('quotes.catalogAdd')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
