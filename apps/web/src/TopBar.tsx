/**
 * The top bar from the designs: mark, church, tabs for the role, the sandbox
 * badge and the person you are viewing as.
 *
 * The role switcher stays a plain <select>: a judge has to be able to go from
 * treasurer to pastor and watch the second key land, and a custom dropdown
 * would be one more thing to learn in a two-minute visit.
 */
import { useTranslation } from 'react-i18next';

import type { Role, SessionUser } from './api';
import { LanguageToggle, Logo } from './ui';

export type Tab = { id: string; label: string };

export const TABS_BY_ROLE: Record<Role, string[]> = {
  DONOR: ['give', 'impact', 'gifts'],
  TREASURER: ['books', 'distributions', 'audit', 'impactDrafts', 'aiActivity'],
  PASTOR: ['week', 'approvals', 'audit', 'aiActivity'],
};

export function TopBar({
  churchName,
  user,
  users,
  tab,
  onTab,
  onSwitchUser,
  onSignOut,
}: {
  churchName: string;
  user: SessionUser;
  users: SessionUser[];
  tab: string;
  onTab: (id: string) => void;
  onSwitchUser: (id: string) => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const tabs = TABS_BY_ROLE[user.role];

  return (
    <header className="bg-navy-900 text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
        <span className="flex items-center gap-2">
          <Logo />
          <span className="font-display text-lg font-bold">Steward AI</span>
        </span>
        <span className="text-sm text-white/55">{churchName}</span>

        <nav className="flex flex-wrap gap-1">
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onTab(id)}
              className={`rounded-full px-3.5 py-1.5 text-sm transition ${
                tab === id ? 'bg-white/15 font-semibold text-white' : 'text-white/70 hover:text-white'
              }`}
            >
              {t(`tab.${id}`)}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-gold-500 px-3 py-1 text-xs font-semibold text-navy-900">
            {t('demo.badge')}
          </span>

          <LanguageToggle tone="dark" />

          <select
            value={user.id}
            onChange={(e) => onSwitchUser(e.target.value)}
            aria-label={t('header.viewingAs')}
            className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-white"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id} className="text-navy-900">
                {u.name} · {t(`role.${u.role}`)}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={onSignOut}
            className="rounded-full px-2.5 py-1.5 text-xs text-white/70 hover:text-white"
          >
            {t('header.exit')}
          </button>
        </div>
      </div>
    </header>
  );
}
