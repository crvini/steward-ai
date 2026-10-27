/**
 * What the donor came for: not a receipt, but what the money did.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, type ImpactUpdate } from './api';

export function MyImpact() {
  const { t, i18n } = useTranslation();
  const [updates, setUpdates] = useState<ImpactUpdate[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        setUpdates((await api.myImpact()).updates);
      } catch {
        // Nothing to show is a normal state, not an error worth a banner.
      }
    })();
  }, []);

  if (updates.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-xl font-semibold">{t('impact.mine')}</h2>
      <div className="flex flex-col gap-3">
        {updates.map((u) => (
          <article key={u.id} className="rounded-xl border border-green-200 bg-green-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-green-800">{u.fund}</p>
            <p className="mt-1 text-sm text-neutral-800">{u.body}</p>
            {u.sentAt && (
              <p className="mt-2 text-xs text-neutral-500">
                {new Date(u.sentAt).toLocaleDateString(i18n.language)}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
