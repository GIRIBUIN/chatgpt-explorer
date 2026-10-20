import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Full names are already accessible; only visually clipped labels need a tooltip. */
export function TruncatedName({ children }: { children: string }) {
  const label = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  function hide() {
    clearTimeout(timer.current);
    setPosition(null);
  }
  function show() {
    clearTimeout(timer.current);
    const element = label.current;
    if (!element || element.scrollWidth <= element.clientWidth) return;
    timer.current = setTimeout(() => {
      if (!element.isConnected || element.scrollWidth <= element.clientWidth) return;
      const rect = element.getBoundingClientRect();
      const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
      setPosition({
        left: Math.max(8, Math.min(rect.left / zoom, innerWidth / zoom - 288)),
        top: Math.max(8, Math.min(rect.bottom / zoom + 6, innerHeight / zoom - 84)),
      });
    }, 600);
  }
  useLayoutEffect(() => {
    if (!position || !tooltip.current) return;
    const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
    const top = Math.max(8, Math.min(position.top, innerHeight / zoom - tooltip.current.offsetHeight - 8));
    if (top !== position.top) setPosition({ ...position, top });
  }, [position]);
  useEffect(() => {
    // Reuse the row/button's keyboard focus rather than introducing another tab stop.
    const owner = label.current?.closest('button, [role="row"]');
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    owner?.addEventListener('focus', show);
    owner?.addEventListener('blur', hide);
    document.addEventListener('keydown', dismiss);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      clearTimeout(timer.current);
      owner?.removeEventListener('focus', show);
      owner?.removeEventListener('blur', hide);
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [children]);
  return <>
    <span ref={label} className="truncate" aria-describedby={position ? id : undefined}
      onMouseEnter={show} onMouseLeave={hide} onMouseDown={hide}>{children}</span>
    {position && createPortal(<span ref={tooltip} id={id} role="tooltip" className="name-tooltip"
      style={position}>{children}</span>, document.body)}
  </>;
}
