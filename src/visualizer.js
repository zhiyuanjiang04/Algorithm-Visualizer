const SVG_NS = 'http://www.w3.org/2000/svg';

function createSVG(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
}

function nodePos(index, totalWidth = 1000) {
  const level = Math.floor(Math.log2(index + 1));
  const firstAtLevel = 2 ** level - 1;
  const posInLevel = index - firstAtLevel;
  const count = 2 ** level;
  const marginX = 58;
  const usable = totalWidth - marginX * 2;
  const gap = usable / count;
  const x = marginX + gap * (posInLevel + 0.5);
  const y = 86 + level * 98;
  return { x, y, level };
}

function stateOf(index, step) {
  if (!step) return 'normal';
  if (step.active === index) return 'active';
  if (Array.isArray(step.compare) && step.compare.includes(index)) return 'compare';

  if (Array.isArray(step.doneRange) && step.doneRange.length === 2) {
    const [l, r] = step.doneRange;
    if (index >= l && index <= r) return 'done';
  }
  return 'normal';
}

function nodeColor(state) {
  switch (state) {
    case 'active': return '#e74c3c';
    case 'compare': return '#f39c12';
    case 'done': return '#27ae60';
    default: return '#ccc';
  }
}

export class HeapVisualizer {
  constructor(svg) {
    this.svg = svg;
    this.currentArray = [];
    this.clear();
  }

  clear() {
    this.svg.innerHTML = '';
    const bg = createSVG('rect', {
      x: 0,
      y: 0,
      width: 1000,
      height: 560,
      fill: '#fff',
    });
    this.svg.appendChild(bg);

    const title = createSVG('text', {
      x: 22,
      y: 36,
      'font-size': 16,
      fill: '#2c3e50',
      'font-weight': 'bold',
    });
    title.textContent = '堆创建可视化区域';
    this.svg.appendChild(title);
  }

  render(step) {
    const arr = Array.isArray(step?.array) ? step.array : [];
    this.currentArray = arr.slice();

    this.clear();
    this.drawTree(arr, step);
    this.drawArrayBar(arr, step);
  }

  drawTree(arr, step) {
    for (let i = 0; i < arr.length; i++) {
      const left = i * 2 + 1;
      const right = i * 2 + 2;
      const p = nodePos(i);

      if (left < arr.length) {
        const c = nodePos(left);
        this.svg.appendChild(createSVG('line', {
          x1: p.x, y1: p.y + 22,
          x2: c.x, y2: c.y - 22,
          stroke: '#999',
          'stroke-width': 1,
        }));
      }
      if (right < arr.length) {
        const c = nodePos(right);
        this.svg.appendChild(createSVG('line', {
          x1: p.x, y1: p.y + 22,
          x2: c.x, y2: c.y - 22,
          stroke: '#999',
          'stroke-width': 1,
        }));
      }
    }

    for (let i = 0; i < arr.length; i++) {
      const p = nodePos(i);
      const state = stateOf(i, step);

      const g = createSVG('g');
      const circle = createSVG('circle', {
        cx: p.x,
        cy: p.y,
        r: 22,
        fill: nodeColor(state),
        stroke: '#666',
        'stroke-width': 1,
      });

      const txt = createSVG('text', {
        x: p.x,
        y: p.y + 6,
        'font-size': 14,
        'text-anchor': 'middle',
        fill: '#333',
      });
      txt.textContent = String(arr[i]);

      const idx = createSVG('text', {
        x: p.x,
        y: p.y + 40,
        'font-size': 10,
        'text-anchor': 'middle',
        fill: '#888',
      });
      idx.textContent = 'i=' + i;

      g.appendChild(circle);
      g.appendChild(txt);
      g.appendChild(idx);
      this.svg.appendChild(g);
    }
  }

  drawArrayBar(arr, step) {
    const startX = 42;
    const y = 472;
    const cellW = Math.min(84, Math.floor((920 / Math.max(arr.length, 1))));

    const label = createSVG('text', {
      x: 22,
      y: 438,
      'font-size': 14,
      fill: '#333',
      'font-weight': 'bold',
    });
    label.textContent = '数组视图';
    this.svg.appendChild(label);

    arr.forEach((v, i) => {
      const x = startX + i * cellW;
      const state = stateOf(i, step);
      const rect = createSVG('rect', {
        x,
        y,
        width: cellW - 6,
        height: 44,
        fill: nodeColor(state),
        stroke: '#666',
        'stroke-width': 1,
      });

      const t = createSVG('text', {
        x: x + (cellW - 6) / 2,
        y: y + 27,
        'text-anchor': 'middle',
        'font-size': 14,
        fill: '#333',
      });
      t.textContent = String(v);

      this.svg.appendChild(rect);
      this.svg.appendChild(t);
    });

    if (Array.isArray(step?.swap) && step.swap.length === 2) {
      const [a, b] = step.swap;
      const text = createSVG('text', {
        x: 22,
        y: 535,
        'font-size': 12,
        fill: '#e67e22',
      });
      text.textContent = '本步交换: index ' + a + ' 与 index ' + b;
      this.svg.appendChild(text);
    }
  }
}

/**
 * 快速排序可视化（扩展算法）
 * 使用柱状条显示
 */
export class QuickSortVisualizer {
  constructor(svg) {
    this.svg = svg;
    this.clear();
  }

  clear() {
    this.svg.innerHTML = '';
    const bg = createSVG('rect', { x: 0, y: 0, width: 1000, height: 560, fill: '#fff' });
    this.svg.appendChild(bg);

    const title = createSVG('text', {
      x: 22,
      y: 36,
      'font-size': 16,
      fill: '#2c3e50',
      'font-weight': 'bold',
    });
    title.textContent = '快速排序可视化区域';
    this.svg.appendChild(title);
  }

  render(step) {
    const arr = Array.isArray(step?.array) ? step.array : [];
    this.clear();

    if (!arr.length) return;

    const max = Math.max(...arr.map((n) => Math.abs(Number(n) || 0)), 1);
    const baseY = 500;
    const startX = 42;
    const w = Math.min(68, Math.floor(900 / arr.length));

    arr.forEach((v, i) => {
      const h = Math.max(18, Math.round((Math.abs(v) / max) * 280));
      const x = startX + i * w;
      const y = baseY - h;

      let fill = '#ddd';
      if (step.active === i) fill = '#e74c3c';
      if (Array.isArray(step.compare) && step.compare.includes(i)) fill = '#f39c12';
      if (Array.isArray(step.doneRange) && i >= step.doneRange[0] && i <= step.doneRange[1]) fill = '#27ae60';

      const rect = createSVG('rect', {
        x, y, width: w - 6, height: h,
        fill,
        stroke: '#666', 'stroke-width': 1,
      });
      this.svg.appendChild(rect);

      const txt = createSVG('text', {
        x: x + (w - 6) / 2,
        y: y - 8,
        'text-anchor': 'middle',
        'font-size': 11,
        fill: '#333',
      });
      txt.textContent = String(v);
      this.svg.appendChild(txt);
    });
  }
}