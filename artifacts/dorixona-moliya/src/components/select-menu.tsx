import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Search, type LucideIcon } from 'lucide-react';

export type MenuOption = { value: string; label: string; hint?: string; icon?: LucideIcon; color?: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: MenuOption[];
  ariaLabel: string;
  /** Small uppercase caption shown before the value (e.g. "DAVR"). */
  caption?: string;
  icon?: LucideIcon;
  align?: 'left' | 'right';
  className?: string;
  testId?: string;
};

export function SelectMenu({ value, onChange, options, ariaLabel, caption, icon: TriggerIcon, align = 'left', className = '', testId }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find(o => o.value === value) ?? options[0];
  const searchable = options.length > 7;
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? options.filter(o => `${o.label} ${o.hint ?? ''}`.toLocaleLowerCase().includes(q)) : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!open) { setQuery(''); return; }
    setActive(Math.max(0, shown.findIndex(o => o.value === value)));
    if (searchable) requestAnimationFrame(() => search.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (option: MenuOption) => { onChange(option.value); setOpen(false); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(shown.length - 1, i + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter' && shown[active]) { e.preventDefault(); choose(shown[active]); }
  };

  const SelectedIcon = selected?.icon ?? TriggerIcon;
  return <div className={`select-menu ${open ? 'open' : ''} ${className}`} ref={root} onKeyDown={onKey}>
    <button type="button" className="select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(o => !o)} data-testid={testId}>
      {SelectedIcon && <span className="select-trigger-icon" style={selected?.color ? { ['--c' as string]: selected.color } : undefined}><SelectedIcon size={15} /></span>}
      <span className="select-trigger-text">{caption && <small>{caption}</small>}<b>{selected?.label ?? '—'}</b></span>
      <ChevronDown className="select-chevron" size={15} />
    </button>
    {open && <div className={`select-pop ${align}`} role="listbox" id={listId} aria-label={ariaLabel}>
      {searchable && <label className="select-search"><Search size={14} /><input ref={search} value={query} onChange={e => { setQuery(e.target.value); setActive(0); }} placeholder="Qidirish…" /></label>}
      <div className="select-options">
        {shown.map((option, index) => {
          const Icon = option.icon;
          const isSelected = option.value === value;
          return <button type="button" role="option" aria-selected={isSelected} key={option.value || '__all'} className={`select-option ${isSelected ? 'selected' : ''} ${index === active ? 'active' : ''}`} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}>
            <span className="select-option-icon" style={option.color ? { ['--c' as string]: option.color } : undefined}>{Icon && <Icon size={15} />}</span>
            <span className="select-option-text"><b>{option.label}</b>{option.hint && <small>{option.hint}</small>}</span>
            {isSelected && <Check className="select-check" size={15} />}
          </button>;
        })}
        {!shown.length && <div className="select-empty">Hech narsa topilmadi</div>}
      </div>
    </div>}
  </div>;
}
