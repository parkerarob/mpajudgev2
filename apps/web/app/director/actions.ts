'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

function buildDirectorEntryRedirect(
  eventEntryId: string,
  messageType: 'error' | 'success',
  message: string
) {
  const params = new URLSearchParams({
    [messageType]: message,
  });

  return `/director/entries/${eventEntryId}?${params.toString()}`;
}

function requiredText(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

export async function updateDirectorEntrySettingsAction(formData: FormData) {
  const eventEntryId = requiredText(formData, 'eventEntryId');
  const totalMembersRaw = requiredText(formData, 'totalMembers');
  const commentsOnly = requiredText(formData, 'commentsOnly') === 'true';
  const sightReadingOptedOut = requiredText(formData, 'sightReadingOptedOut') === 'true';
  const totalMembers = totalMembersRaw ? Number(totalMembersRaw) : null;

  if (!eventEntryId) {
    redirect('/director');
  }

  if (totalMembersRaw && (!Number.isInteger(totalMembers ?? NaN) || (totalMembers ?? 0) < 1)) {
    redirect(buildDirectorEntryRedirect(eventEntryId, 'error', 'Total members must be a whole number greater than zero.'));
  }

  if (!commentsOnly && sightReadingOptedOut) {
    redirect(buildDirectorEntryRedirect(eventEntryId, 'error', 'Only comments-only entries may opt out of sight-reading.'));
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('event_entries')
    .update({
      total_members: totalMembers,
      comments_only: commentsOnly,
      sight_reading_opted_out: commentsOnly ? sightReadingOptedOut : false,
    })
    .eq('id', eventEntryId);

  if (error) {
    redirect(buildDirectorEntryRedirect(eventEntryId, 'error', error.message));
  }

  revalidatePath('/director');
  revalidatePath(`/director/entries/${eventEntryId}`);
  redirect(buildDirectorEntryRedirect(eventEntryId, 'success', 'Entry settings saved.'));
}

export async function saveDirectorRepertoireAction(formData: FormData) {
  const eventEntryId = requiredText(formData, 'eventEntryId');
  const marchId = requiredText(formData, 'marchId');
  const selection1Id = requiredText(formData, 'selection1Id');
  const selection2Id = requiredText(formData, 'selection2Id');

  if (!eventEntryId) {
    redirect('/director');
  }

  const supabase = await createClient();
  const desiredRows = [
    marchId
      ? { event_entry_id: eventEntryId, piece_slot: 'march', march_id: marchId, piece_id: null }
      : null,
    selection1Id
      ? { event_entry_id: eventEntryId, piece_slot: 'selection_1', piece_id: selection1Id, march_id: null }
      : null,
    selection2Id
      ? { event_entry_id: eventEntryId, piece_slot: 'selection_2', piece_id: selection2Id, march_id: null }
      : null,
  ].filter(Boolean) as Array<{
    event_entry_id: string;
    piece_slot: 'march' | 'selection_1' | 'selection_2';
    piece_id: string | null;
    march_id: string | null;
  }>;

  const slotsToKeep = desiredRows.map((row) => row.piece_slot);

  const deleteQuery = supabase.from('repertoire').delete().eq('event_entry_id', eventEntryId);
  const { error: deleteError } =
    slotsToKeep.length > 0
      ? await deleteQuery.not('piece_slot', 'in', `(${slotsToKeep.join(',')})`)
      : await deleteQuery;

  if (deleteError) {
    redirect(buildDirectorEntryRedirect(eventEntryId, 'error', deleteError.message));
  }

  if (desiredRows.length > 0) {
    const { error: upsertError } = await supabase.from('repertoire').upsert(desiredRows, {
      onConflict: 'event_entry_id,piece_slot',
    });

    if (upsertError) {
      redirect(buildDirectorEntryRedirect(eventEntryId, 'error', upsertError.message));
    }
  }

  revalidatePath('/director');
  revalidatePath(`/director/entries/${eventEntryId}`);
  redirect(buildDirectorEntryRedirect(eventEntryId, 'success', 'Repertoire saved.'));
}

export async function upsertDirectorInstrumentationAction(formData: FormData) {
  const eventEntryId = requiredText(formData, 'eventEntryId');
  const instrumentId = requiredText(formData, 'instrumentId');
  const customInstrumentName = requiredText(formData, 'customInstrumentName');
  const playerCountRaw = requiredText(formData, 'playerCount');
  const notes = requiredText(formData, 'notes');
  const playerCount = Number(playerCountRaw);

  if (!eventEntryId) {
    redirect('/director');
  }

  if (!playerCountRaw || !Number.isInteger(playerCount) || playerCount < 1) {
    redirect(buildDirectorEntryRedirect(eventEntryId, 'error', 'Player count must be a whole number greater than zero.'));
  }

  if (!instrumentId && !customInstrumentName) {
    redirect(buildDirectorEntryRedirect(eventEntryId, 'error', 'Choose a standard instrument or enter a custom instrument name.'));
  }

  const supabase = await createClient();
  const payload = instrumentId
    ? {
        event_entry_id: eventEntryId,
        instrument_id: instrumentId,
        custom_instrument_name: null,
        player_count: playerCount,
        notes: notes || null,
      }
    : {
        event_entry_id: eventEntryId,
        instrument_id: null,
        custom_instrument_name: customInstrumentName,
        player_count: playerCount,
        notes: notes || null,
      };

  const { error } = instrumentId
    ? await supabase.from('instrumentation').upsert(payload, {
        onConflict: 'event_entry_id,instrument_id',
      })
    : await supabase.from('instrumentation').upsert(payload, {
        onConflict: 'event_entry_id,custom_instrument_name',
      });

  if (error) {
    redirect(buildDirectorEntryRedirect(eventEntryId, 'error', error.message));
  }

  revalidatePath('/director');
  revalidatePath(`/director/entries/${eventEntryId}`);
  redirect(buildDirectorEntryRedirect(eventEntryId, 'success', 'Instrumentation saved.'));
}

export async function deleteDirectorInstrumentationAction(formData: FormData) {
  const eventEntryId = requiredText(formData, 'eventEntryId');
  const instrumentationId = requiredText(formData, 'instrumentationId');

  if (!eventEntryId || !instrumentationId) {
    redirect('/director');
  }

  const supabase = await createClient();
  const { error } = await supabase.from('instrumentation').delete().eq('id', instrumentationId);

  if (error) {
    redirect(buildDirectorEntryRedirect(eventEntryId, 'error', error.message));
  }

  revalidatePath('/director');
  revalidatePath(`/director/entries/${eventEntryId}`);
  redirect(buildDirectorEntryRedirect(eventEntryId, 'success', 'Instrumentation row removed.'));
}

export async function upsertDirectorSeatingAction(formData: FormData) {
  const eventEntryId = requiredText(formData, 'eventEntryId');
  const rowNumberRaw = requiredText(formData, 'rowNumber');
  const chairsRaw = requiredText(formData, 'chairs');
  const standsRaw = requiredText(formData, 'stands');
  const rowNumber = Number(rowNumberRaw);
  const chairs = Number(chairsRaw);
  const stands = Number(standsRaw);

  if (!eventEntryId) {
    redirect('/director');
  }

  if (
    !Number.isInteger(rowNumber) ||
    rowNumber < 1 ||
    !Number.isInteger(chairs) ||
    chairs < 0 ||
    !Number.isInteger(stands) ||
    stands < 0
  ) {
    redirect(buildDirectorEntryRedirect(eventEntryId, 'error', 'Seating rows must use valid non-negative chair and stand counts.'));
  }

  const supabase = await createClient();
  const { error } = await supabase.from('event_entry_seating').upsert(
    {
      event_entry_id: eventEntryId,
      row_number: rowNumber,
      chairs,
      stands,
    },
    { onConflict: 'event_entry_id,row_number' }
  );

  if (error) {
    redirect(buildDirectorEntryRedirect(eventEntryId, 'error', error.message));
  }

  revalidatePath('/director');
  revalidatePath(`/director/entries/${eventEntryId}`);
  redirect(buildDirectorEntryRedirect(eventEntryId, 'success', 'Seating row saved.'));
}

export async function deleteDirectorSeatingAction(formData: FormData) {
  const eventEntryId = requiredText(formData, 'eventEntryId');
  const seatingId = requiredText(formData, 'seatingId');

  if (!eventEntryId || !seatingId) {
    redirect('/director');
  }

  const supabase = await createClient();
  const { error } = await supabase.from('event_entry_seating').delete().eq('id', seatingId);

  if (error) {
    redirect(buildDirectorEntryRedirect(eventEntryId, 'error', error.message));
  }

  revalidatePath('/director');
  revalidatePath(`/director/entries/${eventEntryId}`);
  redirect(buildDirectorEntryRedirect(eventEntryId, 'success', 'Seating row removed.'));
}

export async function upsertDirectorPercussionRequestAction(formData: FormData) {
  const eventEntryId = requiredText(formData, 'eventEntryId');
  const inventoryItemId = requiredText(formData, 'inventoryItemId');
  const notes = requiredText(formData, 'notes');

  if (!eventEntryId) {
    redirect('/director');
  }

  if (!inventoryItemId) {
    redirect(buildDirectorEntryRedirect(eventEntryId, 'error', 'Choose a percussion inventory item.'));
  }

  const supabase = await createClient();
  const { error } = await supabase.from('event_entry_percussion_requests').upsert(
    {
      event_entry_id: eventEntryId,
      inventory_item_id: inventoryItemId,
      notes: notes || null,
    },
    { onConflict: 'event_entry_id,inventory_item_id' }
  );

  if (error) {
    redirect(buildDirectorEntryRedirect(eventEntryId, 'error', error.message));
  }

  revalidatePath('/director');
  revalidatePath(`/director/entries/${eventEntryId}`);
  redirect(buildDirectorEntryRedirect(eventEntryId, 'success', 'Percussion request saved.'));
}

export async function deleteDirectorPercussionRequestAction(formData: FormData) {
  const eventEntryId = requiredText(formData, 'eventEntryId');
  const inventoryItemId = requiredText(formData, 'inventoryItemId');

  if (!eventEntryId || !inventoryItemId) {
    redirect('/director');
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('event_entry_percussion_requests')
    .delete()
    .eq('event_entry_id', eventEntryId)
    .eq('inventory_item_id', inventoryItemId);

  if (error) {
    redirect(buildDirectorEntryRedirect(eventEntryId, 'error', error.message));
  }

  revalidatePath('/director');
  revalidatePath(`/director/entries/${eventEntryId}`);
  redirect(buildDirectorEntryRedirect(eventEntryId, 'success', 'Percussion request removed.'));
}
