import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import css from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
  flat?: boolean;
  children?: ReactNode;
}

export function Card({ padded, flat, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cx(css.card, padded && css.padded, flat && css.flat, className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface CardButtonProps extends HTMLAttributes<HTMLButtonElement> {
  padded?: boolean;
  children?: ReactNode;
}

/** A card that is itself the tap target - used for list rows on mobile. */
export function CardButton({ padded, className, children, ...rest }: CardButtonProps) {
  return (
    <button
      type="button"
      className={cx(css.card, css.interactive, padded && css.padded, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={css.header}>
      <div className={css.headerText}>
        <div className={css.title}>{title}</div>
        {subtitle && <div className={css.subtitle}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(css.body, className)}>{children}</div>;
}

export function CardFooter({ children }: { children: ReactNode }) {
  return <div className={css.footer}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className={css.sectionTitle}>
      <span className={css.sectionLabel}>{children}</span>
      {action}
    </div>
  );
}

export function Divider() {
  return <hr className={css.divider} />;
}
