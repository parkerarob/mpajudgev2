# Director User Guide

## Purpose and context
- The director role focuses on verifying event readiness, confirming released results, and accessing audio/packet deliverables. You always start from the **single active event** in the system; if you see more than one event, contact admin immediately, as only one may be live at a time.
- Directors only ever see **released packets**. If a judge or ensemble lacks data in your view, it means administration has not released the official packet yet.

## Getting oriented
1. Sign in with your director account.
2. Confirm the `Dashboard` banner shows the correct school, event, and active ensemble.
3. Prefer one browser tab per role (director vs admin/judge) so you do not accidentally operate in the wrong workspace.

## Key areas

### Dashboard
- Provides the event snapshot, next step cards, and quick links to each workspace.
- Use the **event status** indicator to confirm the system still has only one active event; the remaining roles rely on that invariant.

### Registration vs My Ensembles
- `Registration` contains registration-level data (school, declared grade, contact info).
- `My Ensembles` launches **ensemble workspaces** where you can review repertoire, instrumentation, seating, percussion, and readiness blockers. Click **Open Workspace** or **Next Step** to follow the curated guidance checklist.
- Mark a workspace ready only when the sections required for your load (notes, equipment, seating, etc.) are complete.

### Event Info
- Use this for site-specific logistics, published schedules, and reference documents shared by admin.
- It mirrors the single source of truth schedule, so do not abandon this view for unofficial documents.

### Official Results Packet
- This is the only place to access released judge results, audio, and packet exports.
- Each packet is built from ***officialAssessments***. Any gap in this view means the admin has not released or the judge position still blocks completion.
- Packets display:
  - Audio uploads (confirm playback before sharing results).
  - Captions and scores for all assigned judge positions.
  - Exported files (PDFs, CSV, etc.) that match the release timestamp.

## Release awareness
- Admins may release a packet only when each judge position has submitted and locked their form:
  - Grade I packets require Stage 1, Stage 2, and Stage 3 scores.
  - Grades II–VI additionally require the **sight** stage.
- Each release reflects a deterministic `officialAssessment` key (`{eventId}_{ensembleId}_{judgePosition}`). You can trust packet files to reference that deterministic ID, so any duplicates mean an admin mistake.
- If you expect results that are missing, confirm:
  1. Admin has actually released the packet (check with your admin contact).
  2. The judge position in question submitted and locked (talk to administration if the position is blocked).

## Daily workflow suggestions
1. Start each session by refreshing the page once; occasional cached data can hide a packet until the refresh completes.
2. Use the progress cards on `Dashboard` to navigate; avoid jumping directly into raw data unless you need to confirm something specific.
3. If you need to share a result, play the attached audio from the released packet to ensure the file matches your expectations before quoting scores.

## Troubleshooting
- **Missing audio or captions**: wait for admin release; do not contact judges directly. If the admin says a packet was released, refresh your view and re-open the packet.
- **Packet shows wrong ensemble or grade**: flag the issue to admin through your operations contact. Do not attempt to reroute to another event or ensemble.
- **Unexpected blocking judge position**: confirm the judge submitted and locked. If you still see a blocker after admin confirms submission, ask them to verify the `officialAssessment` was created and the packet is complete before release.

## References
- This workflow is built on deterministic submissions, locked packets, and atomic releases. Always treat a packet as official only when it comes from `Official Results Packet` in your director workspace.
