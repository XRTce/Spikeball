import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { cx } from '../lib/cx';
import css from './Page.module.css';

export function AppBar({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** `true` uses history.back(), a string navigates to that path. */
  back?: boolean | string;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={cx(css.appbar, scrolled && css.appbarScrolled)}>
      <div className={cx(css.appbarInner, back ? '' : css.appbarNoLead)}>
        {back && (
          <Button
            variant="ghost"
            icon="chevronLeft"
            aria-label="Zurueck"
            onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
          />
        )}
        <div className={css.titleBlock}>
          {subtitle && <div className={css.subtitle}>{subtitle}</div>}
          <h1 className={css.title}>{title}</h1>
        </div>
        <div className={css.actions}>{actions}</div>
      </div>
    </header>
  );
}

export function Screen({
  children,
  withTabbar,
}: {
  children: ReactNode;
  withTabbar?: boolean;
}) {
  return (
    <main className={cx(css.main, withTabbar && css.withTabbar)}>
      {children}
    </main>
  );
}

export function Stack({ children }: { children: ReactNode }) {
  return <div className={css.stack}>{children}</div>;
}

export function Shell({ children }: { children: ReactNode }) {
  return <div className={css.shell}>{children}</div>;
}

export interface TabItem {
  to: string;
  label: string;
  icon: IconName;
  badge?: boolean;
}

export function TabBar({ items }: { items: TabItem[] }) {
  return (
    <nav className={css.tabbar} aria-label="Hauptnavigation">
      <div className={css.tabbarInner}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            // Without `end` the index tab matches every nested route and would
            // stay highlighted on all four tabs.
            end
            className={({ isActive }) =>
              cx(css.tabItem, isActive && css.tabActive)
            }
          >
            <span className={css.tabIcon}>
              <Icon name={item.icon} size={21} />
              {item.badge && <span className={css.tabDot} />}
            </span>
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function FloatingAction({ children }: { children: ReactNode }) {
  return <div className={css.fabWrap}>{children}</div>;
}
