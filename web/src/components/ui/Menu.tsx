import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  separatorBefore?: boolean;
}

interface MenuProps {
  items: MenuItem[];
  trigger: ReactNode;
  align?: 'left' | 'right';
  direction?: 'down' | 'up';
  label?: string;
}

export function Menu({ items, trigger, align = 'right', direction = 'down', label = '更多操作' }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrapRef}>
      {isValidElement(trigger)
        ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
            onClick: (event: React.MouseEvent) => {
              event.stopPropagation();
              setOpen((value) => !value);
            },
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            'aria-label': (trigger.props as { label?: string }).label || label,
          })
        : trigger}
      {open ? (
        <div
          className={`menu menu--${align} menu--${direction}`}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          {items.map((item, index) => (
            <div key={`${item.label}-${index}`}>
              {item.separatorBefore ? <div className="menu__sep" /> : null}
              <button
                type="button"
                role="menuitem"
                className={`menu__item ${item.danger ? 'menu__item--danger' : ''}`.trim()}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
