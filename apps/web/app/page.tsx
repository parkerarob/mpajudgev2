import Link from 'next/link';

import { getCurrentUserContext } from '@/lib/auth';

export default async function HomePage() {
  const context = await getCurrentUserContext();

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">MPAapp Rebuild</p>
        <h1>Next.js foundation is live</h1>
        <p className="lede">
          This app shell runs alongside the frozen Firebase SPA. It is the new frontend lane for the
          hosted Supabase rebuild and is already pointed at the linked project URL.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <p className="eyebrow">Status</p>
          <h2>Hosted schema validated</h2>
          <p className="lede">
            Migrations, triggers, RLS, and release RPCs have already passed the hosted smoke workflow.
          </p>
        </article>

        <article className="panel">
          <p className="eyebrow">Authentication</p>
          <h2>{context.user ? 'Signed in' : 'Not signed in'}</h2>
          <p className="lede">
            {context.user
              ? `Current role resolution: ${context.role ?? 'unknown'}.`
              : 'Add the publishable key to apps/web/.env.local and sign in against Supabase Auth.'}
          </p>
          <p>
            <Link href={context.user ? '/admin' : '/sign-in'}>{context.user ? 'Open workspace' : 'Open sign in'}</Link>
          </p>
        </article>

        <article className="panel">
          <p className="eyebrow">Role routes</p>
          <ul className="meta-list">
            <li>
              <span className="meta-label">Admin / Chair</span>
              <span className="meta-value">
                <Link href="/admin">/admin</Link>
              </span>
            </li>
            <li>
              <span className="meta-label">Judge</span>
              <span className="meta-value">
                <Link href="/judge">/judge</Link>
              </span>
            </li>
            <li>
              <span className="meta-label">Director</span>
              <span className="meta-value">
                <Link href="/director">/director</Link>
              </span>
            </li>
          </ul>
        </article>
      </section>
    </main>
  );
}
