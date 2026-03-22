import { DashboardShell } from '@/components/dashboard-shell';
import { requireRole } from '@/lib/auth';
import { getDirectorDashboardData } from '@/lib/director-dashboard';
import Link from 'next/link';

function formatDate(value: string | null) {
  if (!value) {
    return 'Not scheduled';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatTime(value: string | null) {
  if (!value) {
    return 'TBD';
  }

  const [hours, minutes] = value.split(':');
  const date = new Date(Date.UTC(2000, 0, 1, Number(hours), Number(minutes)));
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export default async function DirectorPage() {
  const { profile } = await requireRole(['director', 'admin']);
  const dashboard = await getDirectorDashboardData();

  return (
    <DashboardShell
      roleLabel="Director Workspace"
      title="Event info and released packets"
      description="This route now reads real event-entry, schedule, and released packet data from the hosted rebuild schema."
    >
      <article className="panel">
        <p className="eyebrow">Director</p>
        <h2>{profile?.display_name ?? 'Unknown director'}</h2>
        <p className="lede">{profile?.email ?? 'No email available'}</p>
      </article>
      <article className="panel">
        <p className="eyebrow">Summary</p>
        <ul className="meta-list">
          <li>
            <span className="meta-label">Entries</span>
            <span className="meta-value">{dashboard.summary.entries}</span>
          </li>
          <li>
            <span className="meta-label">Scheduled</span>
            <span className="meta-value">{dashboard.summary.scheduled}</span>
          </li>
          <li>
            <span className="meta-label">Checked in</span>
            <span className="meta-value">{dashboard.summary.checkedIn}</span>
          </li>
          <li>
            <span className="meta-label">Released packets</span>
            <span className="meta-value">{dashboard.summary.released}</span>
          </li>
        </ul>
      </article>
      <article className="panel">
        <p className="eyebrow">Release boundary</p>
        <h2>Directors only see released packets</h2>
        <p className="lede">
          The hosted smoke workflow already verified that unreleased packet artifacts stay hidden and
          released packet artifacts become visible after the release RPC succeeds.
        </p>
      </article>
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Entry routing</p>
            <h2>Open a focused entry workspace</h2>
            <p className="lede">
              `/director` is now the overview surface. Open an entry to see its full event-day timing
              and released packet artifacts.
            </p>
          </div>
        </div>

        <div className="ops-grid">
          {dashboard.entries.map((entry) => (
            <article className="ops-card" key={entry.id}>
              <p className="eyebrow">{entry.eventStatus}</p>
              <h3>
                {entry.schoolName} · {entry.ensembleName}
              </h3>
              <p className="lede">
                {entry.eventName} · {entry.siteName}
                {entry.siteCity ? `, ${entry.siteCity}` : ''} · {formatDate(entry.eventStartDate)}
              </p>
              <div className="ops-card__value">{entry.grade ?? 'Grade pending'}</div>
              <div className="row-note">
                {entry.commentsOnly ? 'Comments Only' : 'Full adjudication'} ·{' '}
                {entry.assignedSlot
                  ? `Estimated start ${formatTime(entry.assignedSlot.startTime)}`
                  : 'Schedule pending'}
              </div>
              <div className="pill-row">
                <span className={`status-chip ${entry.checkinCompleted ? 'status-complete' : 'status-setup'}`}>
                  {entry.checkinCompleted ? 'Checked in' : 'Check-in pending'}
                </span>
                <span
                  className={`status-chip ${
                    entry.packet?.release_status === 'released' ? 'status-released' : 'status-setup'
                  }`}
                >
                  {entry.packet?.release_status === 'released' ? 'Released packet' : 'Unreleased'}
                </span>
              </div>
              <div className="action-row" style={{ marginTop: '1rem' }}>
                <Link
                  href={`/director/entries/${entry.id}`}
                  className="button button-secondary button-tight"
                >
                  Open entry
                </Link>
              </div>
            </article>
          ))}
        </div>
      </article>
    </DashboardShell>
  );
}
