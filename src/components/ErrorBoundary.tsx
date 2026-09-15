import { Component, type ErrorInfo, type ReactNode } from 'react';
import { strings } from '../i18n';

interface State {
  error: Error | null;
}

/**
 * The data is safe in IndexedDB whatever the UI does, so a crash only needs to
 * offer a reload rather than trying to recover state.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Rally crashed', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeContent: 'center',
          gap: '1rem',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: '1.25rem' }}>{strings.errors.crashTitle}</h1>
        <p style={{ color: 'var(--text-muted)', maxWidth: '24rem' }}>{strings.errors.crashText}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            minHeight: '2.75rem',
            padding: '0 1.25rem',
            borderRadius: '12px',
            background: 'var(--brand-500)',
            color: '#fff',
            fontWeight: 600,
            justifySelf: 'center',
          }}
        >
          {strings.errors.reload}
        </button>
      </div>
    );
  }
}
