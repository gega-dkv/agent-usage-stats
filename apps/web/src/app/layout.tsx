import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';
import { Nav } from '@/components/nav';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Agent Usage Stats',
  description: 'Local-first AI session usage analyzer',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.variable + ' font-sans'}>
        <div className="min-h-screen bg-background text-foreground">
          <Nav />
          <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            {children}
          </main>
          <footer className="border-t border-border bg-muted/30 py-6">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <p className="text-center text-xs text-muted-foreground">
                All data stays on your machine · No telemetry ·{' '}
                <a href="https://github.com/gega-dkv/agent-usage-stats" className="hover:underline">
                  GitHub
                </a>
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
