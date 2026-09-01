import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useSession } from '@/store/session';
import { App } from './App';
import './styles.css';

// Initialise la session Supabase au démarrage
useSession.getState().init();

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
