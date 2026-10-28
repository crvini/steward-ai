/**
 * Entry screen. Two panels: the promise on navy at the left, the three roles
 * at the right. No password and no sign-up — judges review hundreds of
 * projects and anything that asks them to type loses them.
 *
 * The fund threads at the bottom-left are the product's thesis stated before
 * anyone clicks: every fund has its own thread, and you will see it again on
 * every screen.
 */
import { useTranslation } from 'react-i18next';

import type { ChurchResponse, Role, RolesResponse, SessionUser } from './api';
import { formatCents } from './api';
import { FundThread } from './FundThread';
import { LanguageToggle, Logo } from './ui';

const INITIALS_TONE: Record<Role, string> = {
  DONOR: 'bg-fund-missions/10 text-fund-missions',
  TREASURER: 'bg-fund-tithe/10 text-fund-tithe',
  PASTOR: 'bg-fund-benevolence/10 text-fund-benevolence',
};

const initials = (name: string) =>
  name
    .replace(/^Pastor\s+/i, '')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();

export function RoleChooser({
  roles,
  church,
  onPick,
  busyId,
}: {
  roles: RolesResponse;
  church: ChurchResponse | null;
  onPick: (user: SessionUser) => void;
  busyId: string | null;
}) {
  const { t, i18n } = useTranslation();

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Izquierda: la promesa */}
      <div className="flex flex-col justify-between bg-navy-900 px-8 py-10 text-white lg:px-14 lg:py-14">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2.5">
            <Logo />
            <span className="font-display text-xl font-bold">Steward AI</span>
          </span>
          {/* En la izquierda oscura en pantallas grandes; en móvil la columna
              derecha va debajo y este sigue siendo el primero que se ve. */}
          <LanguageToggle tone="dark" />
        </div>

        <div className="my-12 max-w-xl">
          <h1 className="font-display text-4xl leading-[1.08] font-extrabold lg:text-5xl">
            {t('entry.headline')}
          </h1>
          <p className="mt-6 text-base leading-relaxed text-white/70">{t('entry.lede')}</p>
        </div>

        {church && (
          <div>
            <ul className="flex flex-col gap-3">
              {church.funds.map((fund) => (
                <li key={fund.id} className="grid grid-cols-[8rem_1fr_auto] items-center gap-4">
                  <span className="text-sm text-white/70">{fund.name}</span>
                  <FundThread
                    slug={fund.slug}
                    progress={
                      fund.goalCents ? fund.balanceCents / fund.goalCents : undefined
                    }
                    height={12}
                    rounded={false}
                  />
                  <span className="amount text-sm">
                    {formatCents(fund.balanceCents, church.church.currency, i18n.language)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-xs text-white/45">
              {t('entry.footnote', { church: church.church.name })}
            </p>
          </div>
        )}
      </div>

      {/* Derecha: los tres roles */}
      <div className="flex flex-col justify-center bg-surface px-8 py-12 lg:px-14">
        <div className="mx-auto w-full max-w-xl">
          <h2 className="font-display text-3xl font-extrabold">
            {t('entry.title', { church: roles.church.name })}
          </h2>
          <p className="mt-2 text-sm text-ink-muted">{t('entry.subtitle')}</p>

          <div className="mt-7 flex flex-col gap-3">
            {roles.featured.map((user) => (
              <button
                key={user.id}
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => onPick(user)}
                className="group flex items-center gap-4 rounded-2xl border border-line bg-surface p-5 text-left transition hover:border-navy-900 disabled:opacity-60"
              >
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold ${INITIALS_TONE[user.role]}`}
                >
                  {initials(user.name)}
                </span>
                <span className="flex-1">
                  <span className="block font-semibold">
                    {user.name}, {t(`role.${user.role}`).toLowerCase()}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-muted">
                    {t(`entry.role.${user.role}.blurb`)}
                  </span>
                </span>
                <span className="text-ink-muted transition group-hover:translate-x-0.5" aria-hidden>
                  {busyId === user.id ? '…' : '›'}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-7 rounded-2xl bg-gold-500/10 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-navy-900">
              <span aria-hidden>!</span>
              {t('entry.sandboxTitle')}
            </p>
            <p className="mt-1.5 text-sm text-navy-900/80">{t('entry.sandboxBody')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
