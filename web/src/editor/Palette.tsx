import { useState } from 'react';
import { BLOCKS, CATEGORIES } from '../../../shared/catalog.js';
import { BlockGlyph } from './BlockGlyph';
import { blockSize } from './model';
import { defaultParams } from '../../../shared/catalog.js';

/** Library of blocks: drag onto the canvas, or click/Enter to add one. */
export function Palette({ onAdd }: { onAdd: (type: string) => void }) {
  const [q, setQ] = useState('');
  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  return (
    <nav className="palette" aria-label="Block library">
      <input className="palette-search" placeholder="Find a block" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a block" />
      {CATEGORIES.map((cat) => {
        const items = BLOCKS.filter((b) => b.category === cat && (match(b.label) || match(b.description) || match(cat)));
        if (!items.length) return null;
        return (
          <section key={cat}>
            <h3>{cat}</h3>
            <ul>
              {items.map((b) => {
                const preview = { id: 'p', type: b.type, params: defaultParams(b.type), x: 0, y: 0 };
                const { w, h } = blockSize(preview);
                const scale = Math.min(1, 44 / w, 34 / h);
                return (
                  <li key={b.type}>
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData('application/x-fulgur-block', b.type); e.dataTransfer.effectAllowed = 'copy'; }}
                      onClick={() => onAdd(b.type)}
                      title={b.description}
                    >
                      <svg width={48} height={36} viewBox={`0 0 48 36`} aria-hidden className="palette-glyph">
                        <g transform={`translate(${(48 - w * scale) / 2},${(36 - h * scale) / 2}) scale(${scale})`}>
                          <BlockGlyph block={preview} />
                        </g>
                      </svg>
                      <span>{b.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
