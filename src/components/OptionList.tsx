import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import css from '../styles/forms.module.css';

export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  text?: ReactNode;
  meta?: ReactNode;
  disabled?: boolean;
}

/** Radio group with room for an explanation under each choice. */
export function OptionList<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className={css.optionList} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={option.disabled}
          className={cx(css.option, option.value === value && css.optionSelected)}
          onClick={() => onChange(option.value)}
          style={option.disabled ? { opacity: 0.45 } : undefined}
        >
          <span className={css.optionRadio}>
            <span className={css.optionDot} />
          </span>
          <span>
            <span className={css.optionLabel}>{option.label}</span>
            {option.text && <span className={css.optionText}>{option.text}</span>}
            {option.meta && <span className={css.optionMeta}>{option.meta}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
