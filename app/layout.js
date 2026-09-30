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
                <footer className="site-footer">
          <p>
            Not affiliated with, endorsed by, or sponsored by Chess.com. Chess.com is a
            trademark of Chess.com, LLC.
          </p>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}