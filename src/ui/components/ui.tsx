// Small building blocks shared by every panel.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { EMBLEM_PATHS } from '../../render/aircraft/emblems';
import type { Livery } from '../../sim/types';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ───────────── Logo ─────────────

/** Relative luminance 0..1 of a hex colour. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** An airline's badge: its brand colour with the tail emblem. */
export function Logo({ livery, size = 28 }: { livery: Livery; size?: number }) {
  const ink = luminance(livery.primary) > 0.55 ? '#0b1220' : '#ffffff';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ flex: 'none', display: 'block' }} aria-hidden="true">
      <rect width="100" height="100" rx="24" fill={livery.primary} />
      <path d="M0 76 L100 52 L100 76 A24 24 0 0 1 76 100 L24 100 A24 24 0 0 1 0 76 Z" fill={livery.secondary} opacity="0.9" />
      <g transform="translate(20 16) scale(0.6)">
        <path d={EMBLEM_PATHS[livery.emblem]} fill={ink} fillRule="evenodd" />
      </g>
    </svg>
  );
}

export function Emblem({ emblem, size = 20 }: { emblem: Livery['emblem']; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d={EMBLEM_PATHS[emblem]} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

// ───────────── Controls ─────────────

export function Seg<T extends string | number>({ value, options, onChange, title }: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  title?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={title}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ value, min, max, step = 1, onChange, onCommit, label, disabled }: {
  value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void;
  /** Called when the user lets go, for changes that are expensive to apply live. */
  onCommit?: (v: number) => void;
  label?: string;
  disabled?: boolean;
}) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <input
      type="range" min={min} max={max} step={step} value={value} aria-label={label} disabled={disabled}
      style={{ '--fill': fill } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
    />
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { id: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ───────────── Display ─────────────

/** A headline figure with an optional change against a named period. */
export function Tile({ label, value, delta, deltaGood, note, children, onClick, title }: {
  label: string;
  value: ReactNode;
  /** Signed change text, e.g. "+4.2%". */
  delta?: string;
  /** Whether the change is good news (drives the colour and arrow). */
  deltaGood?: boolean | null;
  note?: string;
  children?: ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  const body = (
    <>
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      {(delta || note) && (
        <div className="d">
          {delta && (
            <b className={deltaGood == null ? undefined : deltaGood ? 'good' : 'bad'} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {deltaGood != null && (delta.startsWith('+') ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
              {delta}
            </b>
          )}
          {note && <span>{note}</span>}
        </div>
      )}
      {children && <div className="spark">{children}</div>}
    </>
  );
  return onClick ? (
    <button type="button" className="tile card click" style={{ textAlign: 'left', color: 'inherit', font: 'inherit' }} onClick={onClick} title={title}>{body}</button>
  ) : (
    <div className="tile" title={title}>{body}</div>
  );
}

export function Meter({ value, color, track }: { value: number; color?: string; track?: string }) {
  return (
    <div className="meter" style={track ? { background: track } : undefined}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function Panel({ title, subtitle, icon, onClose, children, footer, wide, actions }: {
  title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; onClose?: () => void;
  children: ReactNode; footer?: ReactNode; wide?: boolean; actions?: ReactNode;
}) {
  return (
    <section className={cx('panel glass', wide && 'wide')}>
      <header className="panel-head">
        {icon}
        <div className="grow">
          <h2 className="ellipsis">{title}</h2>
          {subtitle && <div className="sub ellipsis">{subtitle}</div>}
        </div>
        {actions}
        {onClose && (
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Close panel"><X /></button>
        )}
      </header>
      <div className="panel-body">{children}</div>
      {footer && <footer className="panel-foot">{footer}</footer>}
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card col center" style={{ padding: '26px 20px', alignItems: 'center', gap: 8 }}>
      <div className="strong" style={{ fontSize: 14 }}>{title}</div>
      {children && <div className="muted small" style={{ maxWidth: 380 }}>{children}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

// ───────────── Sorting ─────────────

export interface SortState<K extends string> { key: K; dir: 1 | -1 }

export function useSort<K extends string>(initial: K, dir: 1 | -1 = -1): [SortState<K>, (key: K) => void] {
  const [sort, setSort] = useState<SortState<K>>({ key: initial, dir });
  const toggle = (key: K) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }));
  return [sort, toggle];
}

export function Th<K extends string>({ k, sort, onSort, children, right }: { k: K; sort: SortState<K>; onSort: (k: K) => void; children: ReactNode; right?: boolean }) {
  const active = sort.key === k;
  return (
    <th className={cx('sortable', right && 'r')} onClick={() => onSort(k)} aria-sort={active ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      {children}
      {active && <span style={{ marginLeft: 3 }}>{sort.dir > 0 ? '↑' : '↓'}</span>}
    </th>
  );
}

// ───────────── Layout hooks ─────────────

/** Width of an element in CSS pixels, kept up to date. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Runs a handler for a key while the component is mounted. */
export function useKey(handler: (e: KeyboardEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (e: KeyboardEvent) => ref.current(e);
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);
}
