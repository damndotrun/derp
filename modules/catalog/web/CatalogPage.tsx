import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fill, t as coreT } from '@/core/i18n.ts';
import { useModules } from '@/core/modules.ts';
import { formatFiller } from '../shared/format.ts';
import { CATALOG_PAGE_SIZE } from '../shared/schemas.ts';
import { catalogApi, catalogKey } from './api.ts';
import { t } from './i18n.ts';
import { ImportCard } from './ImportCard.tsx';

/** Cikktörzs: keresés (a `?q=` az URL-ben), lapozható lista, az irodának CSV-import. */
export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const canManage = (useModules().data?.items.find((m) => m.id === 'catalog')?.permissions ?? []).includes('catalog.manage');

  // Gépelés közben 250 ms szünet után keres.
  useEffect(() => {
    const next = input.trim();
    if (next === q) return;
    const timer = setTimeout(() => setParams(next ? { q: next } : {}, { replace: true }), 250);
    return () => clearTimeout(timer);
  }, [input, q, setParams]);

  const list = useInfiniteQuery({
    queryKey: [...catalogKey, 'list', q],
    queryFn: ({ pageParam }) => catalogApi.list({ q, offset: pageParam, limit: CATALOG_PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('catalog.title')}</h1>
      {canManage && <ImportCard />}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-4 sm:pt-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-search">{t('catalog.search')}</Label>
            <Input
              id="catalog-search"
              type="search"
              value={input}
              placeholder={t('catalog.searchPlaceholder')}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
          {list.isPending && <p>{coreT('common.loading')}</p>}
          {list.isError && <p className="text-destructive">{list.error.message}</p>}
          {list.isSuccess && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {total === 0 ? t(q ? 'catalog.noMatch' : 'catalog.empty') : fill(t('catalog.count'), { count: total })}
            </p>
          )}
          {items.length > 0 && (
            <table aria-label={t('catalog.table')} className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="hidden p-2 font-medium sm:table-cell">{t('catalog.field.sku')}</th>
                  <th scope="col" className="p-2 font-medium">{t('catalog.field.name')}</th>
                  <th scope="col" className="hidden p-2 font-medium sm:table-cell">{t('catalog.field.unit')}</th>
                  <th scope="col" className="p-2 text-right font-medium">{t('catalog.field.netUnitPriceFiller')}</th>
                  <th scope="col" className="hidden p-2 text-right font-medium sm:table-cell">{t('catalog.field.vatRate')}</th>
                  <th scope="col" className="hidden p-2 font-medium md:table-cell">{t('catalog.field.supplier')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b align-top">
                    <td className="hidden p-2 font-mono text-xs sm:table-cell">{i.sku}</td>
                    <td className="p-2">
                      <span>{i.name}</span>
                      {/* Telefonon a rejtett oszlopok tartalma a megnevezés alatt. */}
                      <span className="block text-xs text-muted-foreground sm:hidden">
                        <span className="font-mono">{i.sku}</span>
                        {i.supplier && ` · ${i.supplier}`}
                      </span>
                      {i.supplier && <span className="hidden text-xs text-muted-foreground sm:block md:hidden">{i.supplier}</span>}
                    </td>
                    <td className="hidden p-2 sm:table-cell">{i.unit}</td>
                    <td className="whitespace-nowrap p-2 text-right tabular-nums">
                      {formatFiller(i.netUnitPriceFiller)}
                      <span className="block text-xs text-muted-foreground sm:hidden">
                        / {i.unit} · {i.vatRate}%
                      </span>
                    </td>
                    <td className="hidden p-2 text-right tabular-nums sm:table-cell">{i.vatRate}%</td>
                    <td className="hidden p-2 md:table-cell">{i.supplier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {list.hasNextPage && (
            <Button variant="outline" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {t('catalog.more')}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
