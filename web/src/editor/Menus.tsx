import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
}
export interface MenuDef { label: string; /** index of the letter to underline */ mnemonic?: number; items: MenuItem[] }

/**
 * Menu bar with real dropdowns: each title is a button with aria-haspopup,
 * each list has role="menu". Arrow keys move between and within menus.
 */
export function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const titles = useRef<(HTMLButtonElement | null)[]>([]);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (open === null) return;
    const onDown = (e: PointerEvent) => { if (!bar.current?.contains(e.target as Node)) setOpen(null); };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);
  useEffect(() => { if (open !== null) items.current[active]?.focus(); }, [open, active]);

  const enabled = (m: number) => menus[m].items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
  const openMenu = (m: number) => { setOpen(m); setActive(enabled(m)[0] ?? 0); };
  const close = (refocus = true) => { const m = open; setOpen(null); if (refocus && m !== null) titles.current[m]?.focus(); };

  const onTitleKey = (e: React.KeyboardEvent, m: number) => {
    const go = (d: number) => { const n = (m + d + menus.length) % menus.length; titles.current[n]?.focus(); if (open !== null) openMenu(n); };
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openMenu(m); }
  };
  const onItemKey = (e: React.KeyboardEvent, m: number) => {
    const ok = enabled(m);
    const step = (d: number) => { const at = ok.indexOf(active); setActive(ok[(at + d + ok.length) % ok.length]); };
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(ok[0]); }
    else if (e.key === 'End') { e.preventDefault(); setActive(ok[ok.length - 1]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') setOpen(null);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = (m + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length;
      titles.current[n]?.focus(); openMenu(n);
    }
  };

  return (
    <div className="menubar-menus" role="menubar" aria-label="Main menu" ref={bar}>
      {menus.map((menu, m) => (
        <div className="menu" key={menu.label}>
          <button
            type="button"
            className={`menu-title ${open === m ? 'is-open' : ''}`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === m}
            ref={(el) => { titles.current[m] = el; }}
            onClick={() => (open === m ? setOpen(null) : openMenu(m))}
            onPointerEnter={() => { if (open !== null && open !== m) openMenu(m); }}
            onKeyDown={(e) => onTitleKey(e, m)}
          >
            {menu.mnemonic === undefined ? menu.label : (
              <>{menu.label.slice(0, menu.mnemonic)}<u>{menu.label[menu.mnemonic]}</u>{menu.label.slice(menu.mnemonic + 1)}</>
            )}
          </button>
          {open === m && (
            <ul className="menu-list" role="menu" aria-label={menu.label}>
              {menu.items.map((it, i) => (
                <li key={it.label} role="none">
                  <button
                    type="button"
                    role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                    aria-checked={it.checked}
                    disabled={it.disabled}
                    tabIndex={active === i ? 0 : -1}
                    ref={(el) => { items.current[i] = el; }}
                    onPointerEnter={() => { if (!it.disabled) setActive(i); }}
                    onKeyDown={(e) => onItemKey(e, m)}
                    onClick={() => { setOpen(null); titles.current[m]?.focus(); it.onSelect(); }}
                  >
                    <span className="menu-check" aria-hidden>{it.checked ? '✓' : ''}</span>
                    <span className="menu-label">{it.label}</span>
                    {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
