/**
 * What sits beside the giving card: where the church needs help, and what
 * this person already gives every month.
 *
 * The needs panel is ordered by how far each fund is from its goal, not by
 * size. A fund at 30% of a small goal needs help more than one at 90% of a
 * large one, and a donor deciding where to give is better served by that.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, formatCents, type ChurchResponse, type SubscriptionRow } from './api';
import { FundThread } from './FundThread';
import { Button, Card } from './ui';

export function MemberSidebar({ church }: { church: ChurchResponse }) {
  const { t, i18n } = useTranslation();
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const money = (c: number) => formatCents(c, church.church.currency, i18n.language);

  const load = useCallback(async () => {
    try {
      setSubs((await api.subscriptions()).subscriptions);
    } catch {
      // Un donante sin suscripciones no es un error.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const withGoal = church.funds
    .filter((f) => f.goalCents !== null)
    .sort(
      (a, b) => a.balanceCents / (a.goalCents ?? 1) - b.balanceCents / (b.goalCents ?? 1),
    );
  const withoutGoal = church.funds.filter((f) => f.goalCents === null);

  const active = subs.filter((s) => s.status === 'ACTIVE' || s.status === 'COMPLETED');

  return (
    <aside className="flex flex-col gap-4">
      <Card className="p-5">
        <h3 className="font-display text-lg font-bold">{t('member.needsTitle')}</h3>

        <ul className="mt-4 flex flex-col gap-4">
          {[...withGoal, ...withoutGoal].map((fund) => (
            <li key={fund.id}>
              <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-sm font-semibold">{fund.name}</span>
                <span className="amount text-sm whitespace-nowrap">
                  {fund.goalCents
                    ? `${money(fund.balanceCents)} / ${money(fund.goalCents)}`
                    : money(fund.balanceCents)}
                </span>
              </span>
              <FundThread
                slug={fund.slug}
                progress={fund.goalCents ? fund.balanceCents / fund.goalCents : undefined}
                className="mt-1.5"
                label={fund.name}
              />
            </li>
          ))}
        </ul>
      </Card>

      {active.length > 0 && (
        <Card className="p-5">
          <h3 className="font-display text-lg font-bold">{t('member.recurringTitle')}</h3>

          <ul className="mt-4 flex flex-col gap-4">
            {active.map((sub) => (
              <li key={sub.id} className="border-b border-line pb-4 last:border-0 last:pb-0">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{sub.fund}</span>
                  <span className="amount text-base">{money(sub.amountCents)}</span>
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {t('member.recurringEveryMonth')}
                  {sub.chargesSoFar > 0 &&
                    ` · ${t('member.givenSoFar', { amount: money(sub.givenSoFarCents) })}`}
                </span>
                {sub.subscriptionId && (
                  <Button
                    variant="quiet"
                    className="mt-2 px-0 text-xs"
                    disabled={busy !== null}
                    onClick={() =>
                      void (async () => {
                        setBusy(sub.id);
                        try {
                          await api.cancelSubscription(sub.subscriptionId!);
                          await load();
                        } finally {
                          setBusy(null);
                        }
                      })()
                    }
                  >
                    {busy === sub.id ? t('member.cancelling') : t('member.cancel')}
                  </Button>
                )}
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-ink-muted">{t('member.recurringNote')}</p>
        </Card>
      )}
    </aside>
  );
}
