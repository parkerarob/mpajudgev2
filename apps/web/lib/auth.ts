import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

type AppRole = 'admin' | 'chair' | 'judge' | 'director' | 'authenticated';

export async function getCurrentUserContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, role: null as AppRole | null };
  }

  const { data: profile } = await supabase
    .from('users')
    .select('id, display_name, email, is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.is_admin) {
    return { user, role: 'admin' as AppRole, profile };
  }

  const [{ data: chair }, { data: judge }, { data: director }] = await Promise.all([
    supabase.from('event_chairs').select('event_id').eq('user_id', user.id).limit(1).maybeSingle(),
    supabase.from('judge_assignments').select('event_id').eq('user_id', user.id).limit(1).maybeSingle(),
    supabase.from('director_schools').select('school_id').eq('director_id', user.id).limit(1).maybeSingle(),
  ]);

  if (chair) {
    return { user, role: 'chair' as AppRole, profile };
  }

  if (judge) {
    return { user, role: 'judge' as AppRole, profile };
  }

  if (director) {
    return { user, role: 'director' as AppRole, profile };
  }

  return { user, role: 'authenticated' as AppRole, profile };
}

export async function requireRole(allowedRoles: AppRole[]) {
  const context = await getCurrentUserContext();

  if (!context.user) {
    redirect('/sign-in');
  }

  if (!context.role || !allowedRoles.includes(context.role)) {
    redirect('/');
  }

  return context;
}
