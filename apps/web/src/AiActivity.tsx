/**
 * Every move the AI made and every signature that followed it.
 *
 * This tab is the argument of the product made inspectable. A judge should be
 * able to read it top to bottom and confirm that nothing was paid without a
 * model proposing, rules checking and two different people signing.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, type ActivityEntry } from './api';
import { Badge, Card } from './ui';

export function AiActivity() {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        setEntries((await api.activity()).entries);
      } catch {
        // Leer la bitácora nunca debe tumbar la pantalla.
      }
    })();
  }, []);

  return (
    <Card className="p-6">
      <h2 className="font-display text-xl font-bold">{t('activity.title')}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t('activity.subtitle')}</p>

      {entries.length === 0 && (
        <p className="mt-4 text-sm text-ink-muted">{t('activity.empty')}</p>
      )}

      <ol className="mt-5 flex flex-col gap-0">
        {entries.map((entry) => (
          <li key={entry.id} className="flex gap-3 border-b border-line py-3 last:border-0">
            <span className="w-32 shrink-0 text-xs text-ink-muted">
              {new Date(entry.at).toLocaleString(i18n.language, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span className="flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{
                    // i18next parte la ruta por puntos, así que una acción
                    // como "ai.gift_proposed" nunca resolvería; se normaliza.
                    t(`activity.action.${entry.action.replace(/\./g, '_')}`, {
                      defaultValue: entry.action,
                    })
                  }</span>
                {entry.byAi ? (
                  <Badge tone="warn">{t('activity.byAi')}</Badge>
                ) : (
                  <Badge tone="good">{t('activity.byPerson')}</Badge>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-ink-muted">{entry.actor}</span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
