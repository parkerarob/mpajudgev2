# Changelog

All notable project-level changes should be recorded here.

## [1.0.0] - 2026-04-03

### Changed

- Consolidated the admin workspace into `Setup`, `Directory`, `Event Prep`, `Event Day`, and `Announcer`.
- Removed the old `teamLead` / `opsLead` role model and standardized production role boundaries on `admin`, `judge`, and `director`.
- Kept raw assessment review, officialization, packet management, and ratings work inside the `Event Day` admin surface.

### Fixed

- Normalized legacy admin hashes so old admin links resolve into the current navigation model.
- Fixed QA issues around status-chip flashing and event-day dropdown population.

### Docs

- Synced operator and product documentation to the shipped admin information architecture.
