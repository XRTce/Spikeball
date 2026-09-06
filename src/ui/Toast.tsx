import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './Icon';
import css from './Toast.module.css';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  show: (message: string, options?: { tone?: ToastTone; action?: ToastItem['action'] }) => void;
  success: (message: string, action?: ToastItem['action']) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const toneIcon: Record<ToastTone, IconName> = {
  success: 'checkCircle',
  error: 'alert',
  info: 'info',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastApi['show']>(
    (message, options) => {
      const id = nextId.current;
      nextId.current += 1;
      const item: ToastItem = { id, message, tone: options?.tone ?? 'info' };
      if (options?.action) item.action = options.action;
      setItems((current) => [...current.slice(-2), item]);
      window.setTimeout(() => dismiss(id), options?.action ? 6000 : 3200);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message, action) => show(message, action ? { tone: 'success', action } : { tone: 'success' }),
      error: (message) => show(message, { tone: 'error' }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={css.region} role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`${css.toast} ${css[item.tone]}`}>
            <Icon name={toneIcon[item.tone]} size={20} className={css.icon} />
            <span className={css.message}>{item.message}</span>
            {item.action && (
              <button
                type="button"
                className={css.action}
                onClick={() => {
                  item.action?.onClick();
                  dismiss(item.id);
                }}
              >
                {item.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
