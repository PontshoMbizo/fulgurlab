import { useState } from 'react';
import { BLOCKS, CATEGORIES, defaultParams } from '../../../shared/catalog.js';
import { BlockGlyph } from './BlockGlyph';
import { blockSize, defaultSystem, ports } from './model';
import { IconLibrary } from './Icons';

/** Library Browser: a collapsible tree of blocks. Drag onto the canvas, or click/Enter to add one. */
export function Palette({ onAdd, insideSubsystem = false }: { onAdd: (type: string) => void; insideSubsystem?: boolean }) {
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(['Discrete', 'Sinks']));
  const query = q.trim().toLowerCase();
  const match = (s: string) => s.toLowerCase().includes(query);
  const toggle = (cat: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; });
  return (
    <nav className="palette" aria-label="Library browser">
      <div className="panel-title"><IconLibrary /> Block library</div>
      <div className="palette-searchbar">
        <input className="palette-search" placeholder="Search blocks…" type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a block" />
      </div>
      <div className="palette-tree">
        {CATEGORIES.map((cat) => {
          const items = BLOCKS.filter((b) => b.category === cat && (insideSubsystem || (b.type !== 'inport' && b.type !== 'outport')) && (!query || match(b.label) || match(b.description) || match(cat)));
          if (!items.length) return null;
          const open = !!query || !collapsed.has(cat);
          return (
            <section key={cat}>
              <button type="button" className="palette-group" aria-expanded={open} onClick={() => toggle(cat)}>
                <span aria-hidden className="caret">{open ? '▾' : '▸'}</span>
                <span>{cat}</span>
                <span className="count">{items.length}</span>
              </button>
              {open && (
                <ul>
                  {items.map((b) => (
                    <li key={b.type}>
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData('application/x-fulgur-block', b.type); e.dataTransfer.effectAllowed = 'copy'; }}
                        onClick={() => onAdd(b.type)}
                        title={b.description}
                      >
                        <LibraryIcon type={b.type} />
                        <span>{b.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </nav>
  );
}

/** The block icon in the design's 64x48 box: body at x 8.5-55.5, y 4.5-43.5, chevrons outside. */
function LibraryIcon({ type }: { type: string }) {
  const block = { id: 'p', type, params: defaultParams(type), x: 0, y: 0, ...(type === 'subsystem' ? { system: defaultSystem() } : {}) };
  const { w, h } = blockSize(block);
  const s = Math.min(47 / w, 39 / h);
  const { inputs, outputs } = ports(block);
  const left = 32 - (w * s) / 2, right = 32 + (w * s) / 2;
  const chev = (x: number, dir: 1 | -1, i: number, n: number) => {
    const y0 = 24 - (h * s) / 2 + ((h * s) * (i + 1)) / (n + 1);
    return <path key={`${dir}${i}`} d={`M${x},${y0 - 4} L${x + 5 * dir},${y0} L${x},${y0 + 4}`} className="icon-chevron" />;
  };
  return (
    <svg width={30} height={22} viewBox="0 0 64 48" aria-hidden className="palette-glyph">
      <g transform={`translate(${left},${24 - (h * s) / 2}) scale(${s})`}>
        <BlockGlyph block={block} />
      </g>
      {Array.from({ length: inputs }, (_, i) => chev(left - 6, 1, i, inputs))}
      {Array.from({ length: outputs }, (_, i) => chev(right + 1, 1, i, outputs))}
    </svg>
  );
}
