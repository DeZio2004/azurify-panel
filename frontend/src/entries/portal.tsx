import { createRoot } from 'react-dom/client';

import PortalPage from '@/pages/portal/PortalPage';

const root = document.getElementById('app');
if (root) {
  createRoot(root).render(<PortalPage />);
}
