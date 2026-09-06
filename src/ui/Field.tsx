import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon } from './Icon';
import { cx } from '../lib/cx';
import css from './Field.module.css';

function FieldShell({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={css.field}>
      {(label || hint) && (
        <div className={css.labelRow}>
          {label && (
            <label className={css.label} htmlFor={htmlFor}>
              {label}
            </label>
          )}
          {hint && <span className={css.hint}>{hint}</span>}
        </div>
      )}
      {children}
      {error && <span className={css.error}>{error}</span>}
    </div>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export function TextField({ label, hint, error, className, id, ...rest }: TextFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={fieldId}>
      <input
        id={fieldId}
        className={cx(css.control, error && css.invalid, className)}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </FieldShell>
  );
}

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export function TextAreaField({ label, hint, error, className, id, ...rest }: TextAreaFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={fieldId}>
      <textarea
        id={fieldId}
        className={cx(css.control, error && css.invalid, className)}
        {...rest}
      />
    </FieldShell>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}

export function SelectField({
  label,
  hint,
  error,
  className,
  id,
  children,
  ...rest
}: SelectFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={fieldId}>
      <div className={css.selectWrap}>
        <select
          id={fieldId}
          className={cx(css.control, error && css.invalid, className)}
          {...rest}
        >
          {children}
        </select>
        <Icon name="chevronDown" size={18} className={css.selectChevron} />
      </div>
    </FieldShell>
  );
}

export interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: ReactNode;
  hint?: ReactNode;
  ariaLabel?: string;
}

/**
 * Big +/- targets for entering scores one-handed on a phone. The middle field
 * stays a real number input so a long score can also be typed directly.
 */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  label,
  hint,
  ariaLabel,
}: NumberStepperProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <FieldShell label={label} hint={hint}>
      <div className={css.stepper}>
        <button
          type="button"
          className={css.stepperBtn}
          onClick={() => onChange(clamp(value - step))}
          disabled={value <= min}
          aria-label="Minus"
        >
          <Icon name="minus" size={20} />
        </button>
        <input
          type="number"
          inputMode="numeric"
          className={`${css.stepperValue} tabular`}
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : 'Wert')}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const next = Number.parseInt(e.currentTarget.value, 10);
            onChange(Number.isNaN(next) ? min : clamp(next));
          }}
        />
        <button
          type="button"
          className={css.stepperBtn}
          onClick={() => onChange(clamp(value + step))}
          disabled={value >= max}
          aria-label="Plus"
        >
          <Icon name="plus" size={20} />
        </button>
      </div>
    </FieldShell>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={css.switchRow}
      onClick={() => onChange(!checked)}
    >
      <span className={css.switchText}>
        <span className={css.switchLabel}>{label}</span>
        {hint && <span className={css.switchHint}>{hint}</span>}
      </span>
      <span className={cx(css.switch, checked && css.switchOn)}>
        <span className={css.knob} />
      </span>
    </button>
  );
}
