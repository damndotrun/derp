import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatFiller, searchKey } from '../shared/format.ts';
import type { ImportPreview } from '../shared/schemas.ts';
import { ImportPreviewView } from './ImportCard.tsx';

const values = { sku: 'VENT-125', name: 'Csőventilátor Ø125 mm', unit: 'db', netUnitPriceFiller: 4_850_000, vatRate: 27 as const, supplier: 'Nagyker' };

describe('CSV-import előnézet', () => {
  it('összesít, a hibás sort a sorszámával és okával mutatja, a módosuló mezőt kiemeli', () => {
    const preview: ImportPreview = {
      fileError: null,
      encoding: 'Windows-1250',
      delimiter: ';',
      summary: { new: 1, changed: 1, unchanged: 0, error: 1 },
      rows: [
        { line: 4, status: 'error', raw: ['H-1', 'Rossz ár', 'db', 'sok', '27'], errors: ['A nettó egységár nem szám: „sok”'] },
        { line: 2, status: 'new', values },
        { line: 3, status: 'changed', values: { ...values, sku: 'BIL-125', name: 'Csőbilincs', netUnitPriceFiller: 41_250 }, changed: ['netUnitPriceFiller'] },
      ],
      omitted: 0,
    };
    render(<ImportPreviewView preview={preview} fileName="arlista.csv" />);
    expect(screen.getByText('arlista.csv · Windows-1250 · elválasztó: ;')).toBeInTheDocument();
    const summary = screen.getByRole('list', { name: 'Összesítés' });
    expect(within(summary).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1 új', '1 módosul', '0 változatlan', '1 hibás sor']);
    const rows = within(screen.getByRole('table', { name: 'Előnézet' })).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('4Hibás');
    expect(rows[0]).toHaveTextContent('A nettó egységár nem szám: „sok”');
    expect(rows[0]).toHaveTextContent('H-1 | Rossz ár | db | sok | 27');
    expect(rows[1]).toHaveTextContent(/2ÚjVENT-125Csőventilátor Ø125 mmdb48\s500\sFt27%Nagyker/);
    const price = within(rows[2]!).getByText(/412,50\sFt/);
    expect(price).toHaveClass('font-semibold');
    expect(within(rows[2]!).getByText('Csőbilincs')).not.toHaveClass('font-semibold');
  });

  it('a fájl hibáját jelzi, sorok nélkül', () => {
    render(
      <ImportPreviewView
        preview={{ fileError: 'Hiányzó oszlop a fejlécben: Egység', encoding: 'UTF-8', delimiter: ';', summary: { new: 0, changed: 0, unchanged: 0, error: 0 }, rows: [], omitted: 0 }}
        fileName="x.csv"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Hiányzó oszlop a fejlécben: Egység');
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('formázás és keresőkulcs', () => {
  it('az ár forintban, fillérrel csak ha van', () => {
    expect(formatFiller(4_850_000)).toMatch(/^48\s500\sFt$/);
    expect(formatFiller(1250)).toMatch(/^12,50\sFt$/);
    expect(formatFiller(0)).toMatch(/^0\sFt$/);
  });

  it('a keresőkulcs kisbetűs és ékezet nélküli', () => {
    expect(searchKey('  Hővisszanyerős   SZELLŐZTETŐ ')).toBe('hovisszanyeros szellozteto');
  });
});
