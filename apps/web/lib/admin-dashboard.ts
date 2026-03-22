import { createClient } from '@/lib/supabase/server';

type EventRow = {
  id: string;
  name: string;
  status: string;
  season_year: string;
  start_date: string;
  end_date: string | null;
  schedule_start_time: string;
  districts: { name: string } | { name: string }[] | null;
  sites: { name: string; city: string | null } | { name: string; city: string | null }[] | null;
};

type EventChairRow = {
  event_id: string;
  user_id: string;
  role: string;
};

type DirectorSchoolRow = {
  director_id: string;
  school_id: string;
};

type JudgeAssignmentRow = {
  id: string;
  event_id: string;
  user_id: string;
  position: string;
  form_type: string;
  events?:
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

type PacketRow = {
  id: string;
  assembly_status: string;
  release_status: string;
  overall_rating: string | null;
  released_at: string | null;
  event_entries:
    | {
        id: string;
        event_id: string;
        grade: string | null;
        comments_only: boolean;
        checkin_completed: boolean;
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
        event_id: string;
        grade: string | null;
        comments_only: boolean;
        checkin_completed: boolean;
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

type ScoreSheetReviewRow = {
  id: string;
  event_entry_id: string;
  judge_assignment_id: string;
  status: string;
  caption_score_total: number | null;
  final_judge_rating: string | null;
  submitted_at: string | null;
  returned_at: string | null;
  verified_at: string | null;
};

type ScoreSheetDetailRow = {
  id: string;
  event_entry_id: string;
  judge_assignment_id: string;
  status: string;
  caption_score_total: number | null;
  final_judge_rating: string | null;
  submitted_at: string | null;
  returned_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
};

type CaptionDetailRow = {
  caption_order: number;
  caption_name: string;
  rating: string | null;
  modifier: string;
  comment: string | null;
};

type TapeSegmentDetailRow = {
  id: string;
  segment_order: number;
  storage_path: string;
  duration_seconds: number | null;
};

type CanonicalTapeDetailRow = {
  id: string;
  storage_path: string;
  duration_seconds: number | null;
  is_stitched: boolean;
};

type EventEntryDetailRow = {
  id: string;
  event_id: string;
  grade: string | null;
  comments_only: boolean;
  checkin_completed: boolean;
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

type UserRow = {
  id: string;
  display_name: string | null;
  email: string | null;
};

type DistrictOption = {
  id: string;
  name: string;
};

type SiteOption = {
  id: string;
  name: string;
  city: string | null;
};

type GradedListVersionOption = {
  id: string;
  label: string;
  is_current: boolean;
};

type UserOption = {
  id: string;
  display_name: string | null;
  email: string | null;
  is_admin?: boolean;
};

type SchoolOption = {
  id: string;
  name: string;
  districts: { name: string } | { name: string }[] | null;
};

type EventDayStartRow = {
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
  event_entries:
    | {
        id: string;
        grade: string | null;
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

type EventEntryOption = {
  id: string;
  event_id: string;
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

type EventDashboard = {
  id: string;
  name: string;
  seasonYear: string;
  status: string;
  startDate: string;
  endDate: string | null;
  scheduleStartTime: string;
  districtName: string;
  siteName: string;
  siteCity: string | null;
  chairs: Array<{ userId: string; role: string; label: string }>;
  assignments: Array<{ id: string; userId: string; position: string; formType: string; label: string }>;
  dayStarts: Array<{ day: string; startTime: string }>;
  scheduleSlots: Array<{
    id: string;
    day: string;
    slotOrder: number;
    slotType: string;
    breakDurationMinutes: number | null;
    label: string;
    eventEntryId: string | null;
  }>;
  packets: Array<{
    id: string;
    eventEntryId: string;
    ensembleName: string;
    schoolName: string;
    grade: string | null;
    commentsOnly: boolean;
    checkinCompleted: boolean;
    assemblyStatus: string;
    releaseStatus: string;
    overallRating: string | null;
    releasedAt: string | null;
  }>;
  scoreSheets: Array<{
    id: string;
    eventEntryId: string;
    judgeAssignmentId: string;
    schoolName: string;
    ensembleName: string;
    judgeLabel: string;
    position: string;
    status: string;
    captionScoreTotal: number | null;
    finalJudgeRating: string | null;
    submittedAt: string | null;
    returnedAt: string | null;
    verifiedAt: string | null;
  }>;
};

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function personLabel(
  userId: string,
  userMap: Map<string, UserRow>,
  fallbackPrefix: string
) {
  const user = userMap.get(userId);
  if (user?.display_name) {
    return user.display_name;
  }
  if (user?.email) {
    return user.email;
  }
  return `${fallbackPrefix} ${userId.slice(0, 8)}`;
}

export async function getAdminDashboardData() {
  const supabase = await createClient();

  const [{ data: events, error: eventsError }, { data: eventChairs, error: chairsError }, { data: directorSchools, error: directorSchoolsError }, { data: judgeAssignments, error: assignmentsError }, { data: dayStarts, error: dayStartsError }, { data: scheduleSlots, error: scheduleSlotsError }, { data: packets, error: packetsError }, { data: scoreSheets, error: scoreSheetsError }, { data: users }, { data: schools, error: schoolsError }] =
    await Promise.all([
      supabase
        .from('events')
        .select(
          'id, name, status, season_year, start_date, end_date, schedule_start_time, districts(name), sites(name, city)'
        )
        .order('start_date', { ascending: false }),
      supabase.from('event_chairs').select('event_id, user_id, role'),
      supabase.from('director_schools').select('director_id, school_id'),
      supabase.from('judge_assignments').select('id, event_id, user_id, position, form_type'),
      supabase.from('event_day_start_times').select('event_id, day, start_time').order('day'),
      supabase
        .from('schedule_slots')
        .select(
          'id, event_id, day, slot_order, slot_type, break_duration_minutes, event_entries(id, grade, ensembles(name, schools(name)))'
        )
        .order('day')
        .order('slot_order'),
      supabase
        .from('packets')
        .select(
          'id, assembly_status, release_status, overall_rating, released_at, event_entries!inner(id, event_id, grade, comments_only, checkin_completed, ensembles!inner(name, schools(name)))'
        )
        .order('released_at', { ascending: false, nullsFirst: true }),
      supabase
        .from('score_sheets')
        .select(
          'id, event_entry_id, judge_assignment_id, status, caption_score_total, final_judge_rating, submitted_at, returned_at, verified_at'
        )
        .order('submitted_at', { ascending: false, nullsFirst: true }),
      supabase.from('users').select('id, display_name, email'),
      supabase.from('schools').select('id, name'),
    ]);

  if (eventsError) {
    throw eventsError;
  }
  if (chairsError) {
    throw chairsError;
  }
  if (directorSchoolsError) {
    throw directorSchoolsError;
  }
  if (assignmentsError) {
    throw assignmentsError;
  }
  if (dayStartsError) {
    throw dayStartsError;
  }
  if (scheduleSlotsError) {
    throw scheduleSlotsError;
  }
  if (packetsError) {
    throw packetsError;
  }
  if (scoreSheetsError) {
    throw scoreSheetsError;
  }
  if (schoolsError) {
    throw schoolsError;
  }

  const userMap = new Map<string, UserRow>((users ?? []).map((user) => [user.id, user]));
  const schoolMap = new Map<string, string>(
    ((schools ?? []) as Array<{ id: string; name: string }>).map((school) => [school.id, school.name])
  );

  const packetRows = (packets ?? []) as PacketRow[];
  const chairsByEvent = new Map<string, EventChairRow[]>();
  const directorSchoolsByUser = new Map<string, string[]>();
  const assignmentsByEvent = new Map<string, JudgeAssignmentRow[]>();
  const assignmentsById = new Map<string, JudgeAssignmentRow>();
  const dayStartsByEvent = new Map<string, EventDashboard['dayStarts']>();
  const scheduleSlotsByEvent = new Map<string, EventDashboard['scheduleSlots']>();
  const packetsByEvent = new Map<string, EventDashboard['packets']>();
  const sheetsByEvent = new Map<string, EventDashboard['scoreSheets']>();
  const eventEntryMetaById = new Map<
    string,
    { eventId: string; schoolName: string; ensembleName: string }
  >();

  for (const chair of (eventChairs ?? []) as EventChairRow[]) {
    const current = chairsByEvent.get(chair.event_id) ?? [];
    current.push(chair);
    chairsByEvent.set(chair.event_id, current);
  }

  for (const assignment of (directorSchools ?? []) as DirectorSchoolRow[]) {
    const current = directorSchoolsByUser.get(assignment.director_id) ?? [];
    current.push(assignment.school_id);
    directorSchoolsByUser.set(assignment.director_id, current);
  }

  for (const assignment of (judgeAssignments ?? []) as JudgeAssignmentRow[]) {
    const current = assignmentsByEvent.get(assignment.event_id) ?? [];
    current.push(assignment);
    assignmentsByEvent.set(assignment.event_id, current);
    assignmentsById.set(assignment.id, assignment);
  }

  for (const dayStart of (dayStarts ?? []) as EventDayStartRow[]) {
    const current = dayStartsByEvent.get(dayStart.event_id) ?? [];
    current.push({
      day: dayStart.day,
      startTime: dayStart.start_time,
    });
    dayStartsByEvent.set(dayStart.event_id, current);
  }

  for (const slot of (scheduleSlots ?? []) as ScheduleSlotRow[]) {
    const current = scheduleSlotsByEvent.get(slot.event_id) ?? [];
    const entry = first(slot.event_entries);
    const ensemble = first(entry?.ensembles);
    const school = first(ensemble?.schools);

    current.push({
      id: slot.id,
      day: slot.day,
      slotOrder: slot.slot_order,
      slotType: slot.slot_type,
      breakDurationMinutes: slot.break_duration_minutes,
      eventEntryId: entry?.id ?? null,
      label:
        slot.slot_type === 'break'
          ? `Break · ${slot.break_duration_minutes ?? 0} min`
          : `${school?.name ?? 'Unknown school'} · ${ensemble?.name ?? 'Unknown ensemble'}${entry?.grade ? ` · ${entry.grade}` : ''}`,
    });
    scheduleSlotsByEvent.set(slot.event_id, current);
  }

  for (const packet of packetRows) {
    const entry = first(packet.event_entries);
    if (!entry) {
      continue;
    }

    const ensemble = first(entry.ensembles);
    const school = first(ensemble?.schools);
    const eventPacket = {
      id: packet.id,
      eventEntryId: entry.id,
      ensembleName: ensemble?.name ?? 'Unknown ensemble',
      schoolName: school?.name ?? 'Unknown school',
      grade: entry.grade,
      commentsOnly: entry.comments_only,
      checkinCompleted: entry.checkin_completed,
      assemblyStatus: packet.assembly_status,
      releaseStatus: packet.release_status,
      overallRating: packet.overall_rating,
      releasedAt: packet.released_at,
    };

    const current = packetsByEvent.get(entry.event_id) ?? [];
    current.push(eventPacket);
    packetsByEvent.set(entry.event_id, current);
    eventEntryMetaById.set(entry.id, {
      eventId: entry.event_id,
      schoolName: school?.name ?? 'Unknown school',
      ensembleName: ensemble?.name ?? 'Unknown ensemble',
    });
  }

  for (const sheet of (scoreSheets ?? []) as ScoreSheetReviewRow[]) {
    const entryMeta = eventEntryMetaById.get(sheet.event_entry_id);
    const assignment = assignmentsById.get(sheet.judge_assignment_id);

    if (!entryMeta || !assignment) {
      continue;
    }

    const current = sheetsByEvent.get(entryMeta.eventId) ?? [];
    current.push({
      id: sheet.id,
      eventEntryId: sheet.event_entry_id,
      judgeAssignmentId: sheet.judge_assignment_id,
      schoolName: entryMeta.schoolName,
      ensembleName: entryMeta.ensembleName,
      judgeLabel: personLabel(assignment.user_id, userMap, 'Judge'),
      position: assignment.position,
      status: sheet.status,
      captionScoreTotal: sheet.caption_score_total,
      finalJudgeRating: sheet.final_judge_rating,
      submittedAt: sheet.submitted_at,
      returnedAt: sheet.returned_at,
      verifiedAt: sheet.verified_at,
    });
    sheetsByEvent.set(entryMeta.eventId, current);
  }

  const dashboards: EventDashboard[] = ((events ?? []) as EventRow[]).map((event) => {
    const district = first(event.districts);
    const site = first(event.sites);
    const eventPackets = packetsByEvent.get(event.id) ?? [];

    return {
      id: event.id,
      name: event.name,
      seasonYear: event.season_year,
      status: event.status,
      startDate: event.start_date,
      endDate: event.end_date,
      scheduleStartTime: event.schedule_start_time,
      districtName: district?.name ?? 'Unknown district',
      siteName: site?.name ?? 'Unknown site',
      siteCity: site?.city ?? null,
      chairs: (chairsByEvent.get(event.id) ?? []).map((chair) => ({
        userId: chair.user_id,
        role: chair.role,
        label: personLabel(chair.user_id, userMap, 'Chair'),
      })),
      assignments: (assignmentsByEvent.get(event.id) ?? [])
        .sort((left, right) => left.position.localeCompare(right.position))
        .map((assignment) => ({
          id: assignment.id,
          userId: assignment.user_id,
          position: assignment.position,
          formType: assignment.form_type,
          label: personLabel(assignment.user_id, userMap, 'Judge'),
        })),
      dayStarts: (dayStartsByEvent.get(event.id) ?? []).sort((left, right) =>
        left.day.localeCompare(right.day)
      ),
      scheduleSlots: (scheduleSlotsByEvent.get(event.id) ?? [])
        .sort((left, right) =>
          left.day === right.day
            ? left.slotOrder - right.slotOrder
            : left.day.localeCompare(right.day)
        ),
      scoreSheets: (sheetsByEvent.get(event.id) ?? []).sort((left, right) => {
        const leftTime = left.submittedAt ?? '';
        const rightTime = right.submittedAt ?? '';
        return rightTime.localeCompare(leftTime);
      }),
      packets: eventPackets,
    };
  });

  const summary = dashboards.reduce(
    (accumulator, event) => {
      accumulator.events += 1;
      accumulator.packets += event.packets.length;
      accumulator.completePackets += event.packets.filter((packet) => packet.assemblyStatus === 'complete').length;
      accumulator.releasedPackets += event.packets.filter((packet) => packet.releaseStatus === 'released').length;
      return accumulator;
    },
    { events: 0, packets: 0, completePackets: 0, releasedPackets: 0 }
  );

  return {
    events: dashboards,
    roleRoster: {
      directors: Array.from(directorSchoolsByUser.entries())
        .map(([userId, schoolIds]) => ({
          userId,
          label: personLabel(userId, userMap, 'Director'),
          schools: schoolIds
            .map((schoolId) => schoolMap.get(schoolId) ?? 'Unknown school')
            .sort((left, right) => left.localeCompare(right)),
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
      judges: Array.from(
        new Map(
          ((judgeAssignments ?? []) as JudgeAssignmentRow[]).map((assignment) => [
            assignment.user_id,
            {
              userId: assignment.user_id,
              label: personLabel(assignment.user_id, userMap, 'Judge'),
            },
          ])
        ).values()
      ).sort((left, right) => left.label.localeCompare(right.label)),
      chairs: Array.from(
        new Map(
          ((eventChairs ?? []) as EventChairRow[]).map((chair) => [
            chair.user_id,
            {
              userId: chair.user_id,
              label: personLabel(chair.user_id, userMap, 'Chair'),
            },
          ])
        ).values()
      ).sort((left, right) => left.label.localeCompare(right.label)),
    },
    summary,
  };
}

export async function getAdminEventDetail(eventId: string) {
  const dashboard = await getAdminDashboardData();
  const event = dashboard.events.find((entry) => entry.id === eventId) ?? null;

  if (!event) {
    throw new Error('Event not found.');
  }

  return event;
}

export async function getAdminSetupOptions() {
  const supabase = await createClient();

  const [{ data: districts, error: districtsError }, { data: schools, error: schoolsError }, { data: sites, error: sitesError }, { data: gradedListVersions, error: versionsError }, { data: users, error: usersError }, { data: eventEntries, error: eventEntriesError }] =
    await Promise.all([
      supabase.from('districts').select('id, name').order('name'),
      supabase.from('schools').select('id, name, districts(name)').order('name'),
      supabase.from('sites').select('id, name, city').order('name'),
      supabase.from('graded_list_versions').select('id, label, is_current').order('published_date', { ascending: false }),
      supabase.from('users').select('id, display_name, email, is_admin').order('display_name'),
      supabase
        .from('event_entries')
        .select('id, event_id, grade, comments_only, ensembles(name, schools(name))')
        .order('created_at', { ascending: false }),
    ]);

  if (districtsError) {
    throw districtsError;
  }
  if (sitesError) {
    throw sitesError;
  }
  if (schoolsError) {
    throw schoolsError;
  }
  if (versionsError) {
    throw versionsError;
  }
  if (usersError) {
    throw usersError;
  }
  if (eventEntriesError) {
    throw eventEntriesError;
  }

  return {
    districts: (districts ?? []) as DistrictOption[],
    schools: ((schools ?? []) as SchoolOption[]).map((school) => ({
      id: school.id,
      name: school.name,
      districtName: first(school.districts)?.name ?? 'Unknown district',
    })),
    sites: (sites ?? []) as SiteOption[],
    gradedListVersions: (gradedListVersions ?? []) as GradedListVersionOption[],
    users: (users ?? []) as UserOption[],
    eventEntries: (eventEntries ?? []) as EventEntryOption[],
  };
}

export async function getAdminScoreSheetDetail(scoreSheetId: string) {
  const supabase = await createClient();

  const [{ data: scoreSheet, error: scoreSheetError }, { data: users, error: usersError }] =
    await Promise.all([
      supabase
        .from('score_sheets')
        .select(
          'id, event_entry_id, judge_assignment_id, status, caption_score_total, final_judge_rating, submitted_at, returned_at, verified_at, verified_by'
        )
        .eq('id', scoreSheetId)
        .maybeSingle(),
      supabase.from('users').select('id, display_name, email'),
    ]);

  if (scoreSheetError) {
    throw scoreSheetError;
  }
  if (usersError) {
    throw usersError;
  }
  if (!scoreSheet) {
    throw new Error('Score sheet not found.');
  }

  const detailRow = scoreSheet as ScoreSheetDetailRow;
  const userMap = new Map<string, UserRow>((users ?? []).map((user) => [user.id, user]));

  const [{ data: assignment, error: assignmentError }, { data: entry, error: entryError }, { data: captions, error: captionsError }, { data: tapeSegments, error: tapeSegmentsError }, { data: canonicalTape, error: canonicalTapeError }, { data: packet, error: packetError }] =
    await Promise.all([
      supabase
        .from('judge_assignments')
        .select('id, event_id, user_id, position, form_type, events(name, start_date, sites(name, city))')
        .eq('id', detailRow.judge_assignment_id)
        .maybeSingle(),
      supabase
        .from('event_entries')
        .select('id, event_id, grade, comments_only, checkin_completed, ensembles(name, schools(name))')
        .eq('id', detailRow.event_entry_id)
        .maybeSingle(),
      supabase
        .from('caption_ratings')
        .select('caption_order, caption_name, rating, modifier, comment')
        .eq('score_sheet_id', detailRow.id)
        .order('caption_order'),
      supabase
        .from('tape_segments')
        .select('id, segment_order, storage_path, duration_seconds')
        .eq('score_sheet_id', detailRow.id)
        .order('segment_order'),
      supabase
        .from('canonical_tapes')
        .select('id, storage_path, duration_seconds, is_stitched')
        .eq('score_sheet_id', detailRow.id)
        .maybeSingle(),
      supabase
        .from('packets')
        .select('id, assembly_status, release_status, overall_rating')
        .eq('event_entry_id', detailRow.event_entry_id)
        .maybeSingle(),
    ]);

  if (assignmentError) {
    throw assignmentError;
  }
  if (entryError) {
    throw entryError;
  }
  if (captionsError) {
    throw captionsError;
  }
  if (tapeSegmentsError) {
    throw tapeSegmentsError;
  }
  if (canonicalTapeError) {
    throw canonicalTapeError;
  }
  if (packetError) {
    throw packetError;
  }
  if (!assignment || !entry) {
    throw new Error('Score sheet context is incomplete.');
  }

  const assignmentRow = assignment as JudgeAssignmentRow;
  const entryRow = entry as EventEntryDetailRow;

  const event = first(assignmentRow.events);
  const site = first(event?.sites);
  const ensemble = first(entryRow.ensembles);
  const school = first(ensemble?.schools);
  const signedPaths = [
    ...((tapeSegments ?? []) as TapeSegmentDetailRow[]).map((segment) => segment.storage_path),
    ...(canonicalTape ? [(canonicalTape as CanonicalTapeDetailRow).storage_path] : []),
  ];
  const signedUrlMap = new Map<string, string | null>();

  if (signedPaths.length > 0) {
    const signedResults = await Promise.all(
      signedPaths.map(async (path) => {
        const { data } = await supabase.storage.from('judge-audio').createSignedUrl(path, 60 * 60);
        return [path, data?.signedUrl ?? null] as const;
      })
    );

    for (const [path, signedUrl] of signedResults) {
      signedUrlMap.set(path, signedUrl);
    }
  }

  return {
    scoreSheet: {
      id: detailRow.id,
      status: detailRow.status,
      captionScoreTotal: detailRow.caption_score_total,
      finalJudgeRating: detailRow.final_judge_rating,
      submittedAt: detailRow.submitted_at,
      returnedAt: detailRow.returned_at,
      verifiedAt: detailRow.verified_at,
      verifiedByLabel: detailRow.verified_by
        ? personLabel(detailRow.verified_by, userMap, 'Verifier')
        : null,
    },
    assignment: {
      id: assignmentRow.id,
      judgeLabel: personLabel(assignmentRow.user_id, userMap, 'Judge'),
      position: assignmentRow.position,
      formType: assignmentRow.form_type,
      eventName: event?.name ?? 'Unknown event',
      eventStartDate: event?.start_date ?? null,
      siteName: site?.name ?? 'Unknown site',
      siteCity: site?.city ?? null,
    },
    entry: {
      id: entryRow.id,
      eventId: entryRow.event_id,
      schoolName: school?.name ?? 'Unknown school',
      ensembleName: ensemble?.name ?? 'Unknown ensemble',
      grade: entryRow.grade,
      commentsOnly: entryRow.comments_only,
      checkinCompleted: entryRow.checkin_completed,
    },
    packet: packet
      ? {
          id: packet.id,
          assemblyStatus: packet.assembly_status,
          releaseStatus: packet.release_status,
          overallRating: packet.overall_rating,
        }
      : null,
    captions: ((captions ?? []) as CaptionDetailRow[]).map((caption) => ({
      captionOrder: caption.caption_order,
      captionName: caption.caption_name,
      rating: caption.rating,
      modifier: caption.modifier,
      comment: caption.comment,
    })),
    audio: {
      tapeSegments: ((tapeSegments ?? []) as TapeSegmentDetailRow[]).map((segment) => ({
        id: segment.id,
        segmentOrder: segment.segment_order,
        storagePath: segment.storage_path,
        durationSeconds: segment.duration_seconds,
        signedUrl: signedUrlMap.get(segment.storage_path) ?? null,
      })),
      canonicalTape: canonicalTape
        ? {
            id: (canonicalTape as CanonicalTapeDetailRow).id,
            storagePath: (canonicalTape as CanonicalTapeDetailRow).storage_path,
            durationSeconds: (canonicalTape as CanonicalTapeDetailRow).duration_seconds,
            isStitched: (canonicalTape as CanonicalTapeDetailRow).is_stitched,
            signedUrl:
              signedUrlMap.get((canonicalTape as CanonicalTapeDetailRow).storage_path) ?? null,
          }
        : null,
    },
  };
}
