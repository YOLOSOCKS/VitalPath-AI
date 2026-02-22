import React from 'react';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

interface ConfidenceBadgeProps {
  /** Confidence score 0–100 (or 0–1 if asDecimal) */
  value: number;
  /** If true, value is 0–1; otherwise 0–100 */
  asDecimal?: boolean;
  /** Optional label override */
  label?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const getLevel = (pct: number): ConfidenceLevel => {
  if (pct >= 70) return 'high';
  if (pct >= 40) return 'medium';
  return 'low';
};

const levelStyles: Record<ConfidenceLevel, { bg: string; text: string; border: string }> = {
  high: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/50' },
  medium: { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/50' },
  low: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/50' },
};

const sizeClasses = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-1 text-xs',
  lg: 'px-3 py-1.5 text-sm',
};

export default function ConfidenceBadge({ value, asDecimal = false, label, size = 'md', className = '' }: ConfidenceBadgeProps) {
  const pct = asDecimal ? Math.round(value * 100) : Math.round(value);
  const clamped = Math.max(0, Math.min(100, pct));
  const level = getLevel(clamped);
  const styles = levelStyles[level];

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono uppercase tracking-wider rounded border ${styles.bg} ${styles.text} ${styles.border} ${sizeClasses[size]} ${className}`}
      title={`Confidence: ${clamped}%`}
    >
      {label ?? `${clamped}%`}
    </span>
  );
}
