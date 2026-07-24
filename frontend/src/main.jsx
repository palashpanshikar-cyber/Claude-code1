import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Registering a service worker is one of the criteria browsers use to allow
// "Add to Home Screen" as a standalone app rather than a plain bookmark.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Non-fatal: the app still works as a normal page, just without the
      // installable-app treatment.
    });
  });
}
