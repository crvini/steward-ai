import { useTranslation } from 'react-i18next';

/**
 * Says plainly that no real money moves. Judges are about to type a sandbox
 * login into a checkout; they should not have to guess whether it is real.
 */
export function DemoBanner() {
  const { t } = useTranslation();

  return (
    <div className="bg-amber-50 text-amber-900">
      <p className="mx-auto max-w-5xl px-6 py-2 text-center text-xs font-medium">
        {t('demo.banner')}
      </p>
    </div>
  );
}
