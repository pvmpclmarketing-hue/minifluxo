import './globals.css';
import './dashboard/flow-list.css';
import './dashboard/webhooks.css';
import './dashboard/dispatches.css';
export const metadata = { title: 'WhatsEntregavel', description: 'Entregas inteligentes pelo WhatsApp' };
export default function RootLayout({ children }) { return <html lang="pt-BR"><body>{children}</body></html>; }
