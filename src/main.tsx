import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ThemeProvider } from './state/theme';
import { ToastProvider } from './ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { requestPersistentStorage } from './db/db';
import './styles/base.css';

// Ask once, early: an installed PWA is normally granted persistent storage
// without a prompt, which stops the browser evicting a tournament mid-evening.
void requestPersistentStorage();

/**
 * BASE_URL is '/' under Docker and '/Spikeball/' on GitHub Pages. React Router
 * refuses to match '/Spikeball' against a basename of '/Spikeball/', so the
 * trailing slash is stripped: that form matches the path with or without it.
 */
const routerBasename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter basename={routerBasename}>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
