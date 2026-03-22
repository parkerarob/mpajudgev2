import { createClient } from '@/lib/supabase/server';

type EventEntryRow = {
  id: string;
  event_id: string;
  grade: string | null;
  comments_only: boolean;
  sight_reading_opted_out: boolean;
  total_members: number | null;
  checkin_completed: boolean;
  events:
    | {
        id: string;
        name: string;
        site_id: string;
        start_date: string;
        end_date: string | null;
        schedule_start_time: string;
        status: string;
        sites: { name: string; city: string | null } | { name: string; city: string | null }[] | null;
      }
    | {
        id: string;
        name: string;
        site_id: string;
        start_date: string;
        end_date: string | null;
        schedule_start_time: string;
        status: string;
        sites: { name: string; city: string | null } | { name: string; city: string | null }[] | null;
      }[]
    | null;
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
};

type PacketRow = {
  id: string;
  event_entry_id: string;
  assembly_status: string;
  release_status: string;
  overall_rating: string | null;
  released_at: string | null;
};

type ReleasedPacketArtifactRow = {
  score_sheet_id: string;
  judge_position: string;
  form_type: string;
  score_sheet_status: string;
  caption_score_total: number | null;
  final_judge_rating: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  canonical_tape_id: string | null;
  canonical_tape_storage_path: string | null;
  canonical_tape_duration_seconds: number | null;
  canonical_tape_is_stitched: boolean | null;
};

type RepertoireRow = {
  piece_slot: 'march' | 'selection_1' | 'selection_2';
  piece_id: string | null;
  march_id: string | null;
};

type PieceOptionRow = {
  id: string;
  grade: string;
  title: string;
  composer: string;
};

type MarchOptionRow = {
  id: string;
  title: string;
  composer: string | null;
};

type InstrumentationRow = {
  id: string;
  instrument_id: string | null;
  custom_instrument_name: string | null;
  player_count: number;
  notes: string | null;
  instruments:
    | {
        id: string;
        name: string;
        instrument_families:
          | { name: string }
          | { name: string }[]
          | null;
      }
    | {
        id: string;
        name: string;
        instrument_families:
          | { name: string }
          | { name: string }[]
          | null;
      }[]
    | null;
};

type SeatingRow = {
  id: string;
  row_number: number;
  chairs: number;
  stands: number;
};

type InstrumentOptionRow = {
  id: string;
  name: string;
  instrument_families:
    | { name: string }
    | { name: string }[]
    | null;
};

type PercussionInventoryRow = {
  id: string;
  item_name: string;
  notes: string | null;
  display_order: number;
};

type PercussionRequestRow = {
  inventory_item_id: string;
  notes: string | null;
  site_percussion_inventory:
    | {
        id: string;
        item_name: string;
        notes: string | null;
      }
    | {
        id: string;
        item_name: string;
        notes: string | null;
      }[]
    | null;
};

type DirectorEntry = {
  id: string;
  eventId: string;
  ensembleName: string;
  schoolName: string;
  eventName: string;
  eventStatus: string;
  eventStartDate: string | null;
  eventEndDate: string | null;
  eventScheduleStartTime: string | null;
  siteName: string;
  siteCity: string | null;
  grade: string | null;
  commentsOnly: boolean;
  sightReadingOptedOut: boolean;
  totalMembers: number | null;
  checkinCompleted: boolean;
  dayStarts: Array<{ day: string; startTime: string }>;
  assignedSlot: {
    id: string;
    day: string;
    slotOrder: number;
    slotType: string;
    startTime: string;
    durationMinutes: number;
    isCurrentEntry: boolean;
  } | null;
  scheduleTimeline: Array<{
    id: string;
    day: string;
    slotOrder: number;
    slotType: string;
    startTime: string;
    durationMinutes: number;
    isCurrentEntry: boolean;
  }>;
  packet: PacketRow | null;
  releasedPacketArtifacts: Array<{
    scoreSheetId: string;
    judgePosition: string;
    formType: string;
    scoreSheetStatus: string;
    captionScoreTotal: number | null;
    finalJudgeRating: string | null;
    submittedAt: string | null;
    verifiedAt: string | null;
    canonicalTapeId: string | null;
    canonicalTapeStoragePath: string | null;
    canonicalTapeDurationSeconds: number | null;
    canonicalTapeIsStitched: boolean;
    canonicalTapeSignedUrl: string | null;
  }>;
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

export async function getDirectorDashboardData() {
  const supabase = await createClient();

  const [{ data: eventEntries, error: entriesError }, { data: dayStarts, error: dayStartsError }, { data: scheduleSlots, error: scheduleSlotsError }, { data: packets, error: packetsError }] =
    await Promise.all([
      supabase
        .from('event_entries')
        .select(
          'id, event_id, grade, comments_only, sight_reading_opted_out, total_members, checkin_completed, events(id, name, site_id, start_date, end_date, schedule_start_time, status, sites(name, city)), ensembles(name, schools(name))'
        )
        .order('created_at', { ascending: false }),
      supabase.from('event_day_start_times').select('event_id, day, start_time').order('day'),
      supabase
        .from('schedule_slots')
        .select('id, event_id, day, slot_order, slot_type, break_duration_minutes, event_entry_id')
        .order('day')
        .order('slot_order'),
      supabase
        .from('packets')
        .select('id, event_entry_id, assembly_status, release_status, overall_rating, released_at')
        .order('released_at', { ascending: false, nullsFirst: true }),
    ]);

  if (entriesError) {
    throw entriesError;
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

  const packetsByEntry = new Map<string, PacketRow>();
  for (const packet of (packets ?? []) as PacketRow[]) {
    packetsByEntry.set(packet.event_entry_id, packet);
  }

  const releasedEntryIds = Array.from(packetsByEntry.values())
    .filter((packet) => packet.release_status === 'released')
    .map((packet) => packet.event_entry_id);

  const releasedArtifactsByEntry = new Map<string, ReleasedPacketArtifactRow[]>();
  if (releasedEntryIds.length > 0) {
    const releasedArtifactResults = await Promise.all(
      releasedEntryIds.map(async (eventEntryId) => {
        const { data, error } = await supabase.rpc('released_packet_artifacts', {
          target_event_entry_id: eventEntryId,
        });

        if (error) {
          throw error;
        }

        return [eventEntryId, ((data ?? []) as ReleasedPacketArtifactRow[])] as const;
      })
    );

    for (const [eventEntryId, rows] of releasedArtifactResults) {
      releasedArtifactsByEntry.set(eventEntryId, rows);
    }
  }

  const entries: DirectorEntry[] = ((eventEntries ?? []) as EventEntryRow[]).map((entry) => {
    const event = first(entry.events);
    const site = first(event?.sites);
    const ensemble = first(entry.ensembles);
    const school = first(ensemble?.schools);
    const packet = packetsByEntry.get(entry.id) ?? null;
    const eventDayStarts = (dayStartsByEvent.get(entry.event_id) ?? []).sort((left, right) =>
      left.day.localeCompare(right.day)
    );
    const schedule = (slotsByEvent.get(entry.event_id) ?? []).sort((left, right) =>
      left.day === right.day
        ? left.slot_order - right.slot_order
        : left.day.localeCompare(right.day)
    );

    let runningDay = '';
    let runningTime = '';
    const scheduleTimeline = schedule.map((slot) => {
      if (slot.day !== runningDay) {
        runningDay = slot.day;
        runningTime =
          eventDayStarts.find((dayStart) => dayStart.day === slot.day)?.start_time ??
          event?.schedule_start_time ??
          '08:00:00';
      }

      const isPerformance = slot.slot_type === 'performance';
      const slotStartTime = runningTime;
      const durationMinutes = isPerformance
        ? estimateSlotDurationMinutes(entry.grade, entry.comments_only)
        : slot.break_duration_minutes ?? 0;

      runningTime = addMinutes(runningTime, durationMinutes);

      return {
        id: slot.id,
        day: slot.day,
        slotOrder: slot.slot_order,
        slotType: slot.slot_type,
        startTime: slotStartTime,
        durationMinutes,
        isCurrentEntry: slot.event_entry_id === entry.id,
      };
    });

    const assignedSlot = scheduleTimeline.find((slot) => slot.isCurrentEntry) ?? null;

    return {
      id: entry.id,
      eventId: entry.event_id,
      ensembleName: ensemble?.name ?? 'Unknown ensemble',
      schoolName: school?.name ?? 'Unknown school',
      eventName: event?.name ?? 'Unknown event',
      eventStatus: event?.status ?? 'unknown',
      eventStartDate: event?.start_date ?? null,
      eventEndDate: event?.end_date ?? null,
      eventScheduleStartTime: event?.schedule_start_time ?? null,
      siteName: site?.name ?? 'Unknown site',
      siteCity: site?.city ?? null,
      grade: entry.grade,
      commentsOnly: entry.comments_only,
      sightReadingOptedOut: entry.sight_reading_opted_out,
      totalMembers: entry.total_members,
      checkinCompleted: entry.checkin_completed,
      dayStarts: eventDayStarts.map((dayStart) => ({
        day: dayStart.day,
        startTime: dayStart.start_time,
      })),
      assignedSlot,
      scheduleTimeline,
      packet,
      releasedPacketArtifacts: (releasedArtifactsByEntry.get(entry.id) ?? []).map((artifact) => ({
        scoreSheetId: artifact.score_sheet_id,
        judgePosition: artifact.judge_position,
        formType: artifact.form_type,
        scoreSheetStatus: artifact.score_sheet_status,
        captionScoreTotal: artifact.caption_score_total,
        finalJudgeRating: artifact.final_judge_rating,
        submittedAt: artifact.submitted_at,
        verifiedAt: artifact.verified_at,
        canonicalTapeId: artifact.canonical_tape_id,
        canonicalTapeStoragePath: artifact.canonical_tape_storage_path,
        canonicalTapeDurationSeconds: artifact.canonical_tape_duration_seconds,
        canonicalTapeIsStitched: Boolean(artifact.canonical_tape_is_stitched),
        canonicalTapeSignedUrl: null,
      })),
    };
  });

  for (const entry of entries) {
    const tapePaths = entry.releasedPacketArtifacts
      .map((artifact) => artifact.canonicalTapeStoragePath)
      .filter((value): value is string => Boolean(value));

    if (tapePaths.length === 0) {
      continue;
    }

    const signedResults = await Promise.all(
      tapePaths.map(async (path) => {
        const { data } = await supabase.storage.from('judge-audio').createSignedUrl(path, 60 * 60);
        return [path, data?.signedUrl ?? null] as const;
      })
    );

    const signedUrlMap = new Map<string, string | null>(signedResults);
    entry.releasedPacketArtifacts = entry.releasedPacketArtifacts.map((artifact) => ({
      ...artifact,
      canonicalTapeSignedUrl: artifact.canonicalTapeStoragePath
        ? signedUrlMap.get(artifact.canonicalTapeStoragePath) ?? null
        : null,
    }));
  }

  return {
    entries,
    summary: {
      entries: entries.length,
      checkedIn: entries.filter((entry) => entry.checkinCompleted).length,
      scheduled: entries.filter((entry) => entry.assignedSlot).length,
      released: entries.filter((entry) => entry.packet?.release_status === 'released').length,
    },
  };
}

export async function getDirectorEntryDetail(eventEntryId: string) {
  const dashboard = await getDirectorDashboardData();
  const entry = dashboard.entries.find((item) => item.id === eventEntryId) ?? null;

  if (!entry) {
    throw new Error('Director entry not found.');
  }

  const supabase = await createClient();
  const entryRow = ((await supabase
    .from('event_entries')
    .select('id, event_id, events(site_id)')
    .eq('id', eventEntryId)
    .maybeSingle()) as {
    data:
      | {
          id: string;
          event_id: string;
          events:
            | { site_id: string }
            | { site_id: string }[]
            | null;
        }
      | null;
    error: Error | null;
  });

  if (entryRow.error) {
    throw entryRow.error;
  }

  const siteId = first(entryRow.data?.events)?.site_id ?? null;

  const [
    { data: repertoireRows, error: repertoireError },
    { data: pieceOptions, error: piecesError },
    { data: marchOptions, error: marchesError },
    { data: instrumentationRows, error: instrumentationError },
    { data: seatingRows, error: seatingError },
    { data: instrumentOptions, error: instrumentsError },
    { data: percussionRequests, error: percussionRequestsError },
    percussionInventoryResult,
  ] =
    await Promise.all([
      supabase
        .from('repertoire')
        .select('piece_slot, piece_id, march_id')
        .eq('event_entry_id', eventEntryId),
      supabase
        .from('pieces')
        .select('id, grade, title, composer')
        .eq('status', 'active')
        .order('grade')
        .order('title'),
      supabase.from('marches').select('id, title, composer').order('title'),
      supabase
        .from('instrumentation')
        .select('id, instrument_id, custom_instrument_name, player_count, notes, instruments(id, name, instrument_families(name))')
        .eq('event_entry_id', eventEntryId)
        .order('created_at'),
      supabase
        .from('event_entry_seating')
        .select('id, row_number, chairs, stands')
        .eq('event_entry_id', eventEntryId)
        .order('row_number'),
      supabase
        .from('instruments')
        .select('id, name, instrument_families(name)')
        .eq('is_active', true)
        .order('display_order'),
      supabase
        .from('event_entry_percussion_requests')
        .select('inventory_item_id, notes, site_percussion_inventory(id, item_name, notes)')
        .eq('event_entry_id', eventEntryId),
      siteId
        ? supabase
            .from('site_percussion_inventory')
            .select('id, item_name, notes, display_order')
            .eq('site_id', siteId)
            .order('display_order')
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (repertoireError) {
    throw repertoireError;
  }
  if (piecesError) {
    throw piecesError;
  }
  if (marchesError) {
    throw marchesError;
  }
  if (instrumentationError) {
    throw instrumentationError;
  }
  if (seatingError) {
    throw seatingError;
  }
  if (instrumentsError) {
    throw instrumentsError;
  }
  if (percussionRequestsError) {
    throw percussionRequestsError;
  }
  if (percussionInventoryResult.error) {
    throw percussionInventoryResult.error;
  }

  const repertoireBySlot = new Map(
    ((repertoireRows ?? []) as RepertoireRow[]).map((row) => [row.piece_slot, row])
  );

  return {
    ...entry,
    editable: {
      repertoire: {
        marchId: repertoireBySlot.get('march')?.march_id ?? '',
        selection1Id: repertoireBySlot.get('selection_1')?.piece_id ?? '',
        selection2Id: repertoireBySlot.get('selection_2')?.piece_id ?? '',
      },
      options: {
        marches: ((marchOptions ?? []) as MarchOptionRow[]).map((march) => ({
          id: march.id,
          label: march.composer ? `${march.title} · ${march.composer}` : march.title,
        })),
        pieces: ((pieceOptions ?? []) as PieceOptionRow[]).map((piece) => ({
          id: piece.id,
          grade: piece.grade,
          label: `${piece.grade} · ${piece.title} · ${piece.composer}`,
        })),
        instruments: ((instrumentOptions ?? []) as InstrumentOptionRow[]).map((instrument) => ({
          id: instrument.id,
          familyName: first(instrument.instrument_families)?.name ?? 'Other',
          label: `${first(instrument.instrument_families)?.name ?? 'Other'} · ${instrument.name}`,
        })),
        percussionInventory: ((percussionInventoryResult.data ?? []) as PercussionInventoryRow[]).map((item) => ({
          id: item.id,
          label: item.notes ? `${item.item_name} · ${item.notes}` : item.item_name,
        })),
      },
      instrumentation: ((instrumentationRows ?? []) as InstrumentationRow[]).map((row) => ({
        id: row.id,
        instrumentId: row.instrument_id,
        instrumentName: first(row.instruments)?.name ?? null,
        instrumentFamilyName: first(first(row.instruments)?.instrument_families)?.name ?? null,
        customInstrumentName: row.custom_instrument_name,
        playerCount: row.player_count,
        notes: row.notes,
      })),
      seating: ((seatingRows ?? []) as SeatingRow[]).map((row) => ({
        id: row.id,
        rowNumber: row.row_number,
        chairs: row.chairs,
        stands: row.stands,
      })),
      percussionRequests: ((percussionRequests ?? []) as PercussionRequestRow[]).map((row) => ({
        inventoryItemId: row.inventory_item_id,
        itemName: first(row.site_percussion_inventory)?.item_name ?? 'Unknown item',
        inventoryNotes: first(row.site_percussion_inventory)?.notes ?? null,
        notes: row.notes,
      })),
    },
  };
}
