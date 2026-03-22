'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

function buildAdminRedirect(
  messageType: 'error' | 'success',
  message: string,
  returnTo = '/admin'
) {
  const params = new URLSearchParams({
    [messageType]: message,
  });

  const separator = returnTo.includes('?') ? '&' : '?';
  return `${returnTo}${separator}${params.toString()}`;
}

function requiredText(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

function adminReturnTo(formData: FormData) {
  return requiredText(formData, 'returnTo') || '/admin';
}

export async function createEventAction(formData: FormData) {
  const name = requiredText(formData, 'name');
  const seasonYear = requiredText(formData, 'seasonYear');
  const districtId = requiredText(formData, 'districtId');
  const siteId = requiredText(formData, 'siteId');
  const gradedListVersionId = requiredText(formData, 'gradedListVersionId');
  const startDate = requiredText(formData, 'startDate');
  const endDate = requiredText(formData, 'endDate');
  const scheduleStartTime = requiredText(formData, 'scheduleStartTime');

  if (!name || !seasonYear || !districtId || !siteId || !gradedListVersionId || !startDate || !scheduleStartTime) {
    redirect(buildAdminRedirect('error', 'Missing required event fields.'));
  }

  const supabase = await createClient();
  const { error } = await supabase.from('events').insert({
    name,
    season_year: seasonYear,
    district_id: districtId,
    site_id: siteId,
    graded_list_version_id: gradedListVersionId,
    start_date: startDate,
    end_date: endDate || null,
    schedule_start_time: scheduleStartTime,
    status: 'setup',
  });

  if (error) {
    redirect(buildAdminRedirect('error', error.message));
  }

  revalidatePath('/admin');
  redirect(buildAdminRedirect('success', 'Event created.'));
}

export async function assignChairAction(formData: FormData) {
  const returnTo = adminReturnTo(formData);
  const eventId = requiredText(formData, 'eventId');
  const userId = requiredText(formData, 'userId');
  const role = requiredText(formData, 'role');

  if (!eventId || !userId || !role) {
    redirect(buildAdminRedirect('error', 'Missing chair assignment fields.', returnTo));
  }

  const supabase = await createClient();
  const { error } = await supabase.from('event_chairs').insert({
    event_id: eventId,
    user_id: userId,
    role,
  });

  if (error) {
    redirect(buildAdminRedirect('error', error.message, returnTo));
  }

  revalidatePath('/admin');
  revalidatePath(returnTo);
  redirect(buildAdminRedirect('success', 'Chair assignment added.', returnTo));
}

export async function assignDirectorSchoolAction(formData: FormData) {
  const returnTo = adminReturnTo(formData);
  const userId = requiredText(formData, 'userId');
  const schoolId = requiredText(formData, 'schoolId');

  if (!userId || !schoolId) {
    redirect(buildAdminRedirect('error', 'Missing director assignment fields.', returnTo));
  }

  const supabase = await createClient();
  const { error } = await supabase.from('director_schools').upsert(
    {
      director_id: userId,
      school_id: schoolId,
    },
    { onConflict: 'director_id,school_id' }
  );

  if (error) {
    redirect(buildAdminRedirect('error', error.message, returnTo));
  }

  revalidatePath('/admin');
  revalidatePath(returnTo);
  redirect(buildAdminRedirect('success', 'Director school assignment added.', returnTo));
}

export async function assignJudgeAction(formData: FormData) {
  const returnTo = adminReturnTo(formData);
  const eventId = requiredText(formData, 'eventId');
  const userId = requiredText(formData, 'userId');
  const position = requiredText(formData, 'position');

  if (!eventId || !userId || !position) {
    redirect(buildAdminRedirect('error', 'Missing judge assignment fields.', returnTo));
  }

  const supabase = await createClient();

  const { error: deleteByPositionError } = await supabase
    .from('judge_assignments')
    .delete()
    .eq('event_id', eventId)
    .eq('position', position);

  if (deleteByPositionError) {
    redirect(buildAdminRedirect('error', deleteByPositionError.message, returnTo));
  }

  const { error: deleteByUserError } = await supabase
    .from('judge_assignments')
    .delete()
    .eq('event_id', eventId)
    .eq('user_id', userId);

  if (deleteByUserError) {
    redirect(buildAdminRedirect('error', deleteByUserError.message, returnTo));
  }

  const { error: insertError } = await supabase.from('judge_assignments').insert({
    event_id: eventId,
    user_id: userId,
    position,
  });

  if (insertError) {
    redirect(buildAdminRedirect('error', insertError.message, returnTo));
  }

  revalidatePath('/admin');
  revalidatePath(returnTo);
  redirect(buildAdminRedirect('success', 'Judge assignment saved.', returnTo));
}

export async function upsertEventDayStartAction(formData: FormData) {
  const returnTo = adminReturnTo(formData);
  const eventId = requiredText(formData, 'eventId');
  const day = requiredText(formData, 'day');
  const startTime = requiredText(formData, 'startTime');

  if (!eventId || !day || !startTime) {
    redirect(buildAdminRedirect('error', 'Missing day start fields.', returnTo));
  }

  const supabase = await createClient();
  const { error } = await supabase.from('event_day_start_times').upsert(
    {
      event_id: eventId,
      day,
      start_time: startTime,
    },
    { onConflict: 'event_id,day' }
  );

  if (error) {
    redirect(buildAdminRedirect('error', error.message, returnTo));
  }

  revalidatePath('/admin');
  revalidatePath(returnTo);
  redirect(buildAdminRedirect('success', 'Day start time saved.', returnTo));
}

export async function createScheduleSlotAction(formData: FormData) {
  const returnTo = adminReturnTo(formData);
  const eventId = requiredText(formData, 'eventId');
  const day = requiredText(formData, 'day');
  const slotOrder = Number(requiredText(formData, 'slotOrder'));
  const slotType = requiredText(formData, 'slotType');
  const eventEntryId = requiredText(formData, 'eventEntryId');
  const breakDurationMinutesRaw = requiredText(formData, 'breakDurationMinutes');
  const breakDurationMinutes = breakDurationMinutesRaw ? Number(breakDurationMinutesRaw) : null;

  if (!eventId || !day || !Number.isInteger(slotOrder) || slotOrder < 1 || !slotType) {
    redirect(buildAdminRedirect('error', 'Missing schedule slot fields.', returnTo));
  }

  const payload =
    slotType === 'performance'
      ? {
          event_id: eventId,
          day,
          slot_order: slotOrder,
          slot_type: 'performance',
          event_entry_id: eventEntryId || null,
          break_duration_minutes: null,
        }
      : {
          event_id: eventId,
          day,
          slot_order: slotOrder,
          slot_type: 'break',
          event_entry_id: null,
          break_duration_minutes: breakDurationMinutes,
        };

  const supabase = await createClient();
  const { error } = await supabase.from('schedule_slots').insert(payload);

  if (error) {
    redirect(buildAdminRedirect('error', error.message, returnTo));
  }

  revalidatePath('/admin');
  revalidatePath(returnTo);
  redirect(buildAdminRedirect('success', 'Schedule slot added.', returnTo));
}

export async function deleteScheduleSlotAction(formData: FormData) {
  const returnTo = adminReturnTo(formData);
  const slotId = requiredText(formData, 'slotId');

  if (!slotId) {
    redirect(buildAdminRedirect('error', 'Missing schedule slot id.', returnTo));
  }

  const supabase = await createClient();
  const { error } = await supabase.from('schedule_slots').delete().eq('id', slotId);

  if (error) {
    redirect(buildAdminRedirect('error', error.message, returnTo));
  }

  revalidatePath('/admin');
  revalidatePath(returnTo);
  redirect(buildAdminRedirect('success', 'Schedule slot removed.', returnTo));
}

export async function verifyScoreSheetAction(formData: FormData) {
  const returnTo = adminReturnTo(formData);
  const scoreSheetId = requiredText(formData, 'scoreSheetId');

  if (!scoreSheetId) {
    redirect(buildAdminRedirect('error', 'Missing score sheet id.', returnTo));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildAdminRedirect('error', 'Authentication required.', returnTo));
  }

  const { error } = await supabase
    .from('score_sheets')
    .update({
      status: 'verified',
      verified_at: new Date().toISOString(),
      verified_by: user.id,
      returned_at: null,
    })
    .eq('id', scoreSheetId);

  if (error) {
    redirect(buildAdminRedirect('error', error.message, returnTo));
  }

  revalidatePath('/admin');
  revalidatePath(returnTo);
  redirect(buildAdminRedirect('success', 'Score sheet verified.', returnTo));
}

export async function returnScoreSheetAction(formData: FormData) {
  const returnTo = adminReturnTo(formData);
  const scoreSheetId = requiredText(formData, 'scoreSheetId');

  if (!scoreSheetId) {
    redirect(buildAdminRedirect('error', 'Missing score sheet id.', returnTo));
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('score_sheets')
    .update({
      status: 'returned',
      returned_at: new Date().toISOString(),
      verified_at: null,
      verified_by: null,
    })
    .eq('id', scoreSheetId);

  if (error) {
    redirect(buildAdminRedirect('error', error.message, returnTo));
  }

  revalidatePath('/admin');
  revalidatePath(returnTo);
  redirect(buildAdminRedirect('success', 'Score sheet returned to judge.', returnTo));
}

export async function updatePacketReleaseAction(formData: FormData) {
  const returnTo = adminReturnTo(formData);
  const packetId = String(formData.get('packetId') ?? '').trim();
  const nextReleaseState = String(formData.get('nextReleaseState') ?? '').trim();

  if (!packetId || (nextReleaseState !== 'released' && nextReleaseState !== 'unreleased')) {
    redirect(buildAdminRedirect('error', 'Invalid packet release request.', returnTo));
  }

  const supabase = await createClient();
  const rpcName = nextReleaseState === 'released' ? 'release_packet' : 'unrelease_packet';
  const { error } = await supabase.rpc(rpcName, { target_packet_id: packetId });

  if (error) {
    redirect(buildAdminRedirect('error', error.message, returnTo));
  }

  revalidatePath('/admin');
  revalidatePath(returnTo);
  redirect(
    buildAdminRedirect(
      'success',
      nextReleaseState === 'released' ? 'Packet released.' : 'Packet returned to unreleased state.',
      returnTo
    )
  );
}
