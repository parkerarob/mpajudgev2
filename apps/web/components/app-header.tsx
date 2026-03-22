import Link from 'next/link';

type AppHeaderProps = {
  currentRole: string | null;
  displayName: string | null;
  email: string | null;
};

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/admin', label: 'Admin' },
  { href: '/judge', label: 'Judge' },
  { href: '/director', label: 'Director' },
];

export function AppHeader({ currentRole, displayName, email }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <div>
          <p className="eyebrow">MPAapp Rebuild</p>
          <p className="app-header__identity">
            {displayName || email || 'Signed out'}
            {currentRole ? ` · ${currentRole}` : ''}
          </p>
        </div>

        <nav className="app-nav" aria-label="Primary">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="app-nav__link">
              {item.label}
            </Link>
          ))}
          <Link href="/sign-in" className="app-nav__link app-nav__link--secondary">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
