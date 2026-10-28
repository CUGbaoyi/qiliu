import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { isNative } from './native';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (import.meta.env.PROD && !isNative() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
