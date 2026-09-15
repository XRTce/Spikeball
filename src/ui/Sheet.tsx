import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import css from './Sheet.module.css';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Rendered in a sticky footer; usually one or two Buttons. */
  actions?: ReactNode;
}

/**
 * Bottom sheet on phones, centred dialog from 640px up. Locks background
 * scroll, closes on Escape and on backdrop tap, and traps initial focus.
 */
export function Sheet({ open, onClose, title, subtitle, children, actions }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={css.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={css.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
      >
        <div className={css.grabber} aria-hidden="true" />
        {(title || subtitle) && (
          <div className={css.head}>
            <div className={css.headText}>
              {title && <div className={css.title}>{title}</div>}
              {subtitle && <div className={css.subtitle}>{subtitle}</div>}
            </div>
            <Button variant="ghost" icon="close" aria-label="Schliessen" onClick={onClose} />
          </div>
        )}
        <div className={css.content}>{children}</div>
        {actions && <div className={css.actions}>{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Bestaetigen',
  cancelLabel = 'Abbrechen',
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className={css.confirmText}>{message}</p>
    </Sheet>
  );
}
