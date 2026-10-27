/**
 * Entry screen. Judges review hundreds of projects — if signing in takes more
 * than a few seconds they move on. One click per role, no password, no sign-up.
 */
import { useTranslation } from 'react-i18next';

import type { RolesResponse, Role, SessionUser } from './api';

const ROLE_ART: Record<Role, { emoji: string; ring: string }> = {
  DONOR: { emoji: '🙌', ring: 'hover:border-emerald-400 focus-visible:border-emerald-400' },
  TREASURER: { emoji: '📊', ring: 'hover:border-sky-400 focus-visible:border-sky-400' },
  PASTOR: { emoji: '🕊️', ring: 'hover:border-violet-400 focus-visible:border-violet-400' },
};

export function RoleChooser({
  roles,
  onPick,
  busyId,
}: {
  roles: RolesResponse;
  onPick: (user: SessionUser) => void;
  busyId: string | null;
}) {
  const { t } = useTranslation();

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-10 px-6 py-16">
      <header className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">{t('app.name')}</h1>
        <p className="mx-auto mt-3 max-w-2xl text-lg text-neutral-600">{t('app.tagline')}</p>
        <p className="mt-4 text-sm text-neutral-500">
          {t('entry.subtitle', { church: roles.church.name })}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {roles.featured.map((user) => {
          const art = ROLE_ART[user.role];
          const busy = busyId === user.id;
          return (
            <button
              key={user.id}
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => onPick(user)}
              className={`flex flex-col items-start gap-2 rounded-xl border-2 border-neutral-200 bg-white p-6 text-left shadow-sm transition disabled:opacity-60 ${art.ring}`}
            >
              <span aria-hidden="true" className="text-3xl">
                {art.emoji}
              </span>
              <span className="text-base font-semibold">{t(`entry.role.${user.role}.title`)}</span>
              <span className="text-sm text-neutral-600">
                {t(`entry.role.${user.role}.blurb`)}
              </span>
              <span className="mt-2 text-sm font-medium text-neutral-900">{user.name}</span>
              <span className="text-xs text-neutral-500">
                {busy ? t('entry.entering') : t('entry.cta')}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-center text-xs text-neutral-500">{t('entry.noPassword')}</p>
    </main>
  );
}
