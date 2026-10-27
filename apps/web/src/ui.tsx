/**
 * The few primitives every screen shares.
 *
 * `Button` enforces the rule from the design: **one gold button per screen**.
 * Gold means "this is the thing that moves money or finishes the task", and
 * text on gold is always navy-900 — amber with white text fails contrast and
 * stops looking like a decision.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'gold' | 'navy' | 'outline' | 'quiet' | 'danger';

const VARIANTS: Record<Variant, string> = {
  gold: 'bg-gold-500 text-navy-900 hover:bg-gold-500/90 font-semibold',
  navy: 'bg-navy-900 text-white hover:bg-navy-700',
  outline: 'border border-line bg-surface text-navy-900 hover:bg-surface-alt',
  quiet: 'text-ink-muted hover:bg-surface-alt',
  danger: 'border border-line bg-surface text-fund-missions hover:bg-fund-missions/5',
};

export function Button({
  variant = 'outline',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode }) {
  return (
    <button
      {...rest}
      className={`rounded-xl px-4 py-2.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-surface ${className}`}>
      {children}
    </section>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'gold';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-surface-alt text-ink-muted',
    good: 'bg-fund-benevolence/10 text-fund-benevolence',
    warn: 'bg-gold-500/15 text-navy-900',
    bad: 'bg-fund-missions/10 text-fund-missions',
    gold: 'bg-gold-500 text-navy-900 font-semibold',
  } as const;

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** The three-stripe mark from the designs. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex flex-col gap-[3px] ${className}`} aria-hidden="true">
      <span className="h-[3px] w-5 rounded-full bg-fund-tithe" />
      <span className="h-[3px] w-5 rounded-full bg-fund-missions" />
      <span className="h-[3px] w-5 rounded-full bg-fund-benevolence" />
    </span>
  );
}
