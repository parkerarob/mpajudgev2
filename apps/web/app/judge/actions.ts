'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { SIGHT_READING_CAPTIONS, STAGE_CAPTIONS } from '@/lib/judge-sheet';

function buildJudgeRedirect(
  assignmentId: string,
  eventEntryId: string,
  messageType: 'error' | 'success',
  message: string
) {
  const params = new URLSearchParams({
    [messageType]: message,
  });
  return `/judge/sheets/${assignmentId}/${eventEntryId}?${params.toString()}`;
}

export async function saveJudgeSheetAction(formData: FormData) {
  const assignmentId = String(formData.get('assignmentId') ?? '').trim();
  const eventEntryId = String(formData.get('eventEntryId') ?? '').trim();
  const intent = String(formData.get('intent') ?? '').trim();

  if (!assignmentId || !eventEntryId || !['save_draft', 'submit'].includes(intent)) {
    redirect('/judge');
  }

  const supabase = await createClient();

  const { data: assignment, error: assignmentError } = await supabase
    .from('judge_assignments')
    .select('id, form_type')
    .eq('id', assignmentId)
    .maybeSingle();

  if (assignmentError || !assignment) {
    redirect(buildJudgeRedirect(assignmentId, eventEntryId, 'error', 'Judge assignment not found.'));
  }

  const { data: existingSheet, error: existingSheetError } = await supabase
    .from('score_sheets')
    .select('id, status')
    .eq('judge_assignment_id', assignmentId)
    .eq('event_entry_id', eventEntryId)
    .maybeSingle();

  if (existingSheetError) {
    redirect(buildJudgeRedirect(assignmentId, eventEntryId, 'error', existingSheetError.message));
  }

  let scoreSheetId = existingSheet?.id ?? null;
  let currentStatus = existingSheet?.status ?? 'draft';

  if (!scoreSheetId) {
    const { data: insertedSheet, error: insertSheetError } = await supabase
      .from('score_sheets')
      .insert({
        event_entry_id: eventEntryId,
        judge_assignment_id: assignmentId,
        status: 'draft',
      })
      .select('id, status')
      .single();

    if (insertSheetError || !insertedSheet) {
      redirect(buildJudgeRedirect(assignmentId, eventEntryId, 'error', insertSheetError?.message || 'Unable to create score sheet.'));
    }

    scoreSheetId = insertedSheet.id;
    currentStatus = insertedSheet.status;
  }

  const canonicalCaptions =
    assignment.form_type === 'sight_reading_form' ? SIGHT_READING_CAPTIONS : STAGE_CAPTIONS;

  const captionPayload = canonicalCaptions.map((captionName, index) => {
    const captionOrder = index + 1;
    const ratingValue = String(formData.get(`rating_${captionOrder}`) ?? '').trim();
    const modifierValue = String(formData.get(`modifier_${captionOrder}`) ?? 'none').trim() || 'none';
    const commentValue = String(formData.get(`comment_${captionOrder}`) ?? '').trim();

    return {
      score_sheet_id: scoreSheetId,
      caption_order: captionOrder,
      caption_name: captionName,
      rating: ratingValue || null,
      modifier: modifierValue || 'none',
      comment: commentValue || null,
    };
  });

  const { error: captionError } = await supabase.from('caption_ratings').upsert(captionPayload, {
    onConflict: 'score_sheet_id,caption_order',
  });

  if (captionError) {
    redirect(buildJudgeRedirect(assignmentId, eventEntryId, 'error', captionError.message));
  }

  if (intent === 'submit') {
    const { error: submitError } = await supabase
      .from('score_sheets')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        returned_at: null,
      })
      .eq('id', scoreSheetId);

    if (submitError) {
      redirect(buildJudgeRedirect(assignmentId, eventEntryId, 'error', submitError.message));
    }
  } else if (currentStatus === 'draft') {
    const { error: draftError } = await supabase
      .from('score_sheets')
      .update({
        status: 'draft',
      })
      .eq('id', scoreSheetId);

    if (draftError) {
      redirect(buildJudgeRedirect(assignmentId, eventEntryId, 'error', draftError.message));
    }
  }

  revalidatePath('/judge');
  revalidatePath(`/judge/sheets/${assignmentId}/${eventEntryId}`);
  redirect(
    buildJudgeRedirect(
      assignmentId,
      eventEntryId,
      'success',
      intent === 'submit' ? 'Score sheet submitted.' : 'Draft saved.'
    )
  );
}
