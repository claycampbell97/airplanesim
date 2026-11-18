// Airport name labels: plain DOM elements positioned over the canvas, which keeps
// the text razor sharp at any zoom and lets the UI style it with CSS.

export interface LabelSpec {
  id: string;
  x: number;
  y: number;
  /** Higher wins when labels would overlap. */
  priority: number;
  code: string;
  name?: string;
  /** Visual variant: 'hub' | 'served' | 'plain' | 'selected'. */
  kind: string;
  /** Vertical offset so the label clears its marker. */
  offset: number;
}

const CELL_W = 58;
const CELL_H = 18;

export class LabelLayer {
  private root: HTMLElement;
  private pool = new Map<string, { el: HTMLDivElement; code: HTMLElement; name: HTMLElement; kind: string; x: number; y: number; text: string }>();
  private used = new Set<string>();

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** Lays out as many labels as fit without overlapping, most important first. */
  update(specs: LabelSpec[], width: number, height: number, max: number): void {
    specs.sort((a, b) => b.priority - a.priority);
    const cols = Math.ceil(width / CELL_W) + 2;
    const rows = Math.ceil(height / CELL_H) + 2;
    const grid = new Uint8Array(cols * rows);
    this.used.clear();
    let shown = 0;
    for (const s of specs) {
      if (shown >= max) break;
      const w = (s.name ? 34 + s.name.length * 6.2 : 38) + 6;
      const left = s.x + 7;
      const top = s.y - 8 - s.offset * 0.4;
      if (left < 0 || top < 0 || left + w > width || top + 16 > height) continue;
      const c0 = Math.floor(left / CELL_W);
      const c1 = Math.floor((left + w) / CELL_W);
      const r0 = Math.floor(top / CELL_H);
      const r1 = Math.floor((top + 15) / CELL_H);
      let free = true;
      for (let r = r0; r <= r1 && free; r++) for (let c = c0; c <= c1; c++) if (grid[r * cols + c]) { free = false; break; }
      if (!free) continue;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r * cols + c] = 1;
      this.place(s, left, top);
      shown++;
    }
    for (const [id, item] of this.pool) {
      if (!this.used.has(id) && item.el.style.display !== 'none') item.el.style.display = 'none';
    }
  }

  private place(s: LabelSpec, left: number, top: number): void {
    let item = this.pool.get(s.id);
    if (!item) {
      const el = document.createElement('div');
      el.className = 'ap-label';
      const code = document.createElement('b');
      const name = document.createElement('span');
      el.append(code, name);
      this.root.appendChild(el);
      item = { el, code, name, kind: '', x: -1, y: -1, text: '' };
      this.pool.set(s.id, item);
    }
    this.used.add(s.id);
    const text = s.code + '|' + (s.name ?? '');
    if (item.text !== text) {
      item.code.textContent = s.code;
      item.name.textContent = s.name ?? '';
      item.text = text;
    }
    if (item.kind !== s.kind) {
      item.el.dataset.kind = s.kind;
      item.kind = s.kind;
    }
    if (item.el.style.display === 'none') item.el.style.display = '';
    if (Math.abs(item.x - left) > 0.4 || Math.abs(item.y - top) > 0.4) {
      item.el.style.transform = `translate3d(${left.toFixed(1)}px,${top.toFixed(1)}px,0)`;
      item.x = left;
      item.y = top;
    }
  }

  clear(): void {
    for (const item of this.pool.values()) item.el.remove();
    this.pool.clear();
  }
}
