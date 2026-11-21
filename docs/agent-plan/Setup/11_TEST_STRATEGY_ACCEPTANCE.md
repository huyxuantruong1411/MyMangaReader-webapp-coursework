# Test Strategy, Acceptance Criteria & Regression Matrix

## 1. Testing pyramid

1. **Schema/contract tests:** JSON Schema v2.0, request/response models, enum/code generation, mapping.
2. **Unit tests:** validators, chapter order, tag query semantics, rating average, reaction state transitions, list name normalization, progress resume mapping.
3. **Repository/integration tests:** uniqueness/FK/transaction behavior, session revoke, counters and outbox.
4. **Service tests:** full command flow with mocked external dependencies.
5. **API contract tests:** auth, owner guards, errors, idempotency and pagination.
6. **UI component/frame tests:** all screen states and event transitions.
7. **End-to-end tests:** representative cross-module journeys.
8. **Load/reliability tests:** search, chapter manifest/image delivery, ETL batch, CDC retry, report queue and reader stats.
9. **Security tests:** IDOR, XSS, CSRF when cookie-based, webhook spoof/replay, token leakage and privilege escalation.

## 2. Acceptance gate by feature

A feature must pass:
- happy path from UC basic flow;
- each alternative/exception branch from UC/activity/sequence diagram;
- domain invariant tests from `03_DOMAIN_RULES_AND_STATE_MACHINES.md`;
- DB constraint/concurrency tests;
- unauthorized/ownership violation tests;
- UI loading/empty/error/forbidden/not-found states;
- activity/audit/event side effects;
- regression tests for linked modules.

## 3. Authentication/account tests (UC-6, UC-1)

| ID | Scenario | Expected |
|---|---|---|
| AUTH-001 | Register with valid unique values | Create PENDING_VERIFICATION account + Reader profile; queue OTP mail |
| AUTH-002 | Duplicate normalized email | Conflict/validation, no second account |
| AUTH-003 | Duplicate normalized username | Conflict/validation, no second account |
| AUTH-004 | Invalid email/password shape | Server rejects, no data persisted |
| AUTH-005 | Password persisted | Only password hash exists; raw secret absent from DB/logs |
| AUTH-006 | OTP correct before TTL | One-time consume; account becomes ACTIVE |
| AUTH-007 | OTP expired | Reject; resend affordance; account remains pending |
| AUTH-008 | OTP wrong | Reject and increment attempt counter; no activation |
| AUTH-009 | OTP replay after success | Reject; no second activation side effect |
| AUTH-010 | OTP resend | Old challenge invalid; new challenge valid; rate-limit applied |
| AUTH-011 | Email provider transient failure | Queue retry; account remains pending |
| AUTH-012 | Login with username + password | Active session created |
| AUTH-013 | Login with email + password | Active session created |
| AUTH-014 | Wrong password / nonexistent user | Same generic credential error; throttle tracked |
| AUTH-015 | Login while PENDING_VERIFICATION | No session; resend verification offered |
| AUTH-016 | Login while LOCKED | No session; safe message |
| AUTH-017 | Failed login rate limit | 429/cooldown; no moderation status mutation |
| AUTH-018 | Logout | Current session revoked |
| AUTH-019 | Refresh token rotation | Previous refresh no longer works; only new session token valid |
| AUTH-020 | Reuse old refresh token | Reject and apply configured reuse response |
| AUTH-021 | Admin lock account with active sessions | All sessions revoked; next protected request rejected |
| AUTH-022 | Admin lock without reason | Validation error; no state change |
| AUTH-023 | Admin locks another Admin | Permission/business rejection |
| AUTH-024 | Admin locks already locked Reader | Idempotent result; no duplicate email/audit event unless explicit new action |
| AUTH-025 | Admin unlocks locked Reader | ACTIVE; lock fields cleared; audit + notification |
| AUTH-026 | Admin unlocks active Reader | Conflict/no-op; no duplicate event |
| AUTH-027 | Profile private DOB | DOB hidden from another Reader |
| AUTH-028 | Profile self/Admin view | Protected data displayed to permitted actor |
| AUTH-029 | Reserved display name with case/spacing variation | Blocked after normalization |
| AUTH-030 | Bio contains script/XSS | Safe sanitized render; no execution |
| AUTH-031 | Future DOB | Reject |
| AUTH-032 | Avatar extension spoof | Actual MIME validation rejects unsupported content |
| AUTH-033 | Avatar over configured size | Reject with field error |
| AUTH-034 | Password change wrong current password | Reject; no session mutation |
| AUTH-035 | Password changed successfully | Hash updated; other sessions revoked; audit |

## 4. Moderation/report tests (UC-1.6/1.7, UC-2, UC-4.9, UC-5.7, UC-6.6)

| ID | Scenario | Expected |
|---|---|---|
| MOD-001 | Anonymous submits report | 401 |
| MOD-002 | Reader reports own account | 422/business rule rejection |
| MOD-003 | Reader reports another account | ACCOUNT PENDING report + activity log |
| MOD-004 | Reader reports manga | MANGA report + target snapshot |
| MOD-005 | Reader reports a chapter | MANGA report with chapter target/snapshot |
| MOD-006 | Reader reports comment | COMMENT report + comment snapshot |
| MOD-007 | Repeated spam reports | Rate limit; logs remain available to Admin |
| MOD-008 | Reader opens Admin report queue | 403 |
| MOD-009 | Admin filters report by type/status | Correct queue results/pagination |
| MOD-010 | Target exists on report detail | Show correct reporter/target/reason/action options |
| MOD-011 | Target deleted before detail | Auto-transition report to CLOSED; audit/closure recorded |
| MOD-012 | Admin resolves valid ACCOUNT report with LOCK | Reader locked; report RESOLVED; action history; sessions revoked |
| MOD-013 | Admin ignores account report | Target unchanged; report IGNORED; history recorded |
| MOD-014 | Admin hides manga from report | Manga HIDDEN; report RESOLVED; search/public cache invalidated |
| MOD-015 | Admin deletes manga from report | Delete workflow started; report result and outbox consistent |
| MOD-016 | Admin deletes comment from report | Comment soft-deleted; report RESOLVED |
| MOD-017 | Admin forces spoiler | `is_spoiler=true`, admin-lock true; Reader cannot unflag |
| MOD-018 | Action mismatched with report type | Reject before side effect |
| MOD-019 | Two Admins resolve same report concurrently | One succeeds; second sees conflict; no duplicate effect |
| MOD-020 | Ignore future reports for manga | Single authoritative manga flag updated; subsequent reports follow declared policy |
| MOD-021 | Activity log filtered by REPORT | Correct account events, read-only |
| MOD-022 | Attempt to update/delete activity log via API | No mutation endpoint / forbidden |
| MOD-023 | Report resolution DB action fails | Report remains PENDING; no success audit claiming completion |
| MOD-024 | Email/CDC cancel fails after report transaction | Outbox retry; report DB action remains committed with pending side effect status |

## 5. Catalog/search/recommendation tests (UC-3)

| ID | Scenario | Expected |
|---|---|---|
| CAT-001 | Public catalogue with manga | Only PUBLIC mangas returned |
| CAT-002 | Hidden manga in DB | Not in list, autocomplete, full search, recommendations or creator works |
| CAT-003 | Sort by updated/views/rating/title | Stable order and pagination boundaries |
| CAT-004 | Empty catalogue | Catalog-specific empty state |
| CAT-005 | Autocomplete by primary title prefix | Relevant suggestions, max 10 |
| CAT-006 | Autocomplete by alternative title | Same manga found |
| CAT-007 | Search with case differences | Match |
| CAT-008 | Search with accents/diacritics removed | Match according to normalization |
| CAT-009 | Fuzzy search small typo | Near match within configured distance |
| CAT-010 | Empty query | No unbounded query or accidental data dump |
| CAT-011 | Creator by Author role | Creator and public works returned |
| CAT-012 | Creator by Artist role | Creator and public works returned |
| CAT-013 | One Creator has both roles | One entity; roles shown without duplicate manga card |
| CAT-014 | Homonymous creators with different IDs | Not merged incorrectly |
| CAT-015 | Creator page filter/sort | AJAX update; page reset; only public works |
| CAT-016 | Filter include/exclude same tag | UI prevents conflict; server rejects malformed query |
| CAT-017 | Include multiple tags | Correct documented OR/AND semantics |
| CAT-018 | Exclude tag | Matching manga removed |
| CAT-019 | Unknown content rating in safe filter | Excluded |
| CAT-020 | Year/language/demographic/status combinations | AND semantics correct |
| CAT-021 | Manga hidden after detail fetch, then chapter open | Server rejects and client invalidates cached data |
| CAT-022 | Item-based sparse interactions | Fallback to content-based/popular |
| CAT-023 | Item-based normal case | Source manga excluded; hidden excluded; top-N ranked |
| CAT-024 | User-based anonymous request | Requires authentication |
| CAT-025 | User-based new Reader | Popular fallback; no exception |
| CAT-026 | User-based candidates already completed/dropped | Excluded |
| CAT-027 | Similar user identity leakage | No user names/IDs exposed |
| CAT-028 | Content-based no score over threshold | Same main tag/high-rated fallback |
| CAT-029 | Newly imported manga recommendation | Feature vector generated/recomputed |
| CAT-030 | Search index update failure | Retry/outbox; DB import not corrupted; index lag observable |

## 6. Reader/progress/media tests (UC-4)

| ID | Scenario | Expected |
|---|---|---|
| READ-001 | Read First with chapters | Opens earliest `chapter_numeric`, page 1 |
| READ-002 | Read First with no chapter | Disabled/NO_CHAPTERS, no blank reader |
| READ-003 | Continue with progress | Opens saved chapter and exact page |
| READ-004 | Continue without progress | Falls back first chapter |
| READ-005 | Select chapter belonging to manga | Opens requested chapter |
| READ-006 | Select chapter ID belonging to other manga | Reject |
| READ-007 | Open hidden manga through direct route | Reject |
| READ-008 | Chapter list with `Extra`, `Prologue`, `10.5` | Sort by numeric key, not string label |
| READ-009 | Multiple languages same chapter numeric | Stable ordering, language selection clear |
| READ-010 | Page numbers contiguous 1..N | Manifest loads |
| READ-011 | Missing page number/duplicate page UID | Ingestion/read manifest fails safe |
| READ-012 | Vertical mode scroll | Active page/progress updates correctly |
| READ-013 | Single-page next/prev | One page per movement |
| READ-014 | Double-page LTR | No skipped/duplicated pages |
| READ-015 | Double-page RTL | Correct visual/navigation order; stored page number unchanged |
| READ-016 | Narrow mobile double-page | Auto-fit or prompt switch; no clipped unusable reader |
| READ-017 | Fit Width/Height/Original | Aspect ratio preserved |
| READ-018 | Switch display mode mid-chapter | Same page identity retained |
| READ-019 | Reader settings saved | Persists across chapter and next login |
| READ-020 | Reader settings API fails | Local preview remains; error/retry visible |
| READ-021 | Prefetch count default | Next 3 pages/spreads preloaded per agreed semantics |
| READ-022 | One image fails | Per-page placeholder/retry; rest of chapter continues |
| READ-023 | CDN signed URL expires | Refresh once then recover |
| READ-024 | Missing object | Broken page placeholder/report affordance |
| READ-025 | Media checksum mismatch at ETL | Asset quarantined/not rendered |
| READ-026 | Chapter pages revision changes | Cache invalidated; progress mapping fallback works |
| READ-027 | Progress update from stale old tab | Stale write rejected/not overwriting newer progress |
| READ-028 | Reader opens chapter twice | Two history rows as designed; progress remains one current row |
| READ-029 | Progress checkpoint | Updates `reader_progress`, not `reading_histories` per scroll |
| READ-030 | View threshold not met | `is_valid_view=false`; no counter increment |
| READ-031 | View threshold reached | Mark one valid view and increment counters exactly once |
| READ-032 | Repeated F5/retry | Does not inflate view count under configured dedupe rule |
| READ-033 | Next chapter at final page | Opens next ordered chapter and records new open |
| READ-034 | No previous/next chapter | Controls disabled or informative state |

## 7. Rating/comment/reaction tests

| ID | Scenario | Expected |
|---|---|---|
| SOC-001 | Rate without chapter-open history | `RATING_REQUIRES_READING` |
| SOC-002 | Rate with open chapter | Create rating + CREATE history |
| SOC-003 | Update rating | UPDATE history old/new accurate |
| SOC-004 | Remove rating | `is_removed`; REMOVE history; average recalculated |
| SOC-005 | Score 0 or 11 | DB/API reject |
| SOC-006 | Concurrent rating update | Unique row + accurate histories/average |
| SOC-007 | Read own rating history | Descending event list |
| SOC-008 | Create empty comment | Reject |
| SOC-009 | Create 2,001-character comment | Reject |
| SOC-010 | Create manga-level comment | `chapter_id=NULL` |
| SOC-011 | Create chapter-level comment | Chapter must belong to manga |
| SOC-012 | Reply to valid root | Parent FK saved; appears under root |
| SOC-013 | Reply across manga/chapter context | Reject |
| SOC-014 | Reply to deleted parent | Reject or defined policy; no orphan |
| SOC-015 | Edit own comment | Previous content/spoiler snapshot stored before update |
| SOC-016 | Edit another user's comment | 403/404 |
| SOC-017 | Edit deleted comment | Reject |
| SOC-018 | User unchecks Admin-locked spoiler | Server rejects or keeps locked spoiler |
| SOC-019 | Admin force spoiler | Spoiler flag + lock flag updated |
| SOC-020 | History view | Read-only previous versions, correct author/time |
| SOC-021 | Delete comment without replies | Soft-deleted/omitted |
| SOC-022 | Delete comment with replies | Deleted placeholder shown |
| SOC-023 | Repeat delete request | Idempotent; no duplicate side effects |
| SOC-024 | LIKE from none | like +1 |
| SOC-025 | Switch LIKE to DISLIKE | like -1, dislike +1 |
| SOC-026 | Remove DISLIKE | dislike -1 |
| SOC-027 | Concurrent reactions | One row per user/comment; counters reconcile |
| SOC-028 | React to deleted comment | Rejected |
| SOC-029 | XSS payload in comment | No script execution |

## 8. Lists and metadata stats tests

| ID | Scenario | Expected |
|---|---|---|
| LIST-001 | Create list with valid name | New list count 0 |
| LIST-002 | Empty/whitespace name | Reject |
| LIST-003 | Duplicate normalized name same owner | Conflict |
| LIST-004 | Same name by different owner | Allowed |
| LIST-005 | Edit list name conflict | Reject; existing list unchanged |
| LIST-006 | Non-owner accesses list ID | 404/403 without leakage |
| LIST-007 | Search My Lists | Only caller's lists |
| LIST-008 | Delete list | Membership rows removed; manga/history unchanged |
| LIST-009 | Clone one list | New list + distinct memberships; source unchanged |
| LIST-010 | Merge two lists with overlap | Deduped manga; count correct |
| LIST-011 | Clone no source lists | Validation error |
| LIST-012 | Clone all-empty selected lists | Confirmation required; explicit confirm succeeds |
| LIST-013 | Clone list not owned by caller | Reject all; no partial new list |
| LIST-014 | Add manga to several lists | Desired set reflected, counts correct |
| LIST-015 | Repeat same membership request | No duplicate rows/count drift |
| LIST-016 | Uncheck existing list | Membership removed, count decrement once |
| LIST-017 | Add to list not owned | Reject |
| LIST-018 | Quick-create from modal | List created and selected membership applied |
| LIST-019 | Remove manga from list | Only membership removed; rating/history/status unaffected |
| LIST-020 | Search title within list | Only list items searched |
| LIST-021 | Search creator within list | Only list items searched |
| LIST-022 | Filter list by tag/status/read state | Only current list's items returned |
| LIST-023 | Empty list stats | Exact empty stats state |
| LIST-024 | Tag distribution | Percent uses documented denominator; may sum >100% when multiple tags |
| LIST-025 | Rating avg with unrated manga | Uses documented method and rated sample count |
| LIST-026 | Hide manga in list | Membership retained; hidden omitted from visible list/stats |
| LIST-027 | Delete manga | Membership refs removed; all affected counts reconcile |
| LIST-028 | Manga metadata tag update | List stats cache invalidated |

## 9. ETL and CDC tests

| ID | Scenario | Expected |
|---|---|---|
| ETL-001 | Fetch available source list succeeds | Render selectable package list |
| ETL-002 | External source timeout | Error + retry; no stale successful selection assumption |
| ETL-003 | Valid v2.0 package | Schema validates and imports |
| ETL-004 | Wrong contract name/version | Item fails actionable unsupported version |
| ETL-005 | Unknown extra nested property | Rejected due `additionalProperties:false` |
| ETL-006 | Missing required root manga/exported_at | Rejected |
| ETL-007 | Missing optional chapters | Metadata-only; existing chapters not deleted |
| ETL-008 | `unknown` content rating | Stored unknown, treated not safe |
| ETL-009 | Duplicate `pool_manga_id` import | Idempotent upsert, no duplicate manga |
| ETL-010 | Same manga slug but different pool ID | Unique conflict; no title-based merge |
| ETL-011 | Chapter belongs to different pool manga | Item fails integrity check |
| ETL-012 | Page numbers noncontiguous | Item fails validation |
| ETL-013 | page_count differs from page array | Item fails validation |
| ETL-014 | Media sha mismatch | Asset rejected/quarantined |
| ETL-015 | One bad manga in batch | Item rollback; other items continue |
| ETL-016 | Successful item with CDC off | No provider subscription |
| ETL-017 | Successful item with CDC on | Subscription persisted; state matches manga flag |
| ETL-018 | Retry failed transient item | Retry count and status progress; no duplicates |
| ETL-019 | CDC same event ID twice | One effect only |
| ETL-020 | CDC event out of order | Lower revision does not overwrite newer state |
| ETL-021 | CDC event network interruption | Durable queue and retry; no loss |
| ETL-022 | Invalid CDC payload | Quarantine/FAILED, not infinite retry |
| ETL-023 | Delete while is_syncing | Delete blocked |
| ETL-024 | CDC arrives after deletion tombstone | Event rejected/quarantined; manga not recreated |
| ETL-025 | Chapter update increments pages_revision | Page manifest refreshed, cached page keys invalidated |
| ETL-026 | Job aggregate with some failures | PARTIAL_FAILED and per-item details |

## 10. Performance/reliability/security acceptance

### Performance
- Measure autocomplete latency with real index and realistic query volume; diagram target ~300ms is a design cue.
- Measure item-based recommendation query; activity diagram suggests ~500ms target.
- Measure manga detail metadata first paint, list pages, Admin stats, reader page image CDN and ETL throughput.
- Do not claim numeric targets absent in source; set project SLO after benchmark.

### Reliability
- Kill worker mid-ETL; job item can resume without duplicate data.
- Kill CDC consumer after DB commit before MQ ack; redelivery does not duplicate effect.
- Lose provider webhook registration response; reconciliation checks subscription before retry/register duplicate.
- Storage upload success but DB transaction fails; staged object cleanup works.
- DB commit success but search index fails; outbox replays.

### Security
- Reader IDOR: modify user/list/reading history IDs.
- Admin endpoint role bypass: direct API call from Reader.
- CSRF if cookie auth; XSS in all user/source text fields.
- Webhook forgery/replay and SSRF in external URLs.
- Token/OTP leakage in logs, errors, telemetry.
- Race: lock account concurrent with login/refresh; moderation concurrent with target deletion; rating/list/reaction updates.

## 11. Cross-module end-to-end journeys

### E2E-1 Registration → read → continue → rating
1. Register.
2. Verify OTP.
3. Login.
4. Search manga by alternate title.
5. Open manga detail.
6. Read First.
7. Change to vertical then single-page; page anchor persists.
8. Read to page N and refresh.
9. Reopen Continue; same chapter/page restored.
10. Rate 8/10; average and rating history update.

### E2E-2 Report moderation → account lock
1. Reader submits account report.
2. Admin sees report pending.
3. Admin inspects reporter activity logs.
4. Admin locks target with reason.
5. Target's existing session is revoked and mutation request fails.
6. Report state resolves; report action history + activity log appear.

### E2E-3 ETL → CDC → reader visibility
1. Admin lists ready package sources.
2. Selects manga and turns CDC on.
3. ETL validates/imports package.
4. Manga appears in public catalog/search/recommendations.
5. Upstream creates a new chapter event.
6. Event stored once, queue processed and chapter upserted.
7. Latest chapter card and chapter list update.

### E2E-4 Comment → reply → edit → moderation delete
1. Reader A creates a chapter comment with spoiler.
2. Reader B replies.
3. Reader A edits text; edit history preserved.
4. Reader B reports comment.
5. Admin deletes comment.
6. Thread shows placeholder if reply exists; report history remains.

### E2E-5 List clone and statistics
1. Reader creates two lists with overlapping mangas.
2. Clone/merge both with a new name.
3. Duplicate mangas appear once.
4. Open new list; add/remove membership and verify count.
5. View metadata stats; hide one manga and verify visibility/stat rules.

## 12. Definition of Done checklist

- [ ] Requirement mapped to UC-ID.
- [ ] Basic flow complete.
- [ ] Alternative/exception flows tested.
- [ ] Server-side authorization/ownership guard tested.
- [ ] DB constraints/migrations tested.
- [ ] Transaction/outbox/idempotency behavior tested.
- [ ] Audit/activity side effects tested.
- [ ] UI loading/empty/error/forbidden/not-found states tested.
- [ ] API response/error contract documented.
- [ ] Logs/metrics avoid secrets and contain correlation IDs.
- [ ] Regression tests for affected cross-module features pass.
- [ ] Plan/ADR/traceability updated.
