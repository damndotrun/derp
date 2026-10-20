import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { quoteTotals } from '../shared/money.ts';
import { Totals } from './Totals.tsx';

describe('Totals', () => {
  it('ÁFA-kulcsonkénti bontás, kerekítés és a forintra kerekített végösszeg', () => {
    render(
      <Totals
        totals={quoteTotals([
          { quantity: 3, netUnitPriceFiller: 215_050, vatRate: 27, discountPercent: 0 },
          { quantity: 1, netUnitPriceFiller: 1_000_000, vatRate: 5, discountPercent: 0 },
        ])}
      />,
    );
    // A magyar formátum a négyjegyű számot nem csoportosítja („6451,50 Ft”).
    const rows = within(screen.getByRole('table', { name: 'ÁFA-kulcsonként' })).getAllByRole('row');
    expect(rows.map((r) => r.textContent?.replace(/\s+/g, ' '))).toEqual([
      'ÁFA-kulcsNettóÁFABruttó',
      '27%6451,50 Ft1741,91 Ft8193,41 Ft',
      '5%10 000 Ft500 Ft10 500 Ft',
    ]);
    expect(screen.getByRole('status', { name: 'Végösszeg' }).textContent?.replace(/\s+/g, ' ')).toBe('18 693 Ft');
    expect(screen.getByText('Kerekítés')).toBeInTheDocument();
  });
});
