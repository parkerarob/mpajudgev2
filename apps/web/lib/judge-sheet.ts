import { createClient } from '@/lib/supabase/server';

export const STAGE_CAPTIONS = [
  'Tone Quality',
  'Intonation',
  'Balance/Blend',
  'Precision',
  'Basic Musicianship',
  'Interpretive Musicianship',
  'General Factors',
] as const;

export const SIGHT_READING_CAPTIONS = [
  'Tone Quality',
  'Intonation',
  'Balance',
  'Technique',
  'Rhythm',
  'Musicianship',
  'Utilization of Preparatory Time',
] as const;

type JudgeAssignmentRow = {
  id: string;
  event_id: string;
  position: string;
  form_type: string;
  events:
    | {
        name: string;
        start_date: string;
        sites: { name: string; city: string | null } | { name: string; city: string | null }[] | null;
      }
    | {
        name: string;
        start_date: string;
        sites: { name: string; city: string | null } | { name: string; city: string | null }[] | null;
      }[]
    | null;
};

type EventEntryRow = {
  id: string;
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
};

type ScoreSheetRow = {
  id: string;
  status: string;
  caption_score_total: number | null;
  final_judge_rating: string | null;
  submitted_at: string | null;
  verified_at: string | null;
};

type CaptionRow = {
  caption_order: number;
  caption_name: string;
  rating: string | null;
  modifier: string;
  comment: string | null;
};

type TapeSegmentRow = {
  id: string;
  segment_order: number;
  storage_path: string;
  duration_seconds: number | null;
};

type CanonicalTapeRow = {
  id: string;
  storage_path: string;
  duration_seconds: number | null;
  is_stitched: boolean;
};

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function getJudgeSheetData(assignmentId: string, eventEntryId: string) {
  const supabase = await createClient();

  const [{ data: assignment, error: assignmentError }, { data: entry, error: entryError }, { data: sheet, error: sheetError }] =
    await Promise.all([
      supabase
        .from('judge_assignments')
        .select('id, event_id, position, form_type, events(name, start_date, sites(name, city))')
        .eq('id', assignmentId)
        .maybeSingle(),
      supabase
        .from('event_entries')
        .select('id, grade, comments_only, ensembles(name, schools(name))')
        .eq('id', eventEntryId)
        .maybeSingle(),
      supabase
        .from('score_sheets')
        .select('id, status, caption_score_total, final_judge_rating, submitted_at, verified_at')
        .eq('judge_assignment_id', assignmentId)
        .eq('event_entry_id', eventEntryId)
        .maybeSingle(),
    ]);

  if (assignmentError) throw assignmentError;
  if (entryError) throw entryError;
  if (sheetError) throw sheetError;
  if (!assignment || !entry) {
    throw new Error('Judge sheet context not found.');
  }

  const assignmentRow = assignment as JudgeAssignmentRow;
  const entryRow = entry as EventEntryRow;
  const event = first(assignmentRow.events);
  const site = first(event?.sites);
  const ensemble = first(entryRow.ensembles);
  const school = first(ensemble?.schools);

  let captions: CaptionRow[] = [];
  let tapeSegments: TapeSegmentRow[] = [];
  let canonicalTape: CanonicalTapeRow | null = null;
  if (sheet) {
    const [{ data: captionRows, error: captionsError }, { data: tapeSegmentRows, error: tapeSegmentsError }, { data: canonicalTapeRow, error: canonicalTapeError }] =
      await Promise.all([
        supabase
          .from('caption_ratings')
          .select('caption_order, caption_name, rating, modifier, comment')
          .eq('score_sheet_id', (sheet as ScoreSheetRow).id)
          .order('caption_order'),
        supabase
          .from('tape_segments')
          .select('id, segment_order, storage_path, duration_seconds')
          .eq('score_sheet_id', (sheet as ScoreSheetRow).id)
          .order('segment_order'),
        supabase
          .from('canonical_tapes')
          .select('id, storage_path, duration_seconds, is_stitched')
          .eq('score_sheet_id', (sheet as ScoreSheetRow).id)
          .maybeSingle(),
      ]);

    if (captionsError) throw captionsError;
    if (tapeSegmentsError) throw tapeSegmentsError;
    if (canonicalTapeError) throw canonicalTapeError;
    captions = (captionRows ?? []) as CaptionRow[];
    tapeSegments = (tapeSegmentRows ?? []) as TapeSegmentRow[];
    canonicalTape = (canonicalTapeRow ?? null) as CanonicalTapeRow | null;
  }

  const canonicalCaptions =
    assignmentRow.form_type === 'sight_reading_form' ? SIGHT_READING_CAPTIONS : STAGE_CAPTIONS;

  const captionModels = canonicalCaptions.map((captionName, index) => {
    const existing = captions.find((caption) => caption.caption_order === index + 1);
    return {
      captionOrder: index + 1,
      captionName,
      rating: existing?.rating ?? '',
      modifier: existing?.modifier ?? 'none',
      comment: existing?.comment ?? '',
    };
  });

  return {
    assignment: {
      id: assignmentRow.id,
      position: assignmentRow.position,
      formType: assignmentRow.form_type,
      eventName: event?.name ?? 'Unknown event',
      eventStartDate: event?.start_date ?? null,
      siteName: site?.name ?? 'Unknown site',
      siteCity: site?.city ?? null,
    },
    entry: {
      id: entryRow.id,
      schoolName: school?.name ?? 'Unknown school',
      ensembleName: ensemble?.name ?? 'Unknown ensemble',
      grade: entryRow.grade,
      commentsOnly: entryRow.comments_only,
    },
    sheet: sheet
      ? {
          id: (sheet as ScoreSheetRow).id,
          status: (sheet as ScoreSheetRow).status,
          captionScoreTotal: (sheet as ScoreSheetRow).caption_score_total,
          finalJudgeRating: (sheet as ScoreSheetRow).final_judge_rating,
          submittedAt: (sheet as ScoreSheetRow).submitted_at,
          verifiedAt: (sheet as ScoreSheetRow).verified_at,
        }
      : null,
    captions: captionModels,
    audio: {
      tapeSegments: tapeSegments.map((segment) => ({
        id: segment.id,
        segmentOrder: segment.segment_order,
        storagePath: segment.storage_path,
        durationSeconds: segment.duration_seconds,
      })),
      canonicalTape: canonicalTape
        ? {
            id: canonicalTape.id,
            storagePath: canonicalTape.storage_path,
            durationSeconds: canonicalTape.duration_seconds,
            isStitched: canonicalTape.is_stitched,
          }
        : null,
    },
  };
}
