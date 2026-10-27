import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import i18n from './i18n';
import './index.css';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    {/* Los textos se leen directo de i18next: el límite de error tiene que
        funcionar incluso si el árbol de React, y con él useTranslation, es
        justamente lo que falló. */}
    <ErrorBoundary
      fallbackTitle={i18n.t('error.title')}
      fallbackBody={i18n.t('error.body')}
      reloadLabel={i18n.t('error.reload')}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
