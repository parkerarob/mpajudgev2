# Rebuild Web App

Historical note: this copy remains in `MPAJudgeV2` only as a leftover from before the standalone split. The authoritative rebuild web app now lives in `/Users/parkerarob/Documents/Workspaces/Desktop-Projects/NCBA-MPA-Event-Management-App/apps/web`.

This directory contains the new Next.js frontend for the Supabase rebuild lane.

## Why This Copy Remains

- `public/` remains the frozen Firebase production/archive SPA in this legacy repo.
- This `apps/web/` copy is retained only as a historical snapshot from before the standalone split.
- Active rebuild implementation now happens in `NCBA-MPA-Event-Management-App`, not here.

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
