import './globals.css';
import { Analytics } from "@vercel/analytics/next"

export const metadata = {
  title: 'MosesChess — Chess.com Game Analyzer',
  description: "Find the 3 fixable things capping your chess rating.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="header-inner">
            <span className="logo">Moses<span>Chess</span></span>
            
          </div>
        </header>
        <main>{children}</main>
        <Analytics />
      </body>
    </html>
  );
}