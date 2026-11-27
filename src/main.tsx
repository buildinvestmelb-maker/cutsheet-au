import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CutSheetApp } from './apps/cutsheet/CutSheetApp';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('CutSheet AU mount target #root not found.');
}

createRoot(rootEl).render(
  <StrictMode>
    <CutSheetApp />
  </StrictMode>,
);
