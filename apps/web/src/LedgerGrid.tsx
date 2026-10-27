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
import { Badge, Button } from './ui';

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

/**
 * El tema usa los mismos tokens que el resto de la interfaz. AG Grid no lee
 * variables CSS en todos sus parámetros, así que los valores van literales —
 * si cambian en index.css hay que cambiarlos acá también.
 */
const theme = themeQuartz.withParams({
  accentColor: '#f59e0b',
  backgroundColor: '#ffffff',
  foregroundColor: '#0b182a',
  borderColor: '#dde3ea',
  headerBackgroundColor: '#ffffff',
  headerTextColor: '#55657a',
  headerFontWeight: 600,
  rowHoverColor: '#f4f6f9',
  oddRowBackgroundColor: '#ffffff',
  fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif",
  cellFontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif",
  fontSize: 14,
  headerHeight: 44,
  rowHeight: 48,
  wrapperBorderRadius: 16,
  borderRadius: 10,
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

  // Lo que el libro afirma y PayPal no confirma. Es lo primero que un
  // tesorero debería ver al abrir la pantalla, así que va en la cabecera.
  const unconfirmed = rows.filter((r) => r.direction === 'IN' && !r.inPayPal).length;

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
      { field: 'party', headerName: t('grid.party'), flex: 1, minWidth: 170 },
      {
        field: 'type',
        headerName: t('grid.type'),
        width: 120,
        valueFormatter: ({ value }) =>
          value === null ? '—' : t(value === 'MONTHLY' ? 'give.monthly' : 'give.oneTime'),
      },
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
      {
        field: 'inPayPal',
        headerName: t('grid.status'),
        width: 160,
        // Sin esto AG Grid trata el booleano como casilla y pinta un icono
        // sin texto, que no dice nada al que revisa.
        cellDataType: 'text',
        valueGetter: ({ data }) =>
          data ? t(data.inPayPal ? 'grid.confirmed' : 'grid.notInPayPal') : '',
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

  /** The agent's filter, written the way a person would read it. */
  const chips = (() => {
    if (!filter) return [] as string[];
    const out: string[] = [];
    if (filter.fundSlug) out.push(t('grid.chipFund', { fund: filter.fundSlug }));
    if (filter.direction)
      out.push(t(filter.direction === 'IN' ? 'grid.chipIn' : 'grid.chipOut'));
    if (filter.from || filter.to)
      out.push(t('grid.chipDates', { from: filter.from ?? '…', to: filter.to ?? '…' }));
    if (filter.minAmountCents !== undefined)
      out.push(t('grid.chipMin', { amount: (filter.minAmountCents / 100).toFixed(0) }));
    return out;
  })();

  /** CSV of what is on screen, so a treasurer can take it to a spreadsheet. */
  const exportCsv = () => {
    const api_ = gridApi.current;
    if (!api_) return;

    const visible: LedgerRow[] = [];
    api_.forEachNodeAfterFilterAndSort((node) => {
      if (node.data) visible.push(node.data);
    });

    const head = ['date', 'fund', 'direction', 'party', 'type', 'amount', 'fee', 'net', 'reference'];
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      // Comas y comillas rompen el CSV si no se escapan.
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      head.join(','),
      ...visible.map((r) =>
        [r.date, r.fund, r.direction, r.party, r.type ?? '', r.amount, r.fee ?? '', r.net ?? '', r.reference ?? '']
          .map(escape)
          .join(','),
      ),
    ].join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `steward-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const clear = () => {
    setFilter(null);
    setAnswer(null);
    gridApi.current?.setFilterModel(null);
    gridApi.current?.setGridOption('quickFilterText', '');
  };

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold">{t('grid.title')}</h2>
        <div className="flex items-center gap-2">
          {unconfirmed > 0 && (
            <Badge tone="warn">{t('grid.auditorFound', { count: unconfirmed })}</Badge>
          )}
          <Button onClick={exportCsv}>{t('grid.exportCsv')}</Button>
        </div>
      </div>

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
        <div className="rounded-xl bg-navy-900 p-4 text-white">
          <p className="text-sm leading-relaxed">{answer}</p>
          {filter && chips.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/90"
                >
                  {chip}
                </span>
              ))}
              <button
                type="button"
                onClick={clear}
                className="rounded-full px-3 py-1 text-xs font-semibold text-white underline"
              >
                {t('grid.clear')}
              </button>
            </div>
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
          // Las filas que PayPal no confirma se marcan: es lo primero que un
          // tesorero tiene que ver al abrir el libro.
          getRowStyle={({ data }) =>
            data && !data.inPayPal ? { backgroundColor: 'rgba(245, 158, 11, 0.10)' } : undefined
          }
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
