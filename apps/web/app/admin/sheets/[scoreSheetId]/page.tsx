import Link from 'next/link';

import { DashboardShell } from '@/components/dashboard-shell';
import { SubmitButton } from '@/components/submit-button';
import { requireRole } from '@/lib/auth';
import { getAdminScoreSheetDetail } from '@/lib/admin-dashboard';

import { returnScoreSheetAction, verifyScoreSheetAction } from '../../actions';

type AdminScoreSheetPageProps = {
  params: Promise<{ scoreSheetId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return 'Pending';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDuration(value: number | null) {
  if (value == null) {
    return 'Unknown duration';
  }

  return `${value} sec`;
}

export default async function AdminScoreSheetPage({ params, searchParams }: AdminScoreSheetPageProps) {
  const { role } = await requireRole(['admin', 'chair']);
  const { scoreSheetId } = await params;
  const query = searchParams ? await searchParams : undefined;
  const returnTo = typeof query?.returnTo === 'string' ? query.returnTo : '/admin';
  const detail = await getAdminScoreSheetDetail(scoreSheetId);
  const ratedCaptions = detail.captions.filter((caption) => Boolean(caption.rating)).length;
  const commentedCaptions = detail.captions.filter((caption) => Boolean(caption.comment?.trim())).length;
  const captionsReady = ratedCaptions === detail.captions.length;
  const audioReady = detail.audio.tapeSegments.length > 0 && Boolean(detail.audio.canonicalTape);
  const packetReady = detail.packet?.assemblyStatus === 'complete';

  return (
    <DashboardShell
      roleLabel={role === 'admin' ? 'Admin Workspace' : 'Chair Workspace'}
      title="Score-sheet review"
      description="Inspect one submitted sheet with its caption ratings, comments, packet state, and audio metadata before verifying or returning it."
    >
      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Review target</p>
            <h2>
              {detail.entry.schoolName} · {detail.entry.ensembleName}
            </h2>
            <p className="lede">
              {detail.assignment.eventName} · {detail.assignment.siteName}
              {detail.assignment.siteCity ? `, ${detail.assignment.siteCity}` : ''} ·{' '}
              {detail.assignment.position} · {detail.assignment.judgeLabel}
            </p>
          </div>
          <div className="pill-row">
            <span className={`status-chip status-${detail.scoreSheet.status}`}>
              {detail.scoreSheet.status}
            </span>
            <span className="pill">{detail.assignment.formType}</span>
            <span className="pill">{detail.entry.grade ?? 'Grade pending'}</span>
            <span className={`status-chip ${captionsReady ? 'status-complete' : 'status-setup'}`}>
              {captionsReady ? 'Captions complete' : `${ratedCaptions}/${detail.captions.length} rated`}
            </span>
            <span className={`status-chip ${audioReady ? 'status-complete' : 'status-setup'}`}>
              {audioReady ? 'Audio ready' : 'Audio incomplete'}
            </span>
          </div>
        </div>

        <div className="action-row" style={{ marginTop: '1rem' }}>
          <Link href={returnTo} className="button button-secondary button-tight">
            Back to review queue
          </Link>
          <form action={verifyScoreSheetAction}>
            <input type="hidden" name="scoreSheetId" value={detail.scoreSheet.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <SubmitButton idleLabel="Verify sheet" pendingLabel="Working…" />
          </form>
          <form action={returnScoreSheetAction}>
            <input type="hidden" name="scoreSheetId" value={detail.scoreSheet.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <SubmitButton
              idleLabel="Return to judge"
              pendingLabel="Working…"
              className="button button-secondary"
            />
          </form>
        </div>
      </article>

      <article className="panel">
        <p className="eyebrow">Status</p>
        <ul className="meta-list">
          <li>
            <span className="meta-label">Submitted</span>
            <span className="meta-value">{formatDateTime(detail.scoreSheet.submittedAt)}</span>
          </li>
          <li>
            <span className="meta-label">Returned</span>
            <span className="meta-value">{formatDateTime(detail.scoreSheet.returnedAt)}</span>
          </li>
          <li>
            <span className="meta-label">Verified</span>
            <span className="meta-value">{formatDateTime(detail.scoreSheet.verifiedAt)}</span>
          </li>
          <li>
            <span className="meta-label">Verified by</span>
            <span className="meta-value">{detail.scoreSheet.verifiedByLabel ?? 'Pending'}</span>
          </li>
        </ul>
      </article>

      <article className="panel">
        <p className="eyebrow">Scoring</p>
        <ul className="meta-list">
          <li>
            <span className="meta-label">Caption total</span>
            <span className="meta-value">{detail.scoreSheet.captionScoreTotal ?? 'Pending'}</span>
          </li>
          <li>
            <span className="meta-label">Final judge rating</span>
            <span className="meta-value">{detail.scoreSheet.finalJudgeRating ?? 'Pending'}</span>
          </li>
          <li>
            <span className="meta-label">Comments only</span>
            <span className="meta-value">{detail.entry.commentsOnly ? 'Yes' : 'No'}</span>
          </li>
          <li>
            <span className="meta-label">Check-in</span>
            <span className="meta-value">{detail.entry.checkinCompleted ? 'Complete' : 'Pending'}</span>
          </li>
        </ul>
      </article>

      <article className="panel">
        <p className="eyebrow">Review checklist</p>
        <ul className="meta-list">
          <li>
            <span className="meta-label">Caption ratings</span>
            <span className="meta-value">
              {ratedCaptions}/{detail.captions.length}
            </span>
          </li>
          <li>
            <span className="meta-label">Comments entered</span>
            <span className="meta-value">
              {commentedCaptions}/{detail.captions.length}
            </span>
          </li>
          <li>
            <span className="meta-label">Tape segments</span>
            <span className="meta-value">{detail.audio.tapeSegments.length}</span>
          </li>
          <li>
            <span className="meta-label">Canonical tape</span>
            <span className="meta-value">{detail.audio.canonicalTape ? 'Ready' : 'Missing'}</span>
          </li>
        </ul>
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Review guide</p>
            <h2>Verify only when the packet path is complete</h2>
            <p className="lede">
              Confirm every caption is rated, confirm the audio artifacts exist, and only verify when the
              sheet no longer needs judge edits. Return it when scoring or audio is incomplete.
            </p>
          </div>
        </div>

        <div className="ops-grid">
          <article className="ops-card">
            <p className="eyebrow">Captions</p>
            <div className="ops-card__value">
              {ratedCaptions}/{detail.captions.length} rated
            </div>
            <div className="pill-row">
              <span className={`status-chip ${captionsReady ? 'status-complete' : 'status-setup'}`}>
                {captionsReady ? 'Ready to verify' : 'Needs rating review'}
              </span>
            </div>
          </article>

          <article className="ops-card">
            <p className="eyebrow">Audio</p>
            <div className="ops-card__value">
              {detail.audio.tapeSegments.length} segment{detail.audio.tapeSegments.length === 1 ? '' : 's'}
            </div>
            <div className="pill-row">
              <span className={`status-chip ${audioReady ? 'status-complete' : 'status-setup'}`}>
                {audioReady ? 'Canonical tape ready' : 'Audio still incomplete'}
              </span>
            </div>
          </article>

          <article className="ops-card">
            <p className="eyebrow">Packet</p>
            <div className="ops-card__value">
              {detail.packet?.assemblyStatus ?? 'No packet row'}
            </div>
            <div className="row-note">
              Release state: {detail.packet?.releaseStatus ?? 'Unknown'} · Overall{' '}
              {detail.packet?.overallRating ?? 'Pending'}
            </div>
            <div className="pill-row">
              <span className={`status-chip ${packetReady ? 'status-complete' : 'status-setup'}`}>
                {packetReady ? 'Packet complete' : 'Packet still blocked'}
              </span>
            </div>
          </article>

          <article className="ops-card">
            <p className="eyebrow">Decision</p>
            <div className="ops-card__value">
              {captionsReady && audioReady ? 'Verify candidate' : 'Return candidate'}
            </div>
            <div className="row-note">
              Verify when the sheet is final. Return when the judge still needs to correct scoring or audio.
            </div>
          </article>
        </div>
      </article>

      <article className="panel">
        <p className="eyebrow">Packet state</p>
        {detail.packet ? (
          <ul className="meta-list">
            <li>
              <span className="meta-label">Assembly</span>
              <span className="meta-value">{detail.packet.assemblyStatus}</span>
            </li>
            <li>
              <span className="meta-label">Release</span>
              <span className="meta-value">{detail.packet.releaseStatus}</span>
            </li>
            <li>
              <span className="meta-label">Overall rating</span>
              <span className="meta-value">{detail.packet.overallRating ?? 'Pending'}</span>
            </li>
          </ul>
        ) : (
          <p className="lede">No packet row is visible for this score sheet yet.</p>
        )}
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Captions</p>
            <h2>Judge rubric detail</h2>
            <p className="lede">
              Review each caption rating and written comment before final verification.
            </p>
          </div>
        </div>

        {detail.captions.length > 0 ? (
          <div className="caption-grid">
            {detail.captions.map((caption) => (
              <section className="subpanel judge-caption-card" key={caption.captionOrder}>
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Caption {caption.captionOrder}</p>
                    <h3>{caption.captionName}</h3>
                  </div>
                  <span
                    className={`status-chip ${caption.rating ? 'status-complete' : 'status-setup'}`}
                  >
                    {caption.rating
                      ? `${caption.rating}${caption.modifier && caption.modifier !== 'none' ? ` ${caption.modifier}` : ''}`
                      : 'Pending'}
                  </span>
                </div>
                <p className="lede">
                  {caption.comment?.trim() || 'No comment entered.'}
                </p>
              </section>
            ))}
          </div>
        ) : (
          <p className="lede">No caption rows are visible for this sheet yet.</p>
        )}
      </article>

      <article className="panel panel-wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Audio</p>
            <h2>Tape artifacts</h2>
            <p className="lede">
              Packet completeness depends on a canonical tape and the underlying tape segments.
            </p>
          </div>
        </div>

        <div className="split-grid">
          <section className="subpanel">
            <p className="eyebrow">Canonical tape</p>
            {detail.audio.canonicalTape ? (
              <ul className="meta-list">
                <li>
                  <span className="meta-label">Storage path</span>
                  <span className="meta-value">{detail.audio.canonicalTape.storagePath}</span>
                </li>
                <li>
                  <span className="meta-label">Duration</span>
                  <span className="meta-value">
                    {formatDuration(detail.audio.canonicalTape.durationSeconds)}
                  </span>
                </li>
                <li>
                  <span className="meta-label">Stitched</span>
                  <span className="meta-value">
                    {detail.audio.canonicalTape.isStitched ? 'Yes' : 'No'}
                  </span>
                </li>
                <li>
                  <span className="meta-label">Audio</span>
                  <span className="meta-value">
                    {detail.audio.canonicalTape.signedUrl ? (
                      <a href={detail.audio.canonicalTape.signedUrl} target="_blank" rel="noreferrer">
                        Open canonical tape
                      </a>
                    ) : (
                      'Signed link unavailable'
                    )}
                  </span>
                </li>
              </ul>
            ) : (
              <p className="lede">No canonical tape metadata is present yet.</p>
            )}
          </section>

          <section className="subpanel">
            <p className="eyebrow">Tape segments</p>
            {detail.audio.tapeSegments.length > 0 ? (
              <ul className="plain-list">
                {detail.audio.tapeSegments.map((segment) => (
                  <li key={segment.id}>
                    <strong>Segment {segment.segmentOrder}</strong>: {segment.storagePath}
                    <div className="row-note">{formatDuration(segment.durationSeconds)}</div>
                    {segment.signedUrl ? (
                      <div className="row-note">
                        <a href={segment.signedUrl} target="_blank" rel="noreferrer">
                          Open segment audio
                        </a>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lede">No tape segment metadata is present yet.</p>
            )}
          </section>
        </div>
      </article>
    </DashboardShell>
  );
}
