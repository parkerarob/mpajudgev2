import { createClient } from '@/lib/supabase/server';

type JudgeAssignmentRow = {
  id: string;
  event_id: string;
  position: string;
  form_type: string;
  events:
    | {
        id: string;
        name: string;
        start_date: string;
        end_date: string | null;
        schedule_start_time: string;
        status: string;
        sites: { name: string; city: string | null } | { name: string; city: string | null }[] | null;
      }
    | {
        id: string;
        name: string;
        start_date: string;
        end_date: string | null;
        schedule_start_time: string;
        status: string;
        sites: { name: string; city: string | null } | { name: string; city: string | null }[] | null;
      }[]
    | null;
};

type ScoreSheetRow = {
  id: string;
  event_entry_id: string;
  judge_assignment_id: string;
  status: string;
  caption_score_total: number | null;
  final_judge_rating: string | null;
  submitted_at: string | null;
  verified_at: string | null;
};

type TapeSegmentRow = {
  score_sheet_id: string;
};

type CanonicalTapeRow = {
  score_sheet_id: string;
  is_stitched: boolean;
};

type DayStartRow = {
  event_id: string;
  day: string;
  start_time: string;
};

type ScheduleSlotRow = {
  id: string;
  event_id: string;
  day: string;
  slot_order: number;
  slot_type: string;
  break_duration_minutes: number | null;
  event_entry_id: string | null;
  event_entries:
    | {
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
      }
    | {
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
      }[]
    | null;
};

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function addMinutes(time: string, minutesToAdd: number) {
  const [hours, minutes] = time.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes + minutesToAdd;
  const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const nextHours = Math.floor(wrapped / 60)
    .toString()
    .padStart(2, '0');
  const nextMinutes = (wrapped % 60).toString().padStart(2, '0');
  return `${nextHours}:${nextMinutes}:00`;
}

function estimateSlotDurationMinutes(grade: string | null, commentsOnly: boolean) {
  if (commentsOnly) {
    return 20;
  }

  switch (grade) {
    case 'I':
    case 'I/II':
      return 20;
    case 'II':
    case 'II/III':
    case 'III':
      return 25;
    default:
      return 30;
  }
}

export async function getJudgeDashboardData() {
  const supabase = await createClient();

  const [{ data: assignments, error: assignmentsError }, { data: scoreSheets, error: scoreSheetsError }, { data: tapeSegments, error: tapeSegmentsError }, { data: canonicalTapes, error: canonicalTapesError }, { data: dayStarts, error: dayStartsError }, { data: scheduleSlots, error: scheduleSlotsError }] =
    await Promise.all([
      supabase
        .from('judge_assignments')
        .select(
          'id, event_id, position, form_type, events(id, name, start_date, end_date, schedule_start_time, status, sites(name, city))'
        ),
      supabase
        .from('score_sheets')
        .select(
          'id, event_entry_id, judge_assignment_id, status, caption_score_total, final_judge_rating, submitted_at, verified_at'
        ),
      supabase.from('tape_segments').select('score_sheet_id'),
      supabase.from('canonical_tapes').select('score_sheet_id, is_stitched'),
      supabase.from('event_day_start_times').select('event_id, day, start_time').order('day'),
      supabase
        .from('schedule_slots')
        .select(
          'id, event_id, day, slot_order, slot_type, break_duration_minutes, event_entry_id, event_entries(id, grade, comments_only, ensembles(name, schools(name)))'
        )
        .order('day')
        .order('slot_order'),
    ]);

  if (assignmentsError) throw assignmentsError;
  if (scoreSheetsError) throw scoreSheetsError;
  if (tapeSegmentsError) throw tapeSegmentsError;
  if (canonicalTapesError) throw canonicalTapesError;
  if (dayStartsError) throw dayStartsError;
  if (scheduleSlotsError) throw scheduleSlotsError;

  const scoreSheetsByKey = new Map<string, ScoreSheetRow>();
  for (const sheet of (scoreSheets ?? []) as ScoreSheetRow[]) {
    scoreSheetsByKey.set(`${sheet.judge_assignment_id}:${sheet.event_entry_id}`, sheet);
  }

  const tapeSegmentsBySheet = new Map<string, number>();
  for (const segment of (tapeSegments ?? []) as TapeSegmentRow[]) {
    tapeSegmentsBySheet.set(
      segment.score_sheet_id,
      (tapeSegmentsBySheet.get(segment.score_sheet_id) ?? 0) + 1
    );
  }

  const canonicalTapesBySheet = new Map<string, CanonicalTapeRow>();
  for (const tape of (canonicalTapes ?? []) as CanonicalTapeRow[]) {
    canonicalTapesBySheet.set(tape.score_sheet_id, tape);
  }

  const dayStartsByEvent = new Map<string, DayStartRow[]>();
  for (const row of (dayStarts ?? []) as DayStartRow[]) {
    const current = dayStartsByEvent.get(row.event_id) ?? [];
    current.push(row);
    dayStartsByEvent.set(row.event_id, current);
  }

  const slotsByEvent = new Map<string, ScheduleSlotRow[]>();
  for (const row of (scheduleSlots ?? []) as ScheduleSlotRow[]) {
    const current = slotsByEvent.get(row.event_id) ?? [];
    current.push(row);
    slotsByEvent.set(row.event_id, current);
  }

  const assignmentsView = ((assignments ?? []) as JudgeAssignmentRow[]).map((assignment) => {
    const event = first(assignment.events);
    const site = first(event?.sites);
    const eventDayStarts = (dayStartsByEvent.get(assignment.event_id) ?? []).sort((left, right) =>
      left.day.localeCompare(right.day)
    );
    const eventSlots = (slotsByEvent.get(assignment.event_id) ?? []).sort((left, right) =>
      left.day === right.day
        ? left.slot_order - right.slot_order
        : left.day.localeCompare(right.day)
    );

    let runningDay = '';
    let runningTime = '';
    const queue = eventSlots
      .filter((slot) => slot.slot_type === 'performance')
      .map((slot) => {
        if (slot.day !== runningDay) {
          runningDay = slot.day;
          runningTime =
            eventDayStarts.find((dayStart) => dayStart.day === slot.day)?.start_time ??
            event?.schedule_start_time ??
            '08:00:00';
        }

        const entry = first(slot.event_entries);
        const ensemble = first(entry?.ensembles);
        const school = first(ensemble?.schools);
        const slotStartTime = runningTime;
        const durationMinutes = estimateSlotDurationMinutes(entry?.grade ?? null, Boolean(entry?.comments_only));
        runningTime = addMinutes(runningTime, durationMinutes);

        const sheet = entry ? scoreSheetsByKey.get(`${assignment.id}:${entry.id}`) ?? null : null;

        return {
          id: slot.id,
          eventEntryId: entry?.id ?? null,
          schoolName: school?.name ?? 'Unknown school',
          ensembleName: ensemble?.name ?? 'Unknown ensemble',
          day: slot.day,
          slotOrder: slot.slot_order,
          grade: entry?.grade ?? null,
          commentsOnly: Boolean(entry?.comments_only),
          startTime: slotStartTime,
          scoreSheetStatus: sheet?.status ?? 'not_started',
          captionScoreTotal: sheet?.caption_score_total ?? null,
          finalJudgeRating: sheet?.final_judge_rating ?? null,
          submittedAt: sheet?.submitted_at ?? null,
          verifiedAt: sheet?.verified_at ?? null,
          tapeSegmentCount: sheet ? tapeSegmentsBySheet.get(sheet.id) ?? 0 : 0,
          hasCanonicalTape: sheet ? canonicalTapesBySheet.has(sheet.id) : false,
          canonicalTapeIsStitched: sheet ? canonicalTapesBySheet.get(sheet.id)?.is_stitched ?? false : false,
        };
      });

    return {
      id: assignment.id,
      eventId: assignment.event_id,
      position: assignment.position,
      formType: assignment.form_type,
      eventName: event?.name ?? 'Unknown event',
      eventStatus: event?.status ?? 'unknown',
      eventStartDate: event?.start_date ?? null,
      eventEndDate: event?.end_date ?? null,
      eventScheduleStartTime: event?.schedule_start_time ?? null,
      siteName: site?.name ?? 'Unknown site',
      siteCity: site?.city ?? null,
      dayStarts: eventDayStarts.map((dayStart) => ({
        day: dayStart.day,
        startTime: dayStart.start_time,
      })),
      queue,
    };
  });

  return {
    assignments: assignmentsView,
    summary: {
      assignments: assignmentsView.length,
      queuedPerformances: assignmentsView.reduce((count, assignment) => count + assignment.queue.length, 0),
      submittedSheets: assignmentsView.reduce(
        (count, assignment) =>
          count + assignment.queue.filter((item) => item.scoreSheetStatus !== 'not_started' && item.scoreSheetStatus !== 'draft').length,
        0
      ),
      verifiedSheets: assignmentsView.reduce(
        (count, assignment) =>
          count + assignment.queue.filter((item) => item.scoreSheetStatus === 'verified').length,
        0
      ),
    },
  };
}
