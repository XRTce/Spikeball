import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import css from './Segmented.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

/**
 * iOS-style segmented control with a sliding thumb. The thumb position is
 * measured from the DOM so labels of different widths never desync.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const activeIndex = options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const el = wrap.querySelectorAll<HTMLElement>('[data-segment]')[
        activeIndex < 0 ? 0 : activeIndex
      ];
      if (!el) return;
      setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [activeIndex, options.length]);

  return (
    <div className={css.wrap} role="tablist" aria-label={ariaLabel} ref={wrapRef}>
      {thumb && <span className={css.thumb} style={{ left: thumb.left, width: thumb.width }} />}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-segment
          role="tab"
          aria-selected={option.value === value}
          className={cx(css.option, option.value === value && css.selected)}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  const activeIndex = options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const el = wrap.querySelectorAll<HTMLElement>('[data-tab]')[activeIndex < 0 ? 0 : activeIndex];
      if (!el) return;
      setBar({ left: el.offsetLeft, width: el.offsetWidth });

      // Keep the active tab in view by scrolling the strip itself.
      // scrollIntoView() would walk up to the document and can nudge the
      // visual viewport on mobile, which shrink-to-fits the whole page.
      const left = el.offsetLeft;
      const right = left + el.offsetWidth;
      if (left < wrap.scrollLeft || right > wrap.scrollLeft + wrap.clientWidth) {
        wrap.scrollTo({
          left: Math.max(0, left - (wrap.clientWidth - el.offsetWidth) / 2),
          behavior: 'smooth',
        });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [activeIndex, options.length]);

  return (
    <div className={css.tabs} role="tablist" aria-label={ariaLabel} ref={wrapRef}>
      {bar && <span className={css.tabUnderline} style={{ left: bar.left, width: bar.width }} />}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-tab
          role="tab"
          aria-selected={option.value === value}
          className={cx(css.tab, option.value === value && css.tabActive)}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
