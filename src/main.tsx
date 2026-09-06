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

const container = document.getElementById('root');
if (!container) throw new Error('#root missing');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
