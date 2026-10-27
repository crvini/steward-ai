/**
 * The treasurer reads every note before a donor does, and may rewrite it.
 *
 * The AI drafts; a person decides whether it is true enough to send. That
 * order is the whole point, so the editor is a plain textarea and the
 * treasurer's words always win.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, type DistributionRow, type ImpactUpdate } from './api';

export function ImpactReview({ distributions }: { distributions: DistributionRow[] }) {
  const { t } = useTranslation();
  const [updates, setUpdates] = useState<ImpactUpdate[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUpdates((await api.impactReview()).updates);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const executed = distributions.filter((d) => d.status === 'EXECUTED');
  const drafts = updates.filter((u) => u.status === 'DRAFT');

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{t('impact.review')}</h2>
          <p className="text-sm text-neutral-600">{t('impact.reviewSubtitle')}</p>
        </div>

        {executed.length > 0 && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void (async () => {
                setBusy('draft');
                setError(null);
                try {
                  await api.draftImpact(executed[0]!.id);
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(null);
                }
              })()
            }
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === 'draft' ? t('impact.drafting') : t('impact.draft')}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {drafts.length === 0 && <p className="text-sm text-neutral-500">{t('impact.noDrafts')}</p>}

      {drafts.map((u) => (
        <article key={u.id} className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs text-neutral-500">
            {u.donor} · {u.fund} · {u.locale}
          </p>
          <textarea
            value={edits[u.id] ?? u.body}
            onChange={(e) => setEdits({ ...edits, [u.id]: e.target.value })}
            rows={3}
            className="mt-2 w-full rounded border border-neutral-300 p-2 text-sm"
          />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void (async () => {
                setBusy(u.id);
                try {
                  await api.approveImpact(u.id, edits[u.id]);
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(null);
                }
              })()
            }
            className="mt-2 rounded-lg bg-green-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {edits[u.id] !== undefined ? t('impact.approveEdited') : t('impact.approve')}
          </button>
        </article>
      ))}
    </section>
  );
}
