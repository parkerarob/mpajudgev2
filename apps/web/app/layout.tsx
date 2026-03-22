import './globals.css';

import type { Metadata } from 'next';

import { AppHeader } from '@/components/app-header';
import { getCurrentUserContext } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'MPAapp Rebuild',
  description: 'Next.js + Supabase rebuild lane for MPAapp.',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const context = await getCurrentUserContext();

  return (
    <html lang="en">
      <body>
        <AppHeader
          currentRole={context.role}
          displayName={context.profile?.display_name ?? null}
          email={context.profile?.email ?? context.user?.email ?? null}
        />
        {children}
      </body>
    </html>
  );
}
