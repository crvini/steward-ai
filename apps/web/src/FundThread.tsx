/**
 * FundThread — the jaspe bar that carries a fund's identity.
 *
 * The product's promise is that every dollar keeps its thread from the
 * offering to the people it helps, so each designated fund has one colour and
 * one woven pattern that follows it everywhere: the entry screen, the fund
 * cards, the top of a proposal card, the grid.
 *
 * The weave is built from layered repeating gradients whose periods do not
 * divide each other (13px gaps against 37px ticks), which is what keeps it
 * from reading as a mechanical dashed line. It is deterministic: the same
 * fund always draws the same thread.
 */
import type { CSSProperties } from 'react';

export type FundSlug = 'GENERAL' | 'MISSIONS' | 'BENEVOLENCE' | 'BUILDING';

const FUND_COLOR: Record<FundSlug, string> = {
  GENERAL: 'var(--color-fund-tithe)',
  MISSIONS: 'var(--color-fund-missions)',
  BENEVOLENCE: 'var(--color-fund-benevolence)',
  BUILDING: 'var(--color-fund-building)',
};

export function fundColor(slug: string): string {
  return FUND_COLOR[slug as FundSlug] ?? 'var(--color-ink-muted)';
}

/** The woven fill for one fund, as a background shorthand. */
function weave(slug: string): CSSProperties {
  const color = fundColor(slug);
  return {
    backgroundImage: [
      // Dark ticks, sparse.
      `repeating-linear-gradient(90deg, transparent 0 34px, color-mix(in srgb, var(--color-navy-900) 85%, transparent) 34px 37px)`,
      // Fine gaps, frequent.
      `repeating-linear-gradient(90deg, transparent 0 11px, color-mix(in srgb, white 70%, transparent) 11px 13px)`,
      `linear-gradient(${color}, ${color})`,
    ].join(', '),
  };
}

export function FundThread({
  slug,
  /** 0–1. Omit for a solid thread with no goal behind it. */
  progress,
  height = 10,
  rounded = true,
  className = '',
  label,
}: {
  slug: string;
  progress?: number;
  height?: number;
  rounded?: boolean;
  className?: string;
  label?: string;
}) {
  const filled = progress === undefined ? 1 : Math.max(0, Math.min(1, progress));

  return (
    <div
      className={`w-full overflow-hidden bg-line/60 ${rounded ? 'rounded-full' : ''} ${className}`}
      style={{ height }}
      role={progress === undefined ? 'presentation' : 'img'}
      aria-label={progress === undefined ? undefined : label}
    >
      <div
        className={rounded ? 'h-full rounded-full' : 'h-full'}
        style={{ width: `${filled * 100}%`, ...weave(slug) }}
      />
    </div>
  );
}

/**
 * The thin woven strip that sits on top of a card to say which fund it
 * belongs to — used on the proposal card and the confirmation card.
 */
export function FundRibbon({ slug }: { slug: string }) {
  return <FundThread slug={slug} height={8} rounded={false} />;
}
