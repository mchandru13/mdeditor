import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import 'katex/dist/katex.min.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/viewer.css';
import './styles/editor.css';
import './styles/print.css';

import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
