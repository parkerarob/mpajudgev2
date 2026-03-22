import Link from 'next/link';

import { DashboardShell } from '@/components/dashboard-shell';
import { SubmitButton } from '@/components/submit-button';
import { requireRole } from '@/lib/auth';
import { getAdminEventDetail, getAdminSetupOptions } from '@/lib/admin-dashboard';

import {
  assignChairAction,
  assignJudgeAction,
  createScheduleSlotAction,
  deleteScheduleSlotAction,
  returnScoreSheetAction,
  upsertEventDayStartAction,
  updatePacketReleaseAction,
  verifyScoreSheetAction,
} from '../../actions';

type AdminEventPageProps = {
  params: Promise<{ eventId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

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

export default async function AdminEventPage({ params, searchParams }: AdminEventPageProps) {
  const { role } = await requireRole(['admin', 'chair']);
  const { eventId } = await params;
  const event = await getAdminEventDetail(eventId);
  const setupOptions = role === 'admin' ? await getAdminSetupOptions() : null;
  const query = searchParams ? await searchParams : undefined;
  const successMessage = typeof query?.success === 'string' ? query.success : null;
  const errorMessage = typeof query?.error === 'string' ? query.error : null;
  const returnTo = `/admin/events/${event.id}`;

  const assignedJudgeCount = getDistinctCount(event.assignments.map((assignment) => assignment.userId));
  const chairCount = getDistinctCount(event.chairs.map((chair) => chair.userId));
  const scheduledPerformanceCount = event.scheduleSlots.filter(
    (slot) => slot.slotType === 'performance' && slot.eventEntryId
  ).length;
  const completePacketCount = event.packets.filter(
    (packet) => packet.assemblyStatus === 'complete'
  ).length;
  const releasedPacketCount = event.packets.filter(
    (packet) => packet.releaseStatus === 'released'
  ).length;
  const attentionCount = event.scoreSheets.filter(
    (sheet) => sheet.status === 'submitted' || sheet.status === 'returned'
  ).length;
  const prioritySheets = event.scoreSheets.filter(
    (sheet) => sheet.status === 'submitted' || sheet.status === 'returned'
  );
  const blockedPackets = event.packets.filter((packet) => packet.assemblyStatus !== 'complete');
  const releasablePackets = event.packets.filter(
    (packet) => packet.assemblyStatus === 'complete' && packet.releaseStatus !== 'released'
  );
  const judgeCoverageReady = event.assignments.length === 4;
  const chairCoverageReady = chairCount > 0;
  const scheduleReady = scheduledPerformanceCount > 0 && event.dayStarts.length > 0;
  const releaseReady = event.packets.length > 0 && completePacketCount === event.packets.length;

  return (
    <DashboardShell
      roleLabel={role === 'admin' ? 'Admin Workspace' : 'Chair Workspace'}
      title={`${event.name} operations`}
      description="Focused event drill-down for staffing, schedule readiness, score-sheet review, and packet release."
    >
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{event.status}</p>
            <h2>{event.name}</h2>
            <p className="lede">
              {event.districtName} · {event.siteName}
              {event.siteCity ? `, ${event.siteCity}` : ''} · {formatDate(event.startDate)}
              {event.endDate ? ` to ${formatDate(event.endDate)}` : ''} · Starts{' '}
              {formatTime(event.scheduleStartTime)}
            </p>
          </div>
          <div className="action-row">
            <Link href="/admin" className="button button-secondary button-tight">
              Back to all events
            </Link>
          </div>
        </div>
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
            <p className="eyebrow">Event ops snapshot</p>
            <h2>Staffing, schedule, and release readiness</h2>
          </div>
          <div className="pill-row">
            <span className="pill">{event.seasonYear}</span>
            <span className="pill">{event.packets.length} packets</span>
            <span className="pill">{attentionCount} need attention</span>
          </div>
        </div>

        <div className="ops-grid">
          <article className="ops-card">
            <p className="eyebrow">Coverage</p>
            <div className="ops-card__value">
              {assignedJudgeCount}/4 judges · {chairCount} chair{chairCount === 1 ? '' : 's'}
            </div>
            <div className="pill-row">
              <span className={`status-chip ${judgeCoverageReady ? 'status-complete' : 'status-setup'}`}>
                {judgeCoverageReady ? 'Judge coverage ready' : 'Judge coverage pending'}
              </span>
              <span className={`status-chip ${chairCoverageReady ? 'status-complete' : 'status-setup'}`}>
                {chairCoverageReady ? 'Chair assigned' : 'Chair missing'}
              </span>
            </div>
          </article>

          <article className="ops-card">
            <p className="eyebrow">Schedule</p>
            <div className="ops-card__value">
              {scheduledPerformanceCount} performance slot{scheduledPerformanceCount === 1 ? '' : 's'}
            </div>
            <div className="row-note">
              {event.dayStarts.length} day start{event.dayStarts.length === 1 ? '' : 's'} configured
            </div>
            <div className="pill-row">
              <span className={`status-chip ${scheduleReady ? 'status-complete' : 'status-setup'}`}>
                {scheduleReady ? 'Schedule live' : 'Schedule incomplete'}
              </span>
            </div>
          </article>

          <article className="ops-card">
            <p className="eyebrow">Review queue</p>
            <div className="ops-card__value">{attentionCount} need attention</div>
            <div className="row-note">
              {getStatusCount(event.scoreSheets, 'submitted')} submitted ·{' '}
              {getStatusCount(event.scoreSheets, 'returned')} returned ·{' '}
              {getStatusCount(event.scoreSheets, 'verified')} verified
            </div>
          </article>

          <article className="ops-card">
            <p className="eyebrow">Packets</p>
            <div className="ops-card__value">
              {completePacketCount}/{event.packets.length} complete · {releasedPacketCount} released
            </div>
            <div className="pill-row">
              <span className={`status-chip ${releaseReady ? 'status-complete' : 'status-setup'}`}>
                {releaseReady ? 'Release eligible' : 'Release still blocked'}
              </span>
            </div>
          </article>
        </div>
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Priority lanes</p>
            <h2>What needs action right now</h2>
            <p className="lede">
              Use this section first during live operations. It pulls the blocked review and release work
              to the top before the full detail tables below.
            </p>
          </div>
        </div>

        <div className="split-grid">
          <section className="subpanel">
            <p className="eyebrow">Review now</p>
            {prioritySheets.length > 0 ? (
              <ul className="plain-list">
                {prioritySheets.slice(0, 6).map((sheet) => (
                  <li key={sheet.id}>
                    <strong>{sheet.schoolName}</strong> · {sheet.ensembleName}
                    <div className="row-note">
                      {sheet.judgeLabel} · {sheet.position} · {sheet.status}
                    </div>
                    <div className="action-row" style={{ marginTop: '0.35rem' }}>
                      <Link
                        href={`/admin/sheets/${sheet.id}?returnTo=${encodeURIComponent(returnTo)}`}
                        className="button button-secondary button-tight"
                      >
                        Review sheet
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lede">No submitted or returned sheets are waiting right now.</p>
            )}
          </section>

          <section className="subpanel">
            <p className="eyebrow">Release now</p>
            {releasablePackets.length > 0 ? (
              <ul className="plain-list">
                {releasablePackets.slice(0, 6).map((packet) => (
                  <li key={packet.id}>
                    <strong>{packet.schoolName}</strong> · {packet.ensembleName}
                    <div className="row-note">
                      {packet.commentsOnly ? 'Comments Only' : packet.grade ?? 'Grade pending'} ·{' '}
                      {packet.assemblyStatus}
                    </div>
                    <form action={updatePacketReleaseAction} className="action-row" style={{ marginTop: '0.35rem' }}>
                      <input type="hidden" name="packetId" value={packet.id} />
                      <input type="hidden" name="nextReleaseState" value="released" />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <SubmitButton
                        idleLabel="Release packet"
                        pendingLabel="Working…"
                        className="button button-tight"
                      />
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lede">No completed unreleased packets are waiting right now.</p>
            )}
          </section>

          <section className="subpanel">
            <p className="eyebrow">Blocked packets</p>
            {blockedPackets.length > 0 ? (
              <ul className="plain-list">
                {blockedPackets.slice(0, 6).map((packet) => (
                  <li key={packet.id}>
                    <strong>{packet.schoolName}</strong> · {packet.ensembleName}
                    <div className="row-note">
                      {packet.assemblyStatus} · {packet.checkinCompleted ? 'Checked in' : 'Check-in pending'}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lede">No packets are currently blocked.</p>
            )}
          </section>
        </div>
      </article>

      <div className="split-grid panel-wide">
        <section className="panel">
          <p className="eyebrow">Chairs</p>
          {event.chairs.length > 0 ? (
            <ul className="plain-list">
              {event.chairs.map((chair) => (
                <li key={`${chair.userId}-${chair.role}`}>
                  <strong>{chair.role}</strong>: {chair.label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="lede">No chair assignments visible yet.</p>
          )}
        </section>

        <section className="panel">
          <p className="eyebrow">Judge positions</p>
          {event.assignments.length > 0 ? (
            <ul className="plain-list">
              {event.assignments.map((assignment) => (
                <li key={assignment.id}>
                  <strong>{assignment.position}</strong>: {assignment.label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="lede">No judge assignments visible yet.</p>
          )}
        </section>
      </div>

      {role === 'admin' && setupOptions ? (
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Focused setup</p>
              <h2>Staff and schedule this event</h2>
            </div>
          </div>

          <div className="setup-grid">
            <section className="subpanel">
              <p className="eyebrow">Assign Chair</p>
              <form action={assignChairAction} className="form-stack compact-form">
                <input type="hidden" name="eventId" value={event.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
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
                <input type="hidden" name="eventId" value={event.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
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
                <SubmitButton idleLabel="Save assignment" pendingLabel="Saving…" />
              </form>
            </section>

            <section className="subpanel">
              <p className="eyebrow">Day Start</p>
              <form action={upsertEventDayStartAction} className="form-stack compact-form">
                <input type="hidden" name="eventId" value={event.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
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
                <input type="hidden" name="eventId" value={event.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
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
                    {setupOptions.eventEntries
                      .filter((entry) => entry.event_id === event.id)
                      .map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.grade ?? 'Grade pending'} · {entry.comments_only ? 'Comments Only' : 'Full adjudication'}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span>Break duration minutes</span>
                  <input name="breakDurationMinutes" type="number" min="1" step="1" />
                </label>
                <SubmitButton idleLabel="Add slot" pendingLabel="Saving…" />
              </form>
            </section>
          </div>
        </article>
      ) : null}

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Schedule</p>
            <h2>Day starts and ordered slots</h2>
          </div>
        </div>

        <div className="split-grid">
          <section className="subpanel">
            <p className="eyebrow">Day starts</p>
            {event.dayStarts.length > 0 ? (
              <ul className="plain-list">
                {event.dayStarts.map((dayStart) => (
                  <li key={`${event.id}-${dayStart.day}`}>
                    <strong>{formatDate(dayStart.day)}</strong>: {formatTime(dayStart.startTime)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lede">No event-day start times set yet.</p>
            )}
          </section>

          <section className="subpanel">
            <p className="eyebrow">Ordered slots</p>
            {event.scheduleSlots.length > 0 ? (
              <ul className="plain-list">
                {event.scheduleSlots.map((slot) => (
                  <li key={slot.id}>
                    <strong>
                      {formatDate(slot.day)} · #{slot.slotOrder}
                    </strong>
                    : {slot.label}
                    <form action={deleteScheduleSlotAction} className="inline-form">
                      <input type="hidden" name="slotId" value={slot.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button type="submit" className="link-button">
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lede">No schedule slots set yet.</p>
            )}
          </section>
        </div>
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Score-sheet review</p>
            <h2>Verify or return submitted sheets</h2>
          </div>
        </div>

        {event.scoreSheets.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>School</th>
                  <th>Ensemble</th>
                  <th>Judge</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Rating</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {event.scoreSheets.map((sheet) => (
                  <tr key={sheet.id}>
                    <td>{sheet.schoolName}</td>
                    <td>{sheet.ensembleName}</td>
                    <td>
                      <div>{sheet.judgeLabel}</div>
                      <div className="row-note">{sheet.position}</div>
                    </td>
                    <td>
                      <span className={`status-chip status-${sheet.status}`}>{sheet.status}</span>
                    </td>
                    <td>{sheet.captionScoreTotal ?? 'Pending'}</td>
                    <td>{sheet.finalJudgeRating ?? 'Pending'}</td>
                    <td>
                      <div className="action-column">
                        <Link
                          href={`/admin/sheets/${sheet.id}?returnTo=${encodeURIComponent(returnTo)}`}
                          className="button button-secondary button-tight"
                        >
                          Review
                        </Link>
                        <form action={verifyScoreSheetAction}>
                          <input type="hidden" name="scoreSheetId" value={sheet.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <SubmitButton
                            idleLabel="Verify"
                            pendingLabel="Working…"
                            className="button button-tight"
                          />
                        </form>
                        <form action={returnScoreSheetAction}>
                          <input type="hidden" name="scoreSheetId" value={sheet.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <SubmitButton
                            idleLabel="Return"
                            pendingLabel="Working…"
                            className="button button-secondary button-tight"
                          />
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="lede">No score sheets are visible for this event yet.</p>
        )}
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Packet control</p>
            <h2>Release boundary</h2>
          </div>
        </div>

        {event.packets.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>School</th>
                  <th>Ensemble</th>
                  <th>Grade</th>
                  <th>Assembly</th>
                  <th>Release</th>
                  <th>Overall</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {event.packets.map((packet) => {
                  const nextReleaseState =
                    packet.releaseStatus === 'released' ? 'unreleased' : 'released';

                  return (
                    <tr key={packet.id}>
                      <td>{packet.schoolName}</td>
                      <td>
                        <div>{packet.ensembleName}</div>
                        <div className="row-note">
                          {packet.commentsOnly ? 'Comments Only' : packet.grade ?? 'Grade pending'}
                          {' · '}
                          {packet.checkinCompleted ? 'Checked in' : 'Check-in pending'}
                        </div>
                      </td>
                      <td>{packet.grade ?? 'Pending'}</td>
                      <td>
                        <span className={`status-chip status-${packet.assemblyStatus}`}>
                          {packet.assemblyStatus}
                        </span>
                      </td>
                      <td>
                        <span className={`status-chip status-${packet.releaseStatus}`}>
                          {packet.releaseStatus}
                        </span>
                      </td>
                      <td>{packet.overallRating ?? 'Pending'}</td>
                      <td>
                        <form action={updatePacketReleaseAction}>
                          <input type="hidden" name="packetId" value={packet.id} />
                          <input type="hidden" name="nextReleaseState" value={nextReleaseState} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <SubmitButton
                            idleLabel={
                              packet.releaseStatus === 'released' ? 'Unrelease' : 'Release'
                            }
                            pendingLabel="Working…"
                          />
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="lede">No packets are visible for this event yet.</p>
        )}
      </article>
    </DashboardShell>
  );
}
