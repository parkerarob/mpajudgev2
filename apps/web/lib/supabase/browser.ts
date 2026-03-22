'use client';

import { createBrowserClient } from '@supabase/ssr';

import { getPublicEnv } from '@/lib/env';

export function createClient() {
  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();
  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
