import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Keeps one broken component from blanking the whole page.
 *
 * This exists because it happened: a single call to a PayPal SDK method that
 * did not exist threw during render and the demo went completely white, with
 * nothing on screen to say why. On a public demo that a judge opens once,
 * a white page is the worst possible failure.
 */
type Props = { children: ReactNode; fallbackTitle: string; fallbackBody: string; reloadLabel: string };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ui] render failed:', error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <h1 className="text-xl font-semibold">{this.props.fallbackTitle}</h1>
        <p className="mt-2 text-sm text-neutral-600">{this.props.fallbackBody}</p>
        <pre className="mt-4 overflow-x-auto rounded bg-neutral-100 p-3 text-left text-xs text-neutral-700">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          {this.props.reloadLabel}
        </button>
      </div>
    );
  }
}
