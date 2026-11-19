// Charts. Thin marks, hairline grids, one axis, a hover readout on everything,
// and text always in text colours (the mark beside it carries the series colour).

import { useState } from 'react';
import type { ReactNode } from 'react';
import { useWidth } from './ui';

export const SERIES = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
];
const SURFACE = 'var(--surface-solid)';

/** Round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2.5 ? 5 : norm >= 1.5 ? 2.5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.999; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return ticks;
}

interface TooltipState { x: number; y: number; index: number }

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  // Flip to the left of the pointer near the right edge so it never leaves the card.
  const flip = x > width - 170;
  return (
    <div className="tooltip" style={{ left: flip ? undefined : x + 14, right: flip ? width - x + 14 : undefined, top: Math.max(0, y - 10) }}>
      {children}
    </div>
  );
}

// ───────────── Sparkline ─────────────

export function Sparkline({ values, width = 96, height = 26, color = 'var(--series-muted)', accent = 'var(--accent)' }: {
  values: number[]; width?: number; height?: number; color?: string; accent?: string;
}) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: 'block' }}>
      <path d={d} fill="none" style={{ stroke: color }} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last])} r="3" style={{ fill: accent, stroke: SURFACE }} strokeWidth="1.5" />
    </svg>
  );
}

// ───────────── Line chart ─────────────

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
}

export function LineChart({ series, labels, height = 170, format, zeroBased = false, legend = true }: {
  series: LineSeries[];
  labels: string[];
  height?: number;
  format: (v: number) => string;
  /** Start the value axis at zero. */
  zeroBased?: boolean;
  legend?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const n = labels.length;
  const m = { l: 50, r: 14, t: 8, b: 22 };
  const pw = Math.max(10, width - m.l - m.r);
  const ph = height - m.t - m.b;

  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const v of s.values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (zeroBased) lo = Math.min(0, lo);
  const ticks = niceTicks(lo, hi, 3);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const x = (i: number) => m.l + (n > 1 ? (i / (n - 1)) * pw : pw / 2);
  const y = (v: number) => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * ph;
  const single = series.length === 1;
  // A few evenly spaced date labels are enough; the tooltip has the rest.
  const xLabels = n <= 1 ? [0] : n <= 6 ? labels.map((_, i) => i) : [0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1];

  return (
    <div className="chart" ref={ref}>
      {legend && series.length > 1 && (
        <div className="legend" style={{ marginBottom: 6 }}>
          {series.map((s) => (
            <span className="key" key={s.name}><i className="ln" style={{ background: s.color }} />{s.name}</span>
          ))}
        </div>
      )}
      {width > 0 && (
        <svg height={height} role="img" aria-label={series.map((s) => s.name).join(', ')}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const index = n > 1 ? Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / pw) * (n - 1)))) : 0;
            setTip({ x: px, y: e.clientY - rect.top, index });
          }}
          onPointerLeave={() => setTip(null)}>
          <g className="grid">
            {ticks.map((t) => <line key={t} x1={m.l} x2={m.l + pw} y1={y(t)} y2={y(t)} />)}
          </g>
          {ticks.map((t) => <text key={t} x={m.l - 8} y={y(t) + 3.5} textAnchor="end">{format(t)}</text>)}
          {y0 < 0 && y1 > 0 && <line className="axis" x1={m.l} x2={m.l + pw} y1={y(0)} y2={y(0)} />}
          {xLabels.map((i) => (
            <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{labels[i]}</text>
          ))}
          {series.map((s) => {
            const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
            const base = y(Math.max(y0, Math.min(y1, 0)));
            return (
              <g key={s.name}>
                {single && n > 1 && (
                  <path d={`${d} L${x(n - 1).toFixed(1)} ${base} L${x(0).toFixed(1)} ${base} Z`} style={{ fill: s.color }} opacity="0.1" />
                )}
                <path d={d} fill="none" style={{ stroke: s.color }} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {n > 0 && <circle cx={x(n - 1)} cy={y(s.values[n - 1])} r="4" style={{ fill: s.color, stroke: SURFACE }} strokeWidth="2" />}
              </g>
            );
          })}
          {tip && (
            <g>
              <line className="cross" x1={x(tip.index)} x2={x(tip.index)} y1={m.t} y2={m.t + ph} />
              {series.map((s) => (
                <circle key={s.name} cx={x(tip.index)} cy={y(s.values[tip.index])} r="4" style={{ fill: s.color, stroke: SURFACE }} strokeWidth="2" />
              ))}
            </g>
          )}
        </svg>
      )}
      {tip && (
        <Tooltip x={tip.x} y={tip.y} width={width}>
          <div className="tt-title">{labels[tip.index]}</div>
          {series.map((s) => (
            <div className="tt-row" key={s.name}>
              <span className="muted"><i className="tt-key" style={{ background: s.color }} />{s.name}</span>
              <b>{format(s.values[tip.index])}</b>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

// ───────────── Columns ─────────────

/** Path for a bar that is square on the baseline and rounded at its data end. */
function barPath(x: number, w: number, yBase: number, yEnd: number, r: number): string {
  const up = yEnd < yBase;
  const h = Math.abs(yBase - yEnd);
  const rr = Math.min(r, w / 2, h);
  if (h < 0.5) return '';
  if (up) {
    return `M${x} ${yBase} V${yEnd + rr} Q${x} ${yEnd} ${x + rr} ${yEnd} H${x + w - rr} Q${x + w} ${yEnd} ${x + w} ${yEnd + rr} V${yBase} Z`;
  }
  return `M${x} ${yBase} V${yEnd - rr} Q${x} ${yEnd} ${x + rr} ${yEnd} H${x + w - rr} Q${x + w} ${yEnd} ${x + w} ${yEnd - rr} V${yBase} Z`;
}

/** One value per period; values below zero hang from the baseline in the opposing hue. */
export function ColumnChart({ values, labels, height = 160, format, name }: {
  values: number[]; labels: string[]; height?: number; format: (v: number) => string; name: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const n = values.length;
  const m = { l: 50, r: 10, t: 8, b: 22 };
  const pw = Math.max(10, width - m.l - m.r);
  const ph = height - m.t - m.b;
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 3);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const y = (v: number) => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * ph;
  const band = pw / Math.max(1, n);
  const bw = Math.max(2, Math.min(24, band - 2));
  const every = Math.max(1, Math.ceil(n / 6));

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg height={height} role="img" aria-label={name} onPointerLeave={() => setTip(null)}>
          <g className="grid">
            {ticks.map((t) => <line key={t} x1={m.l} x2={m.l + pw} y1={y(t)} y2={y(t)} />)}
          </g>
          {ticks.map((t) => <text key={t} x={m.l - 8} y={y(t) + 3.5} textAnchor="end">{format(t)}</text>)}
          {values.map((v, i) => {
            const bx = m.l + i * band + (band - bw) / 2;
            const hot = tip?.index === i;
            return (
              <g key={i}>
                <path d={barPath(bx, bw, y(0), y(v), 4)} style={{ fill: v >= 0 ? 'var(--series-1)' : 'var(--series-8)' }} opacity={tip && !hot ? 0.55 : 1} />
                {/* The whole band is the hit target, not just the painted bar. */}
                <rect x={m.l + i * band} y={m.t} width={band} height={ph} fill="transparent"
                  onPointerMove={(e) => {
                    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, index: i });
                  }} />
                {i % every === 0 && <text x={m.l + i * band + band / 2} y={height - 6} textAnchor="middle">{labels[i]}</text>}
              </g>
            );
          })}
          <line className="axis" x1={m.l} x2={m.l + pw} y1={y(0)} y2={y(0)} />
        </svg>
      )}
      {tip && (
        <Tooltip x={tip.x} y={tip.y} width={width}>
          <div className="tt-title">{labels[tip.index]}</div>
          <div className="tt-row"><span className="muted">{name}</span><b>{format(values[tip.index])}</b></div>
        </Tooltip>
      )}
    </div>
  );
}

/** Parts of a whole over time, stacked on one baseline with a 2px gap between segments. */
export function StackedColumns({ series, labels, height = 180, format }: {
  series: { name: string; color: string; values: number[] }[];
  labels: string[];
  height?: number;
  format: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const n = labels.length;
  const m = { l: 50, r: 10, t: 8, b: 22 };
  const pw = Math.max(10, width - m.l - m.r);
  const ph = height - m.t - m.b;
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0));
  const ticks = niceTicks(0, Math.max(1, ...totals), 3);
  const y1 = ticks[ticks.length - 1];
  const y = (v: number) => m.t + (1 - v / (y1 || 1)) * ph;
  const band = pw / Math.max(1, n);
  const bw = Math.max(2, Math.min(24, band - 2));
  const every = Math.max(1, Math.ceil(n / 6));

  return (
    <div className="chart" ref={ref}>
      <div className="legend" style={{ marginBottom: 6 }}>
        {series.map((s) => <span className="key" key={s.name}><i className="sw" style={{ background: s.color }} />{s.name}</span>)}
      </div>
      {width > 0 && (
        <svg height={height} role="img" aria-label={series.map((s) => s.name).join(', ')} onPointerLeave={() => setTip(null)}>
          <g className="grid">
            {ticks.map((t) => <line key={t} x1={m.l} x2={m.l + pw} y1={y(t)} y2={y(t)} />)}
          </g>
          {ticks.map((t) => <text key={t} x={m.l - 8} y={y(t) + 3.5} textAnchor="end">{format(t)}</text>)}
          {labels.map((label, i) => {
            const bx = m.l + i * band + (band - bw) / 2;
            let acc = 0;
            const hot = tip?.index === i;
            return (
              <g key={i} opacity={tip && !hot ? 0.55 : 1}>
                {series.map((s, si) => {
                  const v = Math.max(0, s.values[i] ?? 0);
                  if (v <= 0) return null;
                  const yb = y(acc);
                  acc += v;
                  const yt = y(acc);
                  // 2px of surface between segments; the top segment gets the rounded data end.
                  const h = yb - yt - (si > 0 ? 2 : 0);
                  if (h < 0.75) return null;
                  const last = series.slice(si + 1).every((o) => (o.values[i] ?? 0) <= 0);
                  const base = yb - (si > 0 ? 2 : 0);
                  return last
                    ? <path key={s.name} d={barPath(bx, bw, base, yt, 4)} style={{ fill: s.color }} />
                    : <rect key={s.name} x={bx} y={yt} width={bw} height={h} style={{ fill: s.color }} />;
                })}
                <rect x={m.l + i * band} y={m.t} width={band} height={ph} fill="transparent"
                  onPointerMove={(e) => {
                    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, index: i });
                  }} />
                {i % every === 0 && <text x={m.l + i * band + band / 2} y={height - 6} textAnchor="middle">{label}</text>}
              </g>
            );
          })}
          <line className="axis" x1={m.l} x2={m.l + pw} y1={y(0)} y2={y(0)} />
        </svg>
      )}
      {tip && (
        <Tooltip x={tip.x} y={tip.y} width={width}>
          <div className="tt-title">{labels[tip.index]}</div>
          {series.map((s) => (
            <div className="tt-row" key={s.name}>
              <span className="muted"><i className="tt-key" style={{ background: s.color }} />{s.name}</span>
              <b>{format(s.values[tip.index] ?? 0)}</b>
            </div>
          ))}
          <div className="tt-row" style={{ marginTop: 3, paddingTop: 3, borderTop: '1px solid var(--line)' }}>
            <span className="muted">Total</span><b>{format(totals[tip.index])}</b>
          </div>
        </Tooltip>
      )}
    </div>
  );
}

// ───────────── Ranked bars and segmented bars ─────────────

export interface BarItem {
  label: ReactNode;
  value: number;
  /** Text shown at the bar end (defaults to the formatted value). */
  text?: string;
  onClick?: () => void;
  title?: string;
}

/** Horizontal bars on a shared baseline, one hue: for comparing and ranking. */
export function HBars({ items, format, color = 'var(--series-1)', max }: {
  items: BarItem[]; format: (v: number) => string; color?: string; max?: number;
}) {
  const top = max ?? Math.max(1e-9, ...items.map((i) => Math.abs(i.value)));
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} className="hbar-row" title={it.title} onClick={it.onClick} style={it.onClick ? { cursor: 'pointer' } : undefined}>
          <div className="ellipsis muted">{it.label}</div>
          <div className="track">
            <div className="bar" style={{ width: `${Math.max(0.5, (Math.abs(it.value) / top) * 100)}%`, background: it.value < 0 ? 'var(--series-8)' : color }} />
          </div>
          <div className="val">{it.text ?? format(it.value)}</div>
        </div>
      ))}
    </div>
  );
}

/** One whole split into parts, read beside its figures. */
export function SegBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0) || 1;
  return (
    <div className="segbar" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <i key={p.label} title={`${p.label}: ${Math.round((p.value / total) * 100)}%`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}
