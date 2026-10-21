import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/landing.css';
import './styles/modals.css';
import './styles/setup.css';
import './styles/lobby.css';
import './styles/game.css';
import './styles/utilities.css';
import './styles/responsive.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
