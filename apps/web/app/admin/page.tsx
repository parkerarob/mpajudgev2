import { DashboardShell } from '@/components/dashboard-shell';
import { SubmitButton } from '@/components/submit-button';
import { requireRole } from '@/lib/auth';
import { getAdminDashboardData, getAdminSetupOptions } from '@/lib/admin-dashboard';
import Link from 'next/link';

import {
  assignChairAction,
  assignDirectorSchoolAction,
  assignJudgeAction,
  createEventAction,
  createScheduleSlotAction,
  deleteScheduleSlotAction,
  returnScoreSheetAction,
  upsertEventDayStartAction,
  updatePacketReleaseAction,
  verifyScoreSheetAction,
} from './actions';

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

function formatTime(value: string) {
  const [hours, minutes] = value.split(':');
  const date = new Date(Date.UTC(2000, 0, 1, Number(hours), Number(minutes)));
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function eventEntryOptionLabel(entry: {
  grade: string | null;
  comments_only: boolean;
  ensembles:
    | {
        name: string;
        schools: { name: string } | { name: string }[] | null;
      }
    | {
        name: string;
        schools: { name: string } | { name: string }[] | null;
      }[]
    | null;
}) {
  const ensemble = Array.isArray(entry.ensembles) ? entry.ensembles[0] : entry.ensembles;
  const school = ensemble?.schools
    ? Array.isArray(ensemble.schools)
      ? ensemble.schools[0]
      : ensemble.schools
    : null;
  return `${school?.name ?? 'Unknown school'} · ${ensemble?.name ?? 'Unknown ensemble'}${entry.grade ? ` · ${entry.grade}` : ''}${entry.comments_only ? ' · Comments Only' : ''}`;
}

type AdminPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getStatusCount(
  scoreSheets: Array<{
    status: string;
  }>,
  status: string
) {
  return scoreSheets.filter((sheet) => sheet.status === status).length;
}

function getDistinctCount(values: string[]) {
  return new Set(values).size;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const { profile, role } = await requireRole(['admin', 'chair']);
  const dashboard = await getAdminDashboardData();
  const setupOptions = role === 'admin' ? await getAdminSetupOptions() : null;
  const params = searchParams ? await searchParams : undefined;
  const successMessage = typeof params?.success === 'string' ? params.success : null;
  const errorMessage = typeof params?.error === 'string' ? params.error : null;
  const selectedEventId = typeof params?.event === 'string' ? params.event : 'all';
  const selectedSheetStatus = typeof params?.sheetStatus === 'string' ? params.sheetStatus : 'attention';
  const visibleEvents =
    selectedEventId === 'all'
      ? dashboard.events
      : dashboard.events.filter((event) => event.id === selectedEventId);

  return (
    <DashboardShell
      roleLabel={role === 'admin' ? 'Admin Workspace' : 'Chair Workspace'}
      title="Event operations shell"
      description="This is the rebuild landing zone for event setup, assignment visibility, packet review, and release controls against the hosted Supabase schema."
    >
      <article className="panel">
        <p className="eyebrow">Operator</p>
        <h2>{profile?.display_name ?? 'Unknown user'}</h2>
        <p className="lede">{profile?.email ?? 'No email available'}</p>
      </article>
      <article className="panel">
        <p className="eyebrow">Current scope</p>
        <h2>Live hosted read path</h2>
        <p className="lede">
          This page now reads real event, assignment, and packet data from the hosted rebuild database
          and sends release changes through the real `release_packet` / `unrelease_packet` RPCs.
        </p>
      </article>
      <article className="panel">
        <p className="eyebrow">Summary</p>
        <ul className="meta-list">
          <li>
            <span className="meta-label">Events</span>
            <span className="meta-value">{dashboard.summary.events}</span>
          </li>
          <li>
            <span className="meta-label">Packets</span>
            <span className="meta-value">{dashboard.summary.packets}</span>
          </li>
          <li>
            <span className="meta-label">Complete</span>
            <span className="meta-value">{dashboard.summary.completePackets}</span>
          </li>
          <li>
            <span className="meta-label">Released</span>
            <span className="meta-value">{dashboard.summary.releasedPackets}</span>
          </li>
        </ul>
      </article>
      {successMessage ? (
        <article className="panel panel-success">
          <p className="eyebrow">Success</p>
          <p className="lede">{successMessage}</p>
        </article>
      ) : null}
      {errorMessage ? (
        <article className="panel panel-error">
          <p className="eyebrow">Action blocked</p>
          <p className="lede">{errorMessage}</p>
        </article>
      ) : null}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Live review filters</p>
            <h2>Score-sheet triage</h2>
            <p className="lede">
              Filter the admin review surface by event and score-sheet state so submitted and returned
              work stays visible during live operations.
            </p>
          </div>
        </div>
        <form className="filter-row" method="get">
          <label className="field">
            <span>Event</span>
            <select name="event" defaultValue={selectedEventId}>
              <option value="all">All events</option>
              {dashboard.events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Score-sheet state</span>
            <select name="sheetStatus" defaultValue={selectedSheetStatus}>
              <option value="attention">Needs attention</option>
              <option value="submitted">Submitted</option>
              <option value="returned">Returned</option>
              <option value="verified">Verified</option>
              <option value="all">All sheets</option>
            </select>
          </label>
          <button type="submit" className="button">
            Apply filters
          </button>
        </form>
      </article>
      {role === 'admin' && setupOptions ? (
        <>
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Event Setup</p>
              <h2>Create and staff events</h2>
              <p className="lede">
                This is the first rebuild setup surface: create an event, add chair roles, and assign
                judges by fixed event position.
              </p>
            </div>
          </div>

          <div className="setup-grid">
            <section className="subpanel">
              <p className="eyebrow">Create Event</p>
              <form action={createEventAction} className="form-stack compact-form">
                <label className="field">
                  <span>Event name</span>
                  <input name="name" type="text" required />
                </label>
                <label className="field">
                  <span>Season year</span>
                  <input name="seasonYear" type="text" placeholder="2026-2027" required />
                </label>
                <label className="field">
                  <span>District</span>
                  <select name="districtId" required>
                    <option value="">Select district</option>
                    {setupOptions.districts.map((district) => (
                      <option key={district.id} value={district.id}>
                        {district.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Site</span>
                  <select name="siteId" required>
                    <option value="">Select site</option>
                    {setupOptions.sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                        {site.city ? ` (${site.city})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Graded list version</span>
                  <select name="gradedListVersionId" required>
                    <option value="">Select version</option>
                    {setupOptions.gradedListVersions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.label}
                        {version.is_current ? ' (current)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Start date</span>
                  <input name="startDate" type="date" required />
                </label>
                <label className="field">
                  <span>End date</span>
                  <input name="endDate" type="date" />
                </label>
                <label className="field">
                  <span>Schedule start time</span>
                  <input name="scheduleStartTime" type="time" required />
                </label>
                <SubmitButton idleLabel="Create event" pendingLabel="Creating…" />
              </form>
            </section>

            <section className="subpanel">
              <p className="eyebrow">Assign Chair</p>
              <form action={assignChairAction} className="form-stack compact-form">
                <label className="field">
                  <span>Event</span>
                  <select name="eventId" required>
                    <option value="">Select event</option>
                    {dashboard.events.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>User</span>
                  <select name="userId" required>
                    <option value="">Select user</option>
                    {setupOptions.users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.display_name || user.email || user.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Chair role</span>
                  <select name="role" required defaultValue="chair">
                    <option value="chair">chair</option>
                    <option value="site_chair">site_chair</option>
                  </select>
                </label>
                <SubmitButton idleLabel="Add chair" pendingLabel="Saving…" />
              </form>
            </section>

            <section className="subpanel">
              <p className="eyebrow">Assign Judge</p>
              <form action={assignJudgeAction} className="form-stack compact-form">
                <label className="field">
                  <span>Event</span>
                  <select name="eventId" required>
                    <option value="">Select event</option>
                    {dashboard.events.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>User</span>
                  <select name="userId" required>
                    <option value="">Select user</option>
                    {setupOptions.users
                      .filter((user) => !user.is_admin)
                      .map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.display_name || user.email || user.id}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span>Position</span>
                  <select name="position" required defaultValue="stage1">
                    <option value="stage1">stage1</option>
                    <option value="stage2">stage2</option>
                    <option value="stage3">stage3</option>
                    <option value="sight_reading">sight_reading</option>
                  </select>
                </label>
                <p className="lede small-note">
                  Saving a position replaces any existing assignment for that event position and removes
                  any other position already held by the same judge in that event.
                </p>
                <SubmitButton idleLabel="Save assignment" pendingLabel="Saving…" />
              </form>
            </section>

            <section className="subpanel">
              <p className="eyebrow">Assign Director</p>
              <form action={assignDirectorSchoolAction} className="form-stack compact-form">
                <label className="field">
                  <span>User</span>
                  <select name="userId" required>
                    <option value="">Select user</option>
                    {setupOptions.users
                      .filter((user) => !user.is_admin)
                      .map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.display_name || user.email || user.id}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span>School</span>
                  <select name="schoolId" required>
                    <option value="">Select school</option>
                    {setupOptions.schools.map((school) => (
                      <option key={school.id} value={school.id}>
                        {school.name} · {school.districtName}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="lede small-note">
                  A director becomes active in the rebuild app when they are linked to at least one
                  school.
                </p>
                <SubmitButton idleLabel="Assign director" pendingLabel="Saving…" />
              </form>
            </section>

            <section className="subpanel">
              <p className="eyebrow">Day Start</p>
              <form action={upsertEventDayStartAction} className="form-stack compact-form">
                <label className="field">
                  <span>Event</span>
                  <select name="eventId" required>
                    <option value="">Select event</option>
                    {dashboard.events.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Day</span>
                  <input name="day" type="date" required />
                </label>
                <label className="field">
                  <span>Start time</span>
                  <input name="startTime" type="time" required />
                </label>
                <SubmitButton idleLabel="Save day start" pendingLabel="Saving…" />
              </form>
            </section>

            <section className="subpanel">
              <p className="eyebrow">Schedule Slot</p>
              <form action={createScheduleSlotAction} className="form-stack compact-form">
                <label className="field">
                  <span>Event</span>
                  <select name="eventId" required>
                    <option value="">Select event</option>
                    {dashboard.events.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Day</span>
                  <input name="day" type="date" required />
                </label>
                <label className="field">
                  <span>Slot order</span>
                  <input name="slotOrder" type="number" min="1" step="1" required />
                </label>
                <label className="field">
                  <span>Slot type</span>
                  <select name="slotType" required defaultValue="performance">
                    <option value="performance">performance</option>
                    <option value="break">break</option>
                  </select>
                </label>
                <label className="field">
                  <span>Performance entry</span>
                  <select name="eventEntryId">
                    <option value="">Select event entry</option>
                    {setupOptions.eventEntries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {eventEntryOptionLabel(entry)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Break duration minutes</span>
                  <input name="breakDurationMinutes" type="number" min="1" step="1" />
                </label>
                <p className="lede small-note">
                  For `performance`, choose an event entry. For `break`, leave the entry blank and enter
                  the break duration.
                </p>
                <SubmitButton idleLabel="Add slot" pendingLabel="Saving…" />
              </form>
            </section>
          </div>
        </article>
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Role Roster</p>
              <h2>Current rebuild access</h2>
              <p className="lede">
                Use this to confirm who currently has director, judge, and chair access in the rebuild
                app after onboarding or assignment changes.
              </p>
            </div>
          </div>

          <div className="split-grid">
            <section className="subpanel">
              <p className="eyebrow">Directors</p>
              {dashboard.roleRoster.directors.length > 0 ? (
                <ul className="plain-list">
                  {dashboard.roleRoster.directors.map((director) => (
                    <li key={director.userId}>
                      <strong>{director.label}</strong>
                      <div className="row-note">{director.schools.join(', ')}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lede">No directors are assigned to schools yet.</p>
              )}
            </section>

            <section className="subpanel">
              <p className="eyebrow">Judges</p>
              {dashboard.roleRoster.judges.length > 0 ? (
                <ul className="plain-list">
                  {dashboard.roleRoster.judges.map((judge) => (
                    <li key={judge.userId}>{judge.label}</li>
                  ))}
                </ul>
              ) : (
                <p className="lede">No judges are assigned yet.</p>
              )}
            </section>

            <section className="subpanel">
              <p className="eyebrow">Chairs</p>
              {dashboard.roleRoster.chairs.length > 0 ? (
                <ul className="plain-list">
                  {dashboard.roleRoster.chairs.map((chair) => (
                    <li key={chair.userId}>{chair.label}</li>
                  ))}
                </ul>
              ) : (
                <p className="lede">No chair roles are assigned yet.</p>
              )}
            </section>
          </div>
        </article>
        </>
      ) : null}
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Event routing</p>
            <h2>Open a focused event workspace</h2>
            <p className="lede">
              `/admin` now acts as the routing and oversight surface. Use the event drill-down for
              staffing, schedule edits, score-sheet review, and packet release work.
            </p>
          </div>
        </div>

        <div className="ops-grid">
          {visibleEvents.map((event) => {
            const filteredScoreSheets = event.scoreSheets.filter((sheet) => {
              if (selectedSheetStatus === 'all') {
                return true;
              }
              if (selectedSheetStatus === 'attention') {
                return sheet.status === 'submitted' || sheet.status === 'returned';
              }
              return sheet.status === selectedSheetStatus;
            });

            const assignedJudgeCount = getDistinctCount(
              event.assignments.map((assignment) => assignment.userId)
            );
            const chairCount = getDistinctCount(event.chairs.map((chair) => chair.userId));
            const scheduledPerformanceCount = event.scheduleSlots.filter(
              (slot) => slot.slotType === 'performance' && slot.eventEntryId
            ).length;
            const completePacketCount = event.packets.filter(
              (packet) => packet.assemblyStatus === 'complete'
            ).length;
            const releaseReady =
              event.packets.length > 0 && completePacketCount === event.packets.length;

            return (
              <article className="ops-card" key={event.id}>
                <p className="eyebrow">{event.status}</p>
                <h3>{event.name}</h3>
                <p className="lede">
                  {event.districtName} · {event.siteName}
                  {event.siteCity ? `, ${event.siteCity}` : ''} · {formatDate(event.startDate)}
                </p>
                <div className="ops-card__value">
                  {filteredScoreSheets.length} filtered sheets · {event.packets.length} packets
                </div>
                <div className="row-note">
                  {assignedJudgeCount}/4 judges · {chairCount} chairs · {scheduledPerformanceCount}{' '}
                  scheduled performances
                </div>
                <div className="pill-row">
                  <span className={`status-chip ${releaseReady ? 'status-complete' : 'status-setup'}`}>
                    {releaseReady ? 'Release eligible' : 'Release blocked'}
                  </span>
                  <span className="status-chip status-setup">
                    {getStatusCount(event.scoreSheets, 'submitted')} submitted
                  </span>
                  <span className="status-chip status-setup">
                    {getStatusCount(event.scoreSheets, 'returned')} returned
                  </span>
                </div>
                <div className="action-row" style={{ marginTop: '1rem' }}>
                  <Link
                    href={`/admin/events/${event.id}`}
                    className="button button-secondary button-tight"
                  >
                    Open event ops
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </article>
    </DashboardShell>
  );
}
