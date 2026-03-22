import Link from 'next/link';

import { DashboardShell } from '@/components/dashboard-shell';
import { requireRole } from '@/lib/auth';
import { getDirectorEntryDetail } from '@/lib/director-dashboard';
import { SubmitButton } from '@/components/submit-button';

import {
  deleteDirectorInstrumentationAction,
  deleteDirectorPercussionRequestAction,
  deleteDirectorSeatingAction,
  saveDirectorRepertoireAction,
  upsertDirectorInstrumentationAction,
  upsertDirectorPercussionRequestAction,
  upsertDirectorSeatingAction,
  updateDirectorEntrySettingsAction,
} from '../../actions';

type DirectorEntryPageProps = {
  params: Promise<{ eventEntryId: string }>;
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

export default async function DirectorEntryPage({ params, searchParams }: DirectorEntryPageProps) {
  await requireRole(['director', 'admin']);
  const { eventEntryId } = await params;
  const query = searchParams ? await searchParams : undefined;
  const successMessage = typeof query?.success === 'string' ? query.success : null;
  const errorMessage = typeof query?.error === 'string' ? query.error : null;
  const entry = await getDirectorEntryDetail(eventEntryId);

  return (
    <DashboardShell
      roleLabel="Director Workspace"
      title={`${entry.schoolName} · ${entry.ensembleName}`}
      description="Focused director drill-down for event timing and released packet artifacts."
    >
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{entry.eventStatus}</p>
            <h2>
              {entry.schoolName} · {entry.ensembleName}
            </h2>
            <p className="lede">
              {entry.eventName} · {entry.siteName}
              {entry.siteCity ? `, ${entry.siteCity}` : ''} · {formatDate(entry.eventStartDate)}
              {entry.eventEndDate ? ` to ${formatDate(entry.eventEndDate)}` : ''} · Starts{' '}
              {formatTime(entry.eventScheduleStartTime)}
            </p>
          </div>
          <div className="action-row">
            <Link href="/director" className="button button-secondary button-tight">
              Back to entries
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

      <article className="panel">
        <p className="eyebrow">Entry status</p>
        <ul className="plain-list">
          <li>
            <strong>Grade</strong>: {entry.grade ?? 'Pending'}
          </li>
          <li>
            <strong>Mode</strong>: {entry.commentsOnly ? 'Comments Only' : 'Full adjudication'}
          </li>
          <li>
            <strong>Total members</strong>: {entry.totalMembers ?? 'Not entered'}
          </li>
          <li>
            <strong>Check-in</strong>: {entry.checkinCompleted ? 'Completed' : 'Pending'}
          </li>
          <li>
            <strong>Sight-reading</strong>:{' '}
            {entry.commentsOnly && entry.sightReadingOptedOut ? 'Opted out' : 'Expected'}
          </li>
        </ul>
      </article>

      <article className="panel">
        <p className="eyebrow">Assigned performance slot</p>
        {entry.assignedSlot ? (
          <ul className="plain-list">
            <li>
              <strong>Day</strong>: {formatDate(entry.assignedSlot.day)}
            </li>
            <li>
              <strong>Order</strong>: #{entry.assignedSlot.slotOrder}
            </li>
            <li>
              <strong>Estimated start</strong>: {formatTime(entry.assignedSlot.startTime)}
            </li>
          </ul>
        ) : (
          <p className="lede">No performance slot assigned yet.</p>
        )}
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Director editing</p>
            <h2>Entry settings and registration detail</h2>
            <p className="lede">
              These settings drive schedule context, sight-reading behavior, and grade derivation in the
              rebuild schema.
            </p>
          </div>
        </div>

        <div className="split-grid">
          <section className="subpanel">
            <p className="eyebrow">Entry settings</p>
            <form action={updateDirectorEntrySettingsAction} className="form-stack compact-form">
              <input type="hidden" name="eventEntryId" value={entry.id} />
              <label className="field">
                <span>Total members</span>
                <input
                  name="totalMembers"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={entry.totalMembers ?? ''}
                />
              </label>
              <label className="field">
                <span>Adjudication mode</span>
                <select
                  name="commentsOnly"
                  defaultValue={entry.commentsOnly ? 'true' : 'false'}
                >
                  <option value="false">Full adjudication</option>
                  <option value="true">Comments only</option>
                </select>
              </label>
              <label className="field">
                <span>Sight-reading</span>
                <select
                  name="sightReadingOptedOut"
                  defaultValue={entry.sightReadingOptedOut ? 'true' : 'false'}
                >
                  <option value="false">Expected</option>
                  <option value="true">Opted out</option>
                </select>
              </label>
              <p className="lede small-note">
                Sight-reading opt-out is only valid when the entry is comments only.
              </p>
              <SubmitButton idleLabel="Save settings" pendingLabel="Saving…" />
            </form>
          </section>

          <section className="subpanel">
            <p className="eyebrow">Repertoire</p>
            <form action={saveDirectorRepertoireAction} className="form-stack compact-form">
              <input type="hidden" name="eventEntryId" value={entry.id} />
              <label className="field">
                <span>March</span>
                <select name="marchId" defaultValue={entry.editable.repertoire.marchId}>
                  <option value="">Select march</option>
                  {entry.editable.options.marches.map((march) => (
                    <option key={march.id} value={march.id}>
                      {march.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Selection 1</span>
                <select name="selection1Id" defaultValue={entry.editable.repertoire.selection1Id}>
                  <option value="">Select graded piece</option>
                  {entry.editable.options.pieces.map((piece) => (
                    <option key={piece.id} value={piece.id}>
                      {piece.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Selection 2</span>
                <select name="selection2Id" defaultValue={entry.editable.repertoire.selection2Id}>
                  <option value="">Select graded piece</option>
                  {entry.editable.options.pieces.map((piece) => (
                    <option key={piece.id} value={piece.id}>
                      {piece.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="lede small-note">
                Grade derivation updates from repertoire choices in the database.
              </p>
              <SubmitButton idleLabel="Save repertoire" pendingLabel="Saving…" />
            </form>
          </section>
        </div>
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Registration detail</p>
            <h2>Instrumentation, seating, and percussion requests</h2>
            <p className="lede">
              Use this page to fill in the stage setup detail that chair and event staff need on event day.
            </p>
          </div>
        </div>

        <div className="split-grid">
          <section className="subpanel">
            <p className="eyebrow">Instrumentation</p>
            {entry.editable.instrumentation.length > 0 ? (
              <ul className="plain-list">
                {entry.editable.instrumentation.map((row) => (
                  <li key={row.id}>
                    <div>
                      <strong>
                        {row.instrumentName ?? row.customInstrumentName ?? 'Unknown instrument'}
                      </strong>
                      {row.instrumentFamilyName ? ` · ${row.instrumentFamilyName}` : ''}
                    </div>
                    <div className="row-note">
                      {row.playerCount} players
                      {row.notes ? ` · ${row.notes}` : ''}
                    </div>
                    <form action={deleteDirectorInstrumentationAction} className="inline-form">
                      <input type="hidden" name="eventEntryId" value={entry.id} />
                      <input type="hidden" name="instrumentationId" value={row.id} />
                      <button type="submit" className="button button-secondary button-tight">
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lede">No instrumentation rows saved yet.</p>
            )}

            <form action={upsertDirectorInstrumentationAction} className="form-stack compact-form">
              <input type="hidden" name="eventEntryId" value={entry.id} />
              <label className="field">
                <span>Standard instrument</span>
                <select name="instrumentId" defaultValue="">
                  <option value="">Select standard instrument</option>
                  {entry.editable.options.instruments.map((instrument) => (
                    <option key={instrument.id} value={instrument.id}>
                      {instrument.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Custom instrument name</span>
                <input
                  name="customInstrumentName"
                  type="text"
                  placeholder="Only use when the standard list does not fit"
                />
              </label>
              <label className="field">
                <span>Player count</span>
                <input name="playerCount" type="number" min="1" step="1" defaultValue="1" />
              </label>
              <label className="field">
                <span>Notes</span>
                <textarea
                  name="notes"
                  rows={3}
                  placeholder="Optional staffing or doubling notes"
                />
              </label>
              <p className="lede small-note">
                Use either a standard instrument or a custom instrument name, not both.
              </p>
              <SubmitButton idleLabel="Save instrumentation" pendingLabel="Saving…" />
            </form>
          </section>

          <section className="subpanel">
            <p className="eyebrow">Seating</p>
            {entry.editable.seating.length > 0 ? (
              <ul className="plain-list">
                {entry.editable.seating.map((row) => (
                  <li key={row.id}>
                    <div>
                      <strong>Row {row.rowNumber}</strong>
                    </div>
                    <div className="row-note">
                      {row.chairs} chairs · {row.stands} stands
                    </div>
                    <form action={deleteDirectorSeatingAction} className="inline-form">
                      <input type="hidden" name="eventEntryId" value={entry.id} />
                      <input type="hidden" name="seatingId" value={row.id} />
                      <button type="submit" className="button button-secondary button-tight">
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lede">No seating rows saved yet.</p>
            )}

            <form action={upsertDirectorSeatingAction} className="form-stack compact-form">
              <input type="hidden" name="eventEntryId" value={entry.id} />
              <label className="field">
                <span>Row number</span>
                <input name="rowNumber" type="number" min="1" step="1" defaultValue="1" />
              </label>
              <label className="field">
                <span>Chairs</span>
                <input name="chairs" type="number" min="0" step="1" defaultValue="0" />
              </label>
              <label className="field">
                <span>Stands</span>
                <input name="stands" type="number" min="0" step="1" defaultValue="0" />
              </label>
              <SubmitButton idleLabel="Save seating row" pendingLabel="Saving…" />
            </form>
          </section>
        </div>

        <div className="split-grid">
          <section className="subpanel">
            <p className="eyebrow">Site percussion requests</p>
            {entry.editable.percussionRequests.length > 0 ? (
              <ul className="plain-list">
                {entry.editable.percussionRequests.map((request) => (
                  <li key={request.inventoryItemId}>
                    <div>
                      <strong>{request.itemName}</strong>
                    </div>
                    <div className="row-note">
                      {request.notes ?? request.inventoryNotes ?? 'No notes'}
                    </div>
                    <form action={deleteDirectorPercussionRequestAction} className="inline-form">
                      <input type="hidden" name="eventEntryId" value={entry.id} />
                      <input type="hidden" name="inventoryItemId" value={request.inventoryItemId} />
                      <button type="submit" className="button button-secondary button-tight">
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lede">No percussion requests saved yet.</p>
            )}

            <form action={upsertDirectorPercussionRequestAction} className="form-stack compact-form">
              <input type="hidden" name="eventEntryId" value={entry.id} />
              <label className="field">
                <span>Inventory item</span>
                <select name="inventoryItemId" defaultValue="">
                  <option value="">Select site inventory</option>
                  {entry.editable.options.percussionInventory.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Notes</span>
                <textarea
                  name="notes"
                  rows={3}
                  placeholder="Optional quantity, mallet, or setup notes"
                />
              </label>
              <SubmitButton idleLabel="Save request" pendingLabel="Saving…" />
            </form>
          </section>

          <section className="subpanel">
            <p className="eyebrow">What this controls</p>
            <ul className="plain-list">
              <li>
                <strong>Instrumentation</strong>: player counts by instrument for registration accuracy.
              </li>
              <li>
                <strong>Seating</strong>: row-by-row chair and stand totals for stage setup.
              </li>
              <li>
                <strong>Percussion</strong>: site-provided gear requested ahead of the event.
              </li>
            </ul>
            <p className="lede small-note">
              This route is now the director-facing registration detail workspace. The next pass can focus on
              product polish instead of filling in missing backend connections.
            </p>
          </section>
        </div>
      </article>

      <article className="panel">
        <p className="eyebrow">Released packet</p>
        {entry.packet?.release_status === 'released' ? (
          <ul className="plain-list">
            <li>
              <strong>Overall rating</strong>: {entry.packet.overall_rating ?? 'Pending'}
            </li>
            <li>
              <strong>Assembly</strong>: {entry.packet.assembly_status}
            </li>
            <li>
              <strong>Released</strong>: {formatDate(entry.packet.released_at?.slice(0, 10) ?? null)}
            </li>
          </ul>
        ) : (
          <p className="lede">No released packet is visible for this entry yet.</p>
        )}
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Released packet</p>
            <h2>Official sheet and tape artifacts</h2>
          </div>
        </div>

        {entry.packet?.release_status === 'released' && entry.releasedPacketArtifacts.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Form</th>
                  <th>Sheet</th>
                  <th>Rating</th>
                  <th>Canonical tape</th>
                </tr>
              </thead>
              <tbody>
                {entry.releasedPacketArtifacts.map((artifact) => (
                  <tr key={artifact.scoreSheetId}>
                    <td>{artifact.judgePosition}</td>
                    <td>{artifact.formType}</td>
                    <td>
                      <div>
                        <span className={`status-chip status-${artifact.scoreSheetStatus}`}>
                          {artifact.scoreSheetStatus}
                        </span>
                      </div>
                      <div className="row-note">
                        Total {artifact.captionScoreTotal ?? 'Pending'} · Submitted{' '}
                        {formatDate(artifact.submittedAt?.slice(0, 10) ?? null)}
                      </div>
                    </td>
                    <td>
                      <div>{artifact.finalJudgeRating ?? 'Pending'}</div>
                      {artifact.verifiedAt ? (
                        <div className="row-note">
                          Verified {formatDate(artifact.verifiedAt.slice(0, 10))}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {artifact.canonicalTapeId ? (
                        <>
                          <div>
                            {artifact.canonicalTapeIsStitched ? 'Stitched tape' : 'Single-segment tape'}
                          </div>
                          <div className="row-note">
                            {artifact.canonicalTapeDurationSeconds
                              ? `${artifact.canonicalTapeDurationSeconds}s`
                              : 'Unknown duration'}
                          </div>
                          <div className="row-note">{artifact.canonicalTapeStoragePath}</div>
                          {artifact.canonicalTapeSignedUrl ? (
                            <div className="link-row">
                              <a
                                href={artifact.canonicalTapeSignedUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="app-nav__link app-nav__link--secondary"
                              >
                                Open audio
                              </a>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="row-note">No canonical tape visible</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="lede">Released packet artifacts are not available for this entry yet.</p>
        )}
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Event-day timeline</p>
            <h2>Schedule context</h2>
          </div>
        </div>

        {entry.dayStarts.length > 0 ? (
          <ul className="plain-list">
            {entry.dayStarts.map((dayStart) => (
              <li key={`${entry.id}-${dayStart.day}`}>
                <strong>{formatDate(dayStart.day)}</strong>: day starts at {formatTime(dayStart.startTime)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="lede">No event-day start times are published yet.</p>
        )}

        {entry.scheduleTimeline.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Order</th>
                  <th>Start</th>
                  <th>Slot</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {entry.scheduleTimeline.map((slot) => (
                  <tr key={slot.id}>
                    <td>{formatDate(slot.day)}</td>
                    <td>#{slot.slotOrder}</td>
                    <td>{formatTime(slot.startTime)}</td>
                    <td>
                      <span
                        className={`status-chip ${
                          slot.isCurrentEntry ? 'status-released' : 'status-setup'
                        }`}
                      >
                        {slot.isCurrentEntry ? 'Your performance' : slot.slotType}
                      </span>
                    </td>
                    <td>{slot.durationMinutes} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="lede">No schedule slots are available for this event yet.</p>
        )}
      </article>
    </DashboardShell>
  );
}
