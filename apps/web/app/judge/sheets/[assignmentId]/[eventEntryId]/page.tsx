import Link from 'next/link';

import { JudgeAudioUpload } from '@/components/judge-audio-upload';
import { SubmitButton } from '@/components/submit-button';
import { requireRole } from '@/lib/auth';
import { getJudgeSheetData } from '@/lib/judge-sheet';

import { saveJudgeSheetAction } from '@/app/judge/actions';

function formatDate(value: string | null) {
  if (!value) return 'Not scheduled';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00Z`));
}

type JudgeSheetPageProps = {
  params: Promise<{ assignmentId: string; eventEntryId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function JudgeSheetPage({ params, searchParams }: JudgeSheetPageProps) {
  await requireRole(['judge', 'admin']);
  const { assignmentId, eventEntryId } = await params;
  const data = await getJudgeSheetData(assignmentId, eventEntryId);
  const query = searchParams ? await searchParams : undefined;
  const successMessage = typeof query?.success === 'string' ? query.success : null;
  const errorMessage = typeof query?.error === 'string' ? query.error : null;
  const ratedCaptions = data.captions.filter((caption) => Boolean(caption.rating)).length;
  const commentedCaptions = data.captions.filter((caption) => Boolean(caption.comment.trim())).length;
  const captionReady = ratedCaptions === data.captions.length;
  const audioReady = data.audio.tapeSegments.length > 0 && Boolean(data.audio.canonicalTape);

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">
          {data.assignment.position} · {data.assignment.formType}
        </p>
        <h1>
          {data.entry.schoolName} · {data.entry.ensembleName}
        </h1>
        <p className="lede">
          {data.assignment.eventName} · {data.assignment.siteName}
          {data.assignment.siteCity ? `, ${data.assignment.siteCity}` : ''} · {formatDate(data.assignment.eventStartDate)}
        </p>
        <div className="action-row">
          <Link href="/judge" className="button button-secondary button-tight">
            Back to judge queue
          </Link>
          <span className={`status-chip ${captionReady ? 'status-complete' : 'status-setup'}`}>
            {captionReady ? 'Captions complete' : `${ratedCaptions}/${data.captions.length} captions rated`}
          </span>
          <span className={`status-chip ${audioReady ? 'status-complete' : 'status-setup'}`}>
            {audioReady ? 'Audio ready' : 'Audio incomplete'}
          </span>
        </div>
      </section>

      <section className="grid">
        <article className="panel">
          <p className="eyebrow">Sheet status</p>
          <h2>{data.sheet?.status ?? 'draft'}</h2>
          <p className="lede">
            {data.sheet?.captionScoreTotal
              ? `Current total ${data.sheet.captionScoreTotal}; final judge rating ${data.sheet.finalJudgeRating ?? 'pending'}.`
              : 'Caption total and final judge rating compute automatically after all seven ratings are present.'}
          </p>
        </article>

        <article className="panel">
          <p className="eyebrow">Entry context</p>
          <ul className="meta-list">
            <li>
              <span className="meta-label">Grade</span>
              <span className="meta-value">{data.entry.grade ?? 'Pending'}</span>
            </li>
            <li>
              <span className="meta-label">Mode</span>
              <span className="meta-value">{data.entry.commentsOnly ? 'Comments Only' : 'Full adjudication'}</span>
            </li>
          </ul>
        </article>

        <article className="panel">
          <p className="eyebrow">Workflow checklist</p>
          <ul className="meta-list">
            <li>
              <span className="meta-label">Caption ratings</span>
              <span className="meta-value">
                {ratedCaptions}/{data.captions.length}
              </span>
            </li>
            <li>
              <span className="meta-label">Comments entered</span>
              <span className="meta-value">
                {commentedCaptions}/{data.captions.length}
              </span>
            </li>
            <li>
              <span className="meta-label">Tape segments</span>
              <span className="meta-value">{data.audio.tapeSegments.length}</span>
            </li>
            <li>
              <span className="meta-label">Canonical tape</span>
              <span className="meta-value">{data.audio.canonicalTape ? 'Ready' : 'Missing'}</span>
            </li>
          </ul>
        </article>

        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Scoring guide</p>
              <h2>Judge workflow</h2>
              <p className="lede">
                Rate every caption first, add comments where needed, save draft while working, then
                submit once the scoring pass is complete. Audio can be uploaded after the sheet exists.
              </p>
            </div>
          </div>

          <div className="ops-grid">
            <article className="ops-card">
              <p className="eyebrow">Ratings</p>
              <div className="ops-card__value">A to F</div>
              <div className="row-note">Numeric conversion is deterministic in the database.</div>
            </article>
            <article className="ops-card">
              <p className="eyebrow">Modifiers</p>
              <div className="ops-card__value">Plus / minus</div>
              <div className="row-note">Display only. They do not change the numeric total.</div>
            </article>
            <article className="ops-card">
              <p className="eyebrow">Draft</p>
              <div className="ops-card__value">Safe while working</div>
              <div className="row-note">Use this whenever you need to pause mid-sheet.</div>
            </article>
            <article className="ops-card">
              <p className="eyebrow">Submit</p>
              <div className="ops-card__value">Locks workflow state</div>
              <div className="row-note">Admin/chair can verify or return after submission.</div>
            </article>
          </div>
        </article>

        {successMessage ? (
          <article className="panel panel-success panel-wide">
            <p className="eyebrow">Success</p>
            <p className="lede">{successMessage}</p>
          </article>
        ) : null}
        {errorMessage ? (
          <article className="panel panel-error panel-wide">
            <p className="eyebrow">Action blocked</p>
            <p className="lede">{errorMessage}</p>
          </article>
        ) : null}

        <article className="panel panel-wide">
          <form action={saveJudgeSheetAction} className="form-stack">
            <input type="hidden" name="assignmentId" value={assignmentId} />
            <input type="hidden" name="eventEntryId" value={eventEntryId} />

            <div className="judge-sheet-header">
              <div>
                <p className="eyebrow">Caption scoring</p>
                <h2>Score the seven required captions</h2>
                <p className="lede">
                  Each caption should receive a rating before submit. Comments are optional but help when
                  a sheet is returned or reviewed later.
                </p>
              </div>
              <div className="action-row">
                <SubmitButton
                  idleLabel="Save draft"
                  pendingLabel="Saving…"
                  name="intent"
                  value="save_draft"
                  className="button button-secondary"
                />
                <SubmitButton
                  idleLabel="Submit sheet"
                  pendingLabel="Submitting…"
                  name="intent"
                  value="submit"
                />
              </div>
            </div>

            <div className="caption-grid">
              {data.captions.map((caption) => (
                <section className="subpanel judge-caption-card" key={caption.captionOrder}>
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Caption {caption.captionOrder}</p>
                      <h3>{caption.captionName}</h3>
                    </div>
                    <span
                      className={`status-chip ${caption.rating ? 'status-complete' : 'status-setup'}`}
                    >
                      {caption.rating ? `Rated ${caption.rating}` : 'Unrated'}
                    </span>
                  </div>
                  <label className="field">
                    <span>Rating</span>
                    <select name={`rating_${caption.captionOrder}`} defaultValue={caption.rating}>
                      <option value="">Unrated</option>
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                      <option value="D">D</option>
                      <option value="F">F</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Modifier</span>
                    <select name={`modifier_${caption.captionOrder}`} defaultValue={caption.modifier}>
                      <option value="none">none</option>
                      <option value="plus">plus</option>
                      <option value="minus">minus</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Comment</span>
                    <textarea
                      className="textarea"
                      name={`comment_${caption.captionOrder}`}
                      defaultValue={caption.comment}
                      rows={5}
                    />
                  </label>
                </section>
              ))}
            </div>

            <div className="action-row judge-sheet-footer">
              <SubmitButton
                idleLabel="Save draft"
                pendingLabel="Saving…"
                name="intent"
                value="save_draft"
                className="button button-secondary"
              />
              <SubmitButton
                idleLabel="Submit sheet"
                pendingLabel="Submitting…"
                name="intent"
                value="submit"
              />
            </div>
          </form>
        </article>

        {data.sheet ? (
          <>
            <article className="panel panel-wide">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Tape Segments</p>
                  <h2>Judge audio upload</h2>
                  <p className="lede">
                    Upload real segment and canonical audio files into hosted Supabase Storage after the
                    sheet exists. Packet completeness still depends on these rows in the database.
                  </p>
                </div>
              </div>

              <JudgeAudioUpload
                scoreSheetId={data.sheet.id}
                existingSegments={data.audio.tapeSegments}
                existingCanonicalTape={data.audio.canonicalTape}
              />
            </article>
          </>
        ) : null}
      </section>
    </main>
  );
}
