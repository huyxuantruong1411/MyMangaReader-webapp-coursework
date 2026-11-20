# Handoff Manifest — Manga Reader Web App Agent Plan

## Purpose
This manifest explains how to consume the plan bundle as persistent project context for Antigravity or another coding agent. The bundle is a reconciled implementation specification, not an assertion that every proposed technical choice already exists in the user's repository.

## Canonical reading order

1. [`00_README_AGENT_ENTRYPOINT.md`](00_README_AGENT_ENTRYPOINT.md) — source hierarchy, non-negotiable invariants, agent protocol.
2. [`01_PRODUCT_SCOPE_AND_REQUIREMENTS.md`](01_PRODUCT_SCOPE_AND_REQUIREMENTS.md) — product scope, actors, eight modules and UC traceability.
3. [`03_DOMAIN_RULES_AND_STATE_MACHINES.md`](03_DOMAIN_RULES_AND_STATE_MACHINES.md) — canonical entities, state transitions, authorization and invariants.
4. [`12_ADR_CONFLICTS_AND_RISKS.md`](12_ADR_CONFLICTS_AND_RISKS.md) — conflict register, 20 ADRs, five adversarial review passes, open product decisions.
5. [`04_DATABASE_SCHEMA_AND_MIGRATIONS.md`](04_DATABASE_SCHEMA_AND_MIGRATIONS.md) — complete inventory of the 39 source tables, relationships, constraints and proposed migrations.
6. Read the relevant feature plan(s):
   - [`05_PACKAGE_V2_ETL_CDC.md`](05_PACKAGE_V2_ETL_CDC.md)
   - [`06_AUTH_SECURITY_MODERATION.md`](06_AUTH_SECURITY_MODERATION.md)
   - [`07_READER_ENGINE_PROGRESS_MEDIA.md`](07_READER_ENGINE_PROGRESS_MEDIA.md)
   - [`08_CATALOG_SEARCH_RECOMMENDATIONS.md`](08_CATALOG_SEARCH_RECOMMENDATIONS.md)
   - [`09_SOCIAL_RATINGS_COMMENTS_LISTS.md`](09_SOCIAL_RATINGS_COMMENTS_LISTS.md)
7. [`02_SCREEN_FRAME_EVENT_FLOWS.md`](02_SCREEN_FRAME_EVENT_FLOWS.md) — screen/frame interactions and UI state behavior.
8. [`10_API_CONTRACTS_AND_EVENTS.md`](10_API_CONTRACTS_AND_EVENTS.md) — proposed endpoint shapes, events, error semantics and idempotency.
9. [`11_TEST_STRATEGY_ACCEPTANCE.md`](11_TEST_STRATEGY_ACCEPTANCE.md) — acceptance matrix, negative paths, regression and end-to-end flows.
10. [`13_IMPLEMENTATION_ROADMAP.md`](13_IMPLEMENTATION_ROADMAP.md) — dependency-aware delivery sequence and Definition of Done.

## File catalogue

| File | Primary purpose |
|---|---|
| `00_README_AGENT_ENTRYPOINT.md` | Source of truth and coding-agent operating contract |
| `01_PRODUCT_SCOPE_AND_REQUIREMENTS.md` | Product requirements, actor scope, use-case coverage |
| `02_SCREEN_FRAME_EVENT_FLOWS.md` | UI screens, frames, events, states and transitions |
| `03_DOMAIN_RULES_AND_STATE_MACHINES.md` | Domain model, business rules and state machines |
| `04_DATABASE_SCHEMA_AND_MIGRATIONS.md` | Source DB inventory, constraints and migration plan |
| `05_PACKAGE_V2_ETL_CDC.md` | Package v2.0 validation, object storage, ETL and CDC |
| `06_AUTH_SECURITY_MODERATION.md` | Account lifecycle, sessions, OTP, permissions, moderation |
| `07_READER_ENGINE_PROGRESS_MEDIA.md` | Reader modes, page loading, progress, media delivery |
| `08_CATALOG_SEARCH_RECOMMENDATIONS.md` | Catalogue, filters, autocomplete, search, recommendations |
| `09_SOCIAL_RATINGS_COMMENTS_LISTS.md` | Ratings, comments, reports, reading lists and list items |
| `10_API_CONTRACTS_AND_EVENTS.md` | Backend interface proposal and event catalogue |
| `11_TEST_STRATEGY_ACCEPTANCE.md` | Verification plan and acceptance criteria |
| `12_ADR_CONFLICTS_AND_RISKS.md` | Contradictions, decisions, residual risks and review rounds |
| `13_IMPLEMENTATION_ROADMAP.md` | Phases, prerequisites, gates and delivery order |
| `14_HANDOFF_MANIFEST.md` | This guide |

## Evidence and decision labels

- **SOURCE REQUIREMENT**: directly stated by one or more supplied files.
- **CANONICAL RULE**: reconciled interpretation selected to make the cross-module behavior consistent.
- **PROPOSED DESIGN**: technical detail introduced to make an underspecified requirement implementable.
- **OPEN PRODUCT DECISION**: product owner needs to confirm before production. The plan may nominate a conservative MVP default, but the choice must remain configurable where practical.

An agent must not silently promote `PROPOSED DESIGN` or `OPEN PRODUCT DECISION` to source requirement. Any change to an accepted decision must update the relevant ADR, schema/API docs and tests together.

## Source set consolidated

- `Lab8.docx`: use-case specifications and embedded activity diagrams.
- `Lab9.docx`: sequence diagrams and class/package diagrams.
- `Lab10.docx`: relational database table specifications and ERD.
- `Pasted text(2).txt`: JSON Schema draft 2020-12 for `manga-reader-package` contract v2.0.

The plan prioritizes the package schema for source-to-reader interchange, Lab10 as the starting target database, Lab9 for interaction sequencing and Lab8 for actor intent and business rules. Contradictions are made explicit in ADRs rather than silently erased.

## Handoff procedure for a new coding-agent session

1. Add this entire folder to the agent's project context (or copy it to the repository under `/docs/agent-plan/`).
2. Instruct the agent to read the canonical reading order before touching code.
3. Ask the agent to inspect the actual repository and report its current stack, modules, migrations, API routes, storage/CDN setup and test coverage. This plan is technology-aware at the domain level but must be reconciled with the existing codebase before choosing frameworks or rewriting architecture.
4. Ask for a source-to-code gap report mapping each UC-ID and ADR to existing files, missing behavior, proposed edits and tests.
5. Implement one roadmap phase at a time. Each phase must end with passing tests and updated traceability.
6. Keep the plan in version control. When a design decision changes, update the ADR first, then dependent implementation docs and tests in the same change set.

## Production blockers to confirm

Before production, resolve all items in section 5 of `12_ADR_CONFLICTS_AND_RISKS.md`, especially account lock cooldown, public-list/share scope, rating eligibility and aggregation, valid-view semantics, report retention, destructive deletion retention, missing NFR thresholds, and operational retention/backup policy.
