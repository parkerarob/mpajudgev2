'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState, useTransition } from 'react';

import { createClient } from '@/lib/supabase/browser';

type TapeSegmentModel = {
  id: string;
  segmentOrder: number;
  storagePath: string;
  durationSeconds: number | null;
};

type CanonicalTapeModel = {
  id: string;
  storagePath: string;
  durationSeconds: number | null;
  isStitched: boolean;
} | null;

type JudgeAudioUploadProps = {
  scoreSheetId: string;
  existingSegments: TapeSegmentModel[];
  existingCanonicalTape: CanonicalTapeModel;
};

function sanitizeFilenamePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'audio';
}

function buildSegmentPath(scoreSheetId: string, segmentOrder: number, fileName: string) {
  const safeName = sanitizeFilenamePart(fileName.replace(/\.[^/.]+$/, ''));
  return `score-sheets/${scoreSheetId}/segments/segment-${segmentOrder}-${safeName}`;
}

function buildCanonicalPath(scoreSheetId: string, fileName: string) {
  const safeName = sanitizeFilenamePart(fileName.replace(/\.[^/.]+$/, ''));
  return `score-sheets/${scoreSheetId}/canonical/final-${safeName}`;
}

export function JudgeAudioUpload({
  scoreSheetId,
  existingSegments,
  existingCanonicalTape,
}: JudgeAudioUploadProps) {
  const router = useRouter();
  const [segmentMessage, setSegmentMessage] = useState<string | null>(null);
  const [segmentError, setSegmentError] = useState<string | null>(null);
  const [canonicalMessage, setCanonicalMessage] = useState<string | null>(null);
  const [canonicalError, setCanonicalError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSegmentUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSegmentMessage(null);
    setSegmentError(null);

    const formData = new FormData(event.currentTarget);
    const segmentOrder = Number(String(formData.get('segmentOrder') ?? '').trim());
    const durationSecondsRaw = String(formData.get('durationSeconds') ?? '').trim();
    const durationSeconds = durationSecondsRaw ? Number(durationSecondsRaw) : null;
    const file = formData.get('audioFile');

    if (!Number.isInteger(segmentOrder) || segmentOrder < 1 || !(file instanceof File) || file.size === 0) {
      setSegmentError('Choose an audio file and a valid segment order.');
      return;
    }

    startTransition(async () => {
      const supabase = createClient();
      const storagePath = buildSegmentPath(scoreSheetId, segmentOrder, file.name);

      const { error: uploadError } = await supabase.storage
        .from('judge-audio')
        .upload(storagePath, file, {
          upsert: true,
          contentType: file.type || undefined,
        });

      if (uploadError) {
        setSegmentError(uploadError.message);
        return;
      }

      const { error: dbError } = await supabase.from('tape_segments').upsert(
        {
          score_sheet_id: scoreSheetId,
          segment_order: segmentOrder,
          storage_path: storagePath,
          duration_seconds: Number.isFinite(durationSeconds ?? NaN) ? durationSeconds : null,
        },
        { onConflict: 'score_sheet_id,segment_order' }
      );

      if (dbError) {
        setSegmentError(dbError.message);
        return;
      }

      setSegmentMessage(`Uploaded segment ${segmentOrder}.`);
      router.refresh();
      event.currentTarget.reset();
    });
  }

  async function handleCanonicalUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCanonicalMessage(null);
    setCanonicalError(null);

    const formData = new FormData(event.currentTarget);
    const durationSecondsRaw = String(formData.get('durationSeconds') ?? '').trim();
    const durationSeconds = durationSecondsRaw ? Number(durationSecondsRaw) : null;
    const isStitched = String(formData.get('isStitched') ?? '').trim() === 'true';
    const file = formData.get('audioFile');

    if (!(file instanceof File) || file.size === 0) {
      setCanonicalError('Choose a canonical audio file to upload.');
      return;
    }

    startTransition(async () => {
      const supabase = createClient();
      const storagePath = buildCanonicalPath(scoreSheetId, file.name);

      const { error: uploadError } = await supabase.storage
        .from('judge-audio')
        .upload(storagePath, file, {
          upsert: true,
          contentType: file.type || undefined,
        });

      if (uploadError) {
        setCanonicalError(uploadError.message);
        return;
      }

      const { error: dbError } = await supabase.from('canonical_tapes').upsert(
        {
          score_sheet_id: scoreSheetId,
          storage_path: storagePath,
          duration_seconds: Number.isFinite(durationSeconds ?? NaN) ? durationSeconds : null,
          is_stitched: isStitched,
        },
        { onConflict: 'score_sheet_id' }
      );

      if (dbError) {
        setCanonicalError(dbError.message);
        return;
      }

      setCanonicalMessage('Uploaded canonical tape.');
      router.refresh();
      event.currentTarget.reset();
    });
  }

  return (
    <div className="split-grid">
      <section className="subpanel">
        <p className="eyebrow">Existing segments</p>
        {existingSegments.length > 0 ? (
          <ul className="plain-list">
            {existingSegments.map((segment) => (
              <li key={segment.id}>
                <strong>Segment {segment.segmentOrder}</strong>: {segment.storagePath}
                {segment.durationSeconds ? ` · ${segment.durationSeconds}s` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="lede">No tape segments are recorded yet.</p>
        )}
      </section>

      <section className="subpanel">
        <p className="eyebrow">Upload segment</p>
        <form className="form-stack compact-form" onSubmit={handleSegmentUpload}>
          <label className="field">
            <span>Segment order</span>
            <input name="segmentOrder" type="number" min="1" step="1" required />
          </label>
          <label className="field">
            <span>Audio file</span>
            <input name="audioFile" type="file" accept="audio/*,video/mp4,video/quicktime" required />
          </label>
          <label className="field">
            <span>Duration seconds</span>
            <input name="durationSeconds" type="number" min="1" step="1" />
          </label>
          {segmentError ? <p className="error-text">{segmentError}</p> : null}
          {segmentMessage ? <p className="lede">{segmentMessage}</p> : null}
          <button type="submit" className="button" disabled={isPending}>
            {isPending ? 'Uploading…' : 'Upload segment'}
          </button>
        </form>
      </section>

      <section className="subpanel">
        <p className="eyebrow">Current canonical tape</p>
        {existingCanonicalTape ? (
          <ul className="plain-list">
            <li>
              <strong>Path</strong>: {existingCanonicalTape.storagePath}
            </li>
            <li>
              <strong>Duration</strong>:{' '}
              {existingCanonicalTape.durationSeconds ? `${existingCanonicalTape.durationSeconds}s` : 'Unknown'}
            </li>
            <li>
              <strong>Mode</strong>:{' '}
              {existingCanonicalTape.isStitched ? 'Stitched result' : 'Single-segment pointer'}
            </li>
          </ul>
        ) : (
          <p className="lede">No canonical tape exists yet.</p>
        )}
      </section>

      <section className="subpanel">
        <p className="eyebrow">Upload canonical tape</p>
        <form className="form-stack compact-form" onSubmit={handleCanonicalUpload}>
          <label className="field">
            <span>Audio file</span>
            <input name="audioFile" type="file" accept="audio/*,video/mp4,video/quicktime" required />
          </label>
          <label className="field">
            <span>Duration seconds</span>
            <input name="durationSeconds" type="number" min="1" step="1" />
          </label>
          <label className="field">
            <span>Canonical type</span>
            <select name="isStitched" defaultValue={existingCanonicalTape?.isStitched ? 'true' : 'false'}>
              <option value="false">Single segment</option>
              <option value="true">Stitched</option>
            </select>
          </label>
          {canonicalError ? <p className="error-text">{canonicalError}</p> : null}
          {canonicalMessage ? <p className="lede">{canonicalMessage}</p> : null}
          <button type="submit" className="button" disabled={isPending}>
            {isPending ? 'Uploading…' : 'Upload canonical tape'}
          </button>
        </form>
      </section>
    </div>
  );
}
