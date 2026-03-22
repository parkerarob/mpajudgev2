import { DashboardShell } from '@/components/dashboard-shell';
import { requireRole } from '@/lib/auth';
import { getJudgeDashboardData } from '@/lib/judge-dashboard';
import Link from 'next/link';

function formatDate(value: string | null) {
  if (!value) return 'Not scheduled';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatTime(value: string | null) {
  if (!value) return 'TBD';
  const [hours, minutes] = value.split(':');
  const date = new Date(Date.UTC(2000, 0, 1, Number(hours), Number(minutes)));
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export default async function JudgePage() {
  const { profile } = await requireRole(['judge', 'admin']);
  const dashboard = await getJudgeDashboardData();

  return (
    <DashboardShell
      roleLabel="Judge Workspace"
      title="Assignment queue and sheet status"
      description="This route now shows real hosted assignment, schedule, and score-sheet status data for the signed-in judge."
    >
      <article className="panel">
        <p className="eyebrow">Judge</p>
        <h2>{profile?.display_name ?? 'Unknown judge'}</h2>
        <p className="lede">{profile?.email ?? 'No email available'}</p>
      </article>
      <article className="panel">
        <p className="eyebrow">Summary</p>
        <ul className="meta-list">
          <li>
            <span className="meta-label">Assignments</span>
            <span className="meta-value">{dashboard.summary.assignments}</span>
          </li>
          <li>
            <span className="meta-label">Queued performances</span>
            <span className="meta-value">{dashboard.summary.queuedPerformances}</span>
          </li>
          <li>
            <span className="meta-label">Submitted sheets</span>
            <span className="meta-value">{dashboard.summary.submittedSheets}</span>
          </li>
          <li>
            <span className="meta-label">Verified sheets</span>
            <span className="meta-value">{dashboard.summary.verifiedSheets}</span>
          </li>
        </ul>
      </article>
      <article className="panel">
        <p className="eyebrow">Validated backend</p>
        <h2>Score sheets and tapes</h2>
        <p className="lede">
          Hosted smoke validation already proved score sheets, caption totals, canonical tapes, packet
          completeness, and release visibility at the database layer.
        </p>
      </article>
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Queue routing</p>
            <h2>Open the next sheet from the overview queue</h2>
            <p className="lede">
              `/judge` is now the queue overview. Open a sheet to do the detailed scoring and audio work
              on the dedicated route.
            </p>
          </div>
        </div>

        <div className="ops-grid">
          {dashboard.assignments.map((assignment) => (
            <article className="ops-card" key={assignment.id}>
              <p className="eyebrow">
                {assignment.position} · {assignment.formType}
              </p>
              <h3>{assignment.eventName}</h3>
              <p className="lede">
                {assignment.siteName}
                {assignment.siteCity ? `, ${assignment.siteCity}` : ''} · {formatDate(assignment.eventStartDate)}
              </p>
              <div className="ops-card__value">{assignment.queue.length} performances</div>
              <div className="row-note">
                {assignment.dayStarts.length > 0
                  ? `First day start ${formatTime(assignment.dayStarts[0]?.startTime ?? null)}`
                  : 'Day starts not configured'}
              </div>
              <div className="pill-row">
                <span className="pill">{assignment.eventStatus}</span>
                <span className="pill">
                  {
                    assignment.queue.filter((item) => item.scoreSheetStatus === 'submitted').length
                  }{' '}
                  submitted
                </span>
                <span className="pill">
                  {
                    assignment.queue.filter((item) => item.scoreSheetStatus === 'verified').length
                  }{' '}
                  verified
                </span>
              </div>
              <ul className="plain-list" style={{ marginTop: '1rem' }}>
                {assignment.queue.slice(0, 3).map((item) => (
                  <li key={item.id}>
                    <strong>{formatTime(item.startTime)}</strong>: {item.schoolName} · {item.ensembleName}
                    <div className="row-note">
                      {item.scoreSheetStatus} · {item.tapeSegmentCount} segments ·{' '}
                      {item.hasCanonicalTape ? 'canonical ready' : 'no canonical tape'}
                    </div>
                    {item.eventEntryId ? (
                      <div className="action-row" style={{ marginTop: '0.4rem' }}>
                        <Link
                          href={`/judge/sheets/${assignment.id}/${item.eventEntryId}`}
                          className="button button-secondary button-tight"
                        >
                          Open sheet
                        </Link>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {assignment.queue.length > 3 ? (
                <p className="row-note">Plus {assignment.queue.length - 3} more scheduled performances.</p>
              ) : null}
            </article>
          ))}
        </div>
      </article>
    </DashboardShell>
  );
}
