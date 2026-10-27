import { useTranslation } from 'react-i18next';

export default function App() {
  const { t, i18n } = useTranslation();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6">
      <h1 className="text-4xl font-semibold tracking-tight">{t('app.name')}</h1>
      <p className="text-lg text-neutral-600">{t('app.tagline')}</p>
      <div className="flex gap-2">
        {(['en', 'es'] as const).map((lng) => (
          <button
            key={lng}
            type="button"
            onClick={() => void i18n.changeLanguage(lng)}
            className="rounded border px-3 py-1 text-sm uppercase"
          >
            {lng}
          </button>
        ))}
      </div>
    </main>
  );
}
