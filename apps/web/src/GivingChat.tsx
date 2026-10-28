/**
 * The donor chat.
 *
 * The agent proposes; it never charges. A proposal lands in the give card
 * above, where the person confirms with the PayPal button — there is no path
 * from a model reply to a payment.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { streamGivingAgent, type GiftProposal } from './api';

type Turn = { role: 'user' | 'assistant'; content: string };

const EXAMPLES_KEY = ['chat.example1', 'chat.example2', 'chat.example3'] as const;

export function GivingChat({ onProposal }: { onProposal: (p: GiftProposal) => void }) {
  const { t } = useTranslation();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const hilo = useRef<HTMLDivElement | null>(null);
  const campo = useRef<HTMLInputElement | null>(null);

  // El hilo crece hacia abajo pero no se movía, así que la respuesta —y la
  // tarjeta de propuesta que viene después— quedaban fuera de vista y
  // parecía que no había pasado nada. Se sigue el final mientras escribe.
  useEffect(() => {
    const caja = hilo.current;
    if (caja) caja.scrollTop = caja.scrollHeight;
  }, [turns]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || streaming) return;

    const history: Turn[] = [...turns, { role: 'user', content: message }];
    setTurns([...history, { role: 'assistant', content: '' }]);
    setDraft('');
    setStreaming(true);
    setError(null);

    abort.current?.abort();
    abort.current = new AbortController();

    let answer = '';
    try {
      for await (const event of streamGivingAgent(history, abort.current.signal)) {
        if (event.type === 'text') {
          answer += event.text;
          // Replace the last turn as the answer grows.
          setTurns([...history, { role: 'assistant', content: answer }]);
        } else if (event.type === 'proposal') {
          onProposal(event.proposal);
          // La tarjeta aparece debajo del chat; sin esto el donante no la ve.
          setTimeout(() => {
            document
              .querySelector('[data-testid="ai-proposal"]')
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 150);
        } else if (event.type === 'error') {
          const [kind, seconds] = event.message.split(':');
          setError(
            kind === 'rate_limited'
              ? t('chat.rateLimited', { minutes: Math.ceil(Number(seconds ?? 0) / 60) })
              : t('chat.failed', { message: event.message }),
          );
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError(t('chat.failed', { message: (e as Error).message }));
      }
    } finally {
      setStreaming(false);
      // El campo se deshabilita mientras el asistente responde, y al
      // deshabilitarse pierde el foco. Sin devolverlo, quien escribe el
      // siguiente mensaje lo teclea en el vacío.
      setTimeout(() => campo.current?.focus(), 0);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {turns.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-neutral-600">{t('chat.intro')}</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES_KEY.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => void send(t(key))}
                className="rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-700"
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={hilo}
          className="flex max-h-72 flex-col gap-2 overflow-y-auto scroll-smooth"
          aria-live="polite"
        >
          {turns.map((turn, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                turn.role === 'user'
                  ? 'self-end bg-neutral-900 text-white'
                  : 'self-start bg-neutral-100 text-neutral-800'
              }`}
            >
              {turn.content || (
                <span className="inline-flex gap-1" aria-label={t('chat.thinking')}>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="flex gap-2"
      >
        <input
          ref={campo}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('chat.placeholder')}
          maxLength={2000}
          disabled={streaming}
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50"
          aria-label={t('chat.placeholder')}
        />
        <button
          type="submit"
          disabled={streaming || !draft.trim()}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {t('chat.send')}
        </button>
      </form>

      <p className="text-xs text-neutral-500">{t('chat.disclaimer')}</p>
    </div>
  );
}
