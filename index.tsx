import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import { initTelegram } from './utils/tma';
import { setSemesterConfig } from './utils/samaraDate';

// Initialize Telegram Mini App SDK strictly BEFORE root.render()
initTelegram();

// Hydrate semester configuration dynamically from static asset (R5 fix for 2027+)
fetch(`${import.meta.env.BASE_URL}semester.json`)
  .then(r => (r.ok ? r.json() : null))
  .then(cfg => {
    if (cfg && cfg.semesterName && Array.isArray(cfg.blocks)) {
      setSemesterConfig(cfg);
    }
  })
  .catch(() => {});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);