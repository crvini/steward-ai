/**
 * The treasurer's ledger, in AG Grid.
 *
 * The question box above it is the point: a treasurer asks in plain language,
 * the agent fills in a typed filter, and the same filter is applied to the
 * grid — so the sentence and the rows on screen always come from one query.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ClientSideRowModelModule,
  ColumnAutoSizeModule,
  DateFilterModule,
  NumberFilterModule,
  QuickFilterModule,
  TextFilterModule,
  ValidationModule,
  themeQuartz,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ValueFormatterParams,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';

import { api, type LedgerFilter, type LedgerRow } from './api';

// Only the features this grid uses. AG Grid v33 is modular; importing the
// everything-bundle would roughly triple the download for no benefit.
const MODULES = [
  ClientSideRowModelModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  QuickFilterModule,
  ColumnAutoSizeModule,
  ...(import.meta.env.DEV ? [ValidationModule] : []),
];

const theme = themeQuartz.withParams({
  accentColor: '#171717',
  headerFontWeight: 600,
  borderColor: '#e5e5e5',
  rowHoverColor: '#fafafa',
});

export function LedgerGrid({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [filter, setFilter] = useState<LedgerFilter | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gridApi = useRef<GridApi<LedgerRow> | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setRows((await api.ledger()).rows);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const money = useCallback(
    ({ value }: ValueFormatterParams<LedgerRow>) =>
      typeof value === 'number'
        ? value.toLocaleString(locale, { style: 'currency', currency: 'USD' })
        : '',
    [locale],
  );

  const columns = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: 'date', headerName: t('grid.date'), filter: 'agDateColumnFilter', width: 120 },
      { field: 'fund', headerName: t('grid.fund'), width: 150 },
      {
        field: 'direction',
        headerName: t('grid.direction'),
        width: 110,
        valueFormatter: ({ value }) => t(`grid.${value === 'IN' ? 'in' : 'out'}`),
      },
      { field: 'party', headerName: t('grid.party'), flex: 1, minWidth: 180 },
      {
        field: 'amount',
        headerName: t('grid.amount'),
        type: 'rightAligned',
        filter: 'agNumberColumnFilter',
        valueFormatter: money,
        width: 130,
      },
      {
        field: 'fee',
        headerName: t('grid.fee'),
        type: 'rightAligned',
        valueFormatter: money,
        width: 110,
      },
      {
        field: 'net',
        headerName: t('grid.net'),
        type: 'rightAligned',
        valueFormatter: money,
        width: 120,
      },
    ],
    [t, money],
  );

  /** Applies the agent's typed filter to the grid. */
  const applyFilter = useCallback(async (f: LedgerFilter) => {
    const api_ = gridApi.current;
    if (!api_) return;

    await api_.setFilterModel({
      ...(f.fundSlug
        ? { fund: null } // the grid filters on the display name, set below
        : {}),
      ...(f.direction
        ? { direction: { filterType: 'text', type: 'equals', filter: f.direction } }
        : {}),
      ...(f.from || f.to
        ? {
            date: {
              filterType: 'date',
              type: f.from && f.to ? 'inRange' : f.from ? 'greaterThanOrEqual' : 'lessThanOrEqual',
              dateFrom: f.from ?? f.to ?? null,
              dateTo: f.to ?? null,
            },
          }
        : {}),
      ...(f.minAmountCents !== undefined
        ? {
            amount: {
              filterType: 'number',
              type: 'greaterThanOrEqual',
              filter: f.minAmountCents / 100,
            },
          }
        : {}),
    });

    // Fund comes back as a slug but the column shows the name, so it goes
    // through the quick filter instead of a column filter.
    api_.setGridOption('quickFilterText', f.fundSlug ?? '');
  }, []);

  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;

    setAsking(true);
    setError(null);
    setAnswer(null);
    try {
      const result = await api.askLedger(q);
      setAnswer(result.answer);
      setFilter(result.filter);
      await applyFilter(result.filter);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
    }
  };

  const clear = () => {
    setFilter(null);
    setAnswer(null);
    gridApi.current?.setFilterModel(null);
    gridApi.current?.setGridOption('quickFilterText', '');
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{t('grid.title')}</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('grid.askPlaceholder')}
          maxLength={500}
          className="min-w-[18rem] flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
          aria-label={t('grid.askPlaceholder')}
        />
        <button
          type="submit"
          disabled={asking || !question.trim()}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {asking ? t('grid.asking') : t('grid.ask')}
        </button>
        {filter && (
          <button
            type="button"
            onClick={clear}
            className="rounded border border-neutral-300 px-3 py-2 text-sm"
          >
            {t('grid.clear')}
          </button>
        )}
      </form>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {answer && (
        <div className="rounded-lg bg-blue-50 p-3">
          <p className="text-sm text-blue-900">{answer}</p>
          {filter && Object.values(filter).some(Boolean) && (
            <p className="mt-1 text-xs text-blue-700">
              {t('grid.filterApplied')}:{' '}
              {Object.entries(filter)
                .filter(([, v]) => v !== undefined && v !== null)
                .map(([k, v]) => `${k}=${String(v)}`)
                .join(' · ')}
            </p>
          )}
        </div>
      )}

      <div style={{ height: 460 }}>
        <AgGridReact<LedgerRow>
          theme={theme}
          modules={MODULES}
          rowData={rows}
          columnDefs={columns}
          defaultColDef={{ filter: true, sortable: true, resizable: true }}
          onGridReady={(e: GridReadyEvent<LedgerRow>) => {
            gridApi.current = e.api;
          }}
          pagination
          paginationPageSize={25}
        />
      </div>
    </section>
  );
}
