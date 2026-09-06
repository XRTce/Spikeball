import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from '../lib/cx';
import css from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'tinted' | 'danger' | 'dangerGhost';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  busy?: boolean;
  icon?: IconName;
  iconAfter?: IconName;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block,
  busy,
  icon,
  iconAfter,
  children,
  className,
  type = 'button',
  disabled,
  ...rest
}: ButtonProps) {
  const iconOnly = children === undefined || children === null || children === '';
  const iconSize = size === 'sm' ? 18 : size === 'lg' ? 24 : 20;

  const classes = cx(
    css.btn,
    css[variant],
    size !== 'md' && css[size],
    block && css.block,
    iconOnly && css.iconOnly,
    className,
  );

  return (
    <button type={type} className={classes} disabled={disabled || busy} {...rest}>
      <span className={busy ? `${css.label} ${css.hiddenLabel}` : css.label}>
        {icon && <Icon name={icon} size={iconSize} />}
        {children}
        {iconAfter && <Icon name={iconAfter} size={iconSize} />}
      </span>
      {busy && (
        <span className={css.centeredSpinner}>
          <span className={css.spinner} />
        </span>
      )}
    </button>
  );
}
