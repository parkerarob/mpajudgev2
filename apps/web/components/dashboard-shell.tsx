type DashboardShellProps = {
  title: string;
  description: string;
  roleLabel: string;
  children: React.ReactNode;
};

export function DashboardShell({ title, description, roleLabel, children }: DashboardShellProps) {
  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">{roleLabel}</p>
        <h1>{title}</h1>
        <p className="lede">{description}</p>
      </section>
      <section className="grid">{children}</section>
    </main>
  );
}
