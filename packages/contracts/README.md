# `@manga-reader/contracts` — `manga-reader-package:2.0` Contract Package

This package houses the single shared source of truth for the external Manga Reader data contract (`urn:manga-datalake:contract:manga-reader-package:2.0`), JSON Schema Draft 2020-12 validation, TypeScript DTOs, canonical fixtures, and contract tests.

## Source Transparency Notice

> **Important (Phase 0 Audit):** The raw source file `Pasted text(2).txt` referenced in `docs/agent-plan/Setup/00_README_AGENT_ENTRYPOINT.md` was not present in the workspace during initialization.  
> `schemas/manga-reader-package.v2.0.schema.json` has been reconstructed **strictly and faithfully** from every definition, constraint, constant, enum, required field, and `additionalProperties: false` rule documented in `docs/agent-plan/Setup/05_PACKAGE_V2_ETL_CDC.md`.  
> When the original `Pasted text(2).txt` becomes available, diff it verbatim against `schemas/manga-reader-package.v2.0.schema.json` and update only if byte-level differences exist.

## Non-Negotiable Contract Rules

1. **Do NOT add Reader-only fields** (ratings, comments, local visibility, reading lists, progress) to contract v2.0.
2. **Closed Object Contract:** `additionalProperties: false` rejects unexpected nested properties (`ETL-005`).
3. **Strict Version Pinning:** Only `contract_name = "manga-reader-package"` and `contract_version = "2.0"` are accepted; unsupported versions fail closed (`ETL-004`).
4. **Optional `chapters` Semantics (`ADR-012`):** An omitted `chapters` root property means metadata-only update and MUST NEVER delete existing chapters.
5. **Media Identity (`ADR-018`):** `ReaderMediaRef` identifies objects solely by `(bucket, object_key)`; never persist runtime/signed URLs.
6. **Content Rating Safety:** `unknown` is never treated as `safe`.
