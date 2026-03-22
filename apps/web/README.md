# Rebuild Web App

This directory contains the new Next.js frontend for the Supabase rebuild lane.

## Why It Lives Here

- `public/` remains the frozen Firebase production/archive SPA.
- `apps/web/` is the new build surface for the rebuild.
- The two stacks stay isolated so rebuild work does not destabilize archive access.

## Current Scope

- Next.js App Router scaffold
- Supabase SSR/browser client plumbing
- Sign-in screen
- Role-gated route shells for admin/chair, judge, and director

## Environment

Copy `.env.example` to `.env.local` and set:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Use the hosted development Supabase project, not the frozen Firebase backend.

The project URL is already set in `.env.example`. The publishable key still needs to be copied from:

- Supabase Dashboard
- `Project Settings` -> `API Keys`
- `Publishable key` / `anon` key for the hosted dev project

## Current Constraint

Automatic `supabase gen types` is blocked on this machine because the Supabase CLI path for type generation currently expects Docker even when targeting the hosted database. Until that is resolved, the app shell uses direct queries plus narrow local typing rather than generated database types.

## Commands

```bash
npm install --prefix apps/web
npm run dev --prefix apps/web
```
