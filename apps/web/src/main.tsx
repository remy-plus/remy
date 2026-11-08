import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ApiProvider } from './api/index.tsx';
import './index.css';

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <ApiProvider>
        <App />
      </ApiProvider>
    </StrictMode>,
  );
