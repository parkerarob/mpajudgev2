# MPAapp Product Requirements

Last updated: 2026-03-17

This document reflects the current Phase 1 operating model that is live in production.

## Product Goal

MPAapp should let a district run Music Performance Adjudication with:

- reliable judge capture during live events
- calm admin oversight and correction workflows
- controlled officialization and release of results
- clear director access to registration requirements and released results

## Core Roles

### Admin

Admins run the event.

Current Phase 1 workspaces:
- Dashboard
- Registrations
- Schedule & Flow
- Live Submissions
- Packets & Results
- Announcer
- Readiness
- Settings

Admin responsibilities:
- create and activate the event
- manage schools, ensembles, assignments, and schedule flow
- review raw assessments
- correct association and judge position when needed
- officialize assessments into packet slots
- release and unrelease official results packets

### Judge

Judges create usable assessment artifacts under event-day pressure.

Current judge model:
- record audio
- complete required caption comments
- assign required caption scores
- submit a locked raw assessment

Important:
- AI is optional assist only
- transcript help is optional
- caption completion is required
- the judge overall rating is derived from caption scoring

### Director

Directors maintain event-required ensemble information and access released results.

Current Phase 1 workspaces:
- Dashboard
- Registration
- My Ensembles
- Event Info
- Official Results Packet

Director responsibilities:
- confirm registration inputs
- maintain ensemble workspace data
- mark workspaces ready when complete
- review released official results packets after admin release

## Data Model Decisions

Protected operational data must remain stable:
- `schools`
- `schools/{schoolId}/ensembles`
- `events/{eventId}/entries/{ensembleId}`
- current director user + school attachment data

Phase 1 adjudication model:
- raw judge capture lands in `rawAssessments`
- packet/session artifacts live in `packets` and related session/media records
- admin officialization creates canonical `officialAssessments`
- legacy `submissions` remains compatibility output where still needed

## Judge Requirements

### Official Workspace

The official judge flow must support:
- ensemble selection from the active event context
- reliable audio recording and upload
- required caption entry for the form type
- live caption total + judge overall rating feedback
- successful submit with immediate visual lock state

### Stage Captions

Required stage captions:
- Tone Quality
- Intonation
- Balance/Blend
- Precision
- Basic Musicianship
- Interpretive Musicianship
- General Factors

### Sight-Reading Captions

Required sight captions:
- Tone Quality
- Intonation
- Balance
- Technique
- Rhythm

## Admin Requirements

### Live Submissions

This is the raw-assessment review queue.

Admins must be able to:
- inspect audio, transcript/reference notes, and caption data
- reassign ensemble, judge position, and form type
- officialize the selected raw assessment
- exclude stray assessments
- delete non-official raw assessments safely

Guardrail:
- a raw assessment that is still tied to a real official slot must not be deletable from this surface

### Packets & Results

This is the official packet management surface.

Admins must be able to:
- view packet completeness by judge position
- see explicit blocking positions
- manage per-position official results
- release and unrelease complete packets
- delete a specific officialized slot when necessary
- generate and load result files

## Director Requirements

The director experience should be ensemble-first, not form-fragment-first.

The workspace should:
- show what is incomplete
- route the user to the next action
- avoid dead-end empty states
- keep released results distinct from registration/editing work

## Release and File Requirements

- Official release is manual only
- Release state must live on canonical official records
- Director packet files must be recoverable from canonical released data
- Stage and sight PDFs must use the current district/site template fields and generated caption overlays

## Deferred Scope

These are intentionally not required for current completion:
- AI-assisted transcript/caption validation in production
- offline-first capture
- broader platform migration off Firebase
- additional feature expansion outside the Phase 1 admin/judge/director workflow baseline
