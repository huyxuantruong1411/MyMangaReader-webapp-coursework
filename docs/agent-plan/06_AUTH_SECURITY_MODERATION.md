# Authentication, Account Security, RBAC & Moderation

## 1. Security objectives

- A user can only access their own private account/list/activity/reading data unless an explicit Admin permission grants access.
- A locked or pending Reader cannot use authenticated mutation features.
- Admin moderation effects must be auditable, attributable and replay-safe.
- One-time credentials and long-lived refresh secrets must not be stored in plaintext.
- Source package, media keys, report descriptions, comments, bios and external URLs are untrusted input.

## 2. Registration and email verification

### 2.1 Register command

Request fields: `email`, `username`, `password` (password confirmation can be client-only).

Server order:
1. Validate input shape, max lengths and encoding.
2. Normalize email and username according to a documented invariant. Preserve display casing separately if required.
3. Validate email syntax and username policy; check account uniqueness using normalized unique constraints.
4. Apply password policy from configuration; exact minimum length/complexity is missing from source.
5. Hash password with Argon2id or bcrypt (algorithm is deployment/config decision); store hash only.
6. Create `accounts.status=PENDING_VERIFICATION`, `readers` profile, account activity/audit as appropriate.
7. Create OTP challenge. Sequence diagram indicates 120-second TTL; OTP is single-use and should be six digits if product adopts this proposal. Store only a keyed/hash value in shared Redis/cache, bound to account/email and challenge ID; never in SQL.
8. Enqueue email job asynchronously.
9. Return registration state; do not return the OTP in API response or logs.

### 2.2 OTP verify command

- Input: email/account identifier + code; challenge must be current and bound to same account.
- Verify not expired; apply per-account/IP attempt limit; constant-time compare hashed OTP.
- Consume exactly once atomically; second use fails even if code matches.
- Change status only if still `PENDING_VERIFICATION`; if already ACTIVE return idempotent “already verified” or a stable conflict result.
- Expired/wrong OTP returns distinct safe code for user recovery, but avoid account enumeration if needed.
- Resend invalidates prior OTP and enforces cooldown/rate limit; queue email.

### 2.3 Email worker

- Consume queued messages; provider errors retry with capped exponential backoff.
- Do not put OTP in normal application logs/traces. If message queue must carry the plaintext OTP for sending, encrypt the payload at rest and constrain retention/access; never persist it in the relational account DB.
- On repeated provider failure, expose delivery status/retry to Admin or user; do not activate account without OTP success.

## 3. Login, throttling and session security

### 3.1 Login sequence

1. Accept email or username + password.
2. Normalize identifier; apply rate-limit by IP + normalized identity (avoid a single identity lock causing denial of service).
3. Fetch account and verify hash; generic invalid credentials response for unknown user/wrong password.
4. If `LOCKED`, deny; never issue tokens.
5. If `PENDING_VERIFICATION`, deny session and show resend verification.
6. If ACTIVE, reset failed counter and create session.
7. Generate strong random refresh token; store only its hash in `user_sessions.refresh_token_hash`.
8. Issue short-lived access JWT carrying `session_id`/JTI, subject/account and expiry; do not place email/private profile/reason into token unnecessarily.
9. Write LOGIN activity log with IP/user agent where available.

### 3.2 Failed login and lockout

- Persist `failed_login_attempts` if used, but temporary cooldown lives in Redis/shared cache with TTL.
- The source omits threshold and duration; keep in configuration and add tests.
- Admin `LOCKED` is a separate permanent-until-admin-action account state; do not conflate with temporary throttle.
- Avoid revealing whether an account is registered in credential error messages; after valid password, the response may explain PENDING/LOCKED state.

### 3.3 Refresh/logout/revocation

- Session valid only if access token is valid, session row exists, `revoked_at IS NULL`, `expires_at > now`, and account still ACTIVE.
- Refresh endpoint verifies refresh token hash and rotates token hash; previous refresh token becomes unusable.
- Logout revokes current session.
- Admin lock revokes all sessions immediately.
- Password change revokes other sessions; explicit current-session rotation policy is documented in ADR.
- Concurrent refresh requests must not create two valid refresh token branches. Use row lock/rotation nonce or equivalent.
- Account deletion/compromise should revoke session rows and relevant token families.

## 4. RBAC and ownership matrix

| Operation | Anonymous | Active Reader | Locked/Pending Reader | Admin |
|---|---:|---:|---:|---:|
| Public catalogue/detail | Yes | Yes | Public read may remain; no mutations | Yes |
| Read public chapter | Yes (product default) | Yes | Public read may remain; account state has no effect on anonymous public content | Yes |
| View public Reader profile | Yes/limited | Yes/limited | Yes/limited | Yes |
| View own private email/DOB if private | No | Yes | Yes after login only if account policy permits | Yes |
| Update avatar/profile/password | No | Yes (self) | No | Not through Reader self-service unless impersonation feature exists |
| Reading status/history/progress | No | Yes (self) | No | Admin stats may read target, not impersonate |
| Rating/comment/reaction/report | No | Yes | No | Moderation actions only |
| My reading lists/clone/membership | No | Yes (self-owned) | No | Admin no implicit ownership |
| Activity logs | No | No | No | Yes |
| Lock/unlock Reader | No | No | No | Yes, not another Admin per UC-1.2 |
| Hide/show/delete manga | No | No | No | Yes |
| ETL source selection/CDC | No | No | No | Yes |

Backend must enforce this matrix. Hiding a menu item is not authorization.

### 4.1 Role checks

- Resolve account role from `admins` or `readers` subtype; don't rely on client claims only.
- `admins.role_level` needs a policy mapping. MVP may treat authorized Admin as all admin permissions; preserve ability for granular roles.
- Reject Admin-as-target in user lock operation; separate emergency admin lifecycle from Reader moderation.
- All account ID parameters on self-scoped endpoints are ignored or rejected; obtain acting Reader from session.

## 5. Account profile safety

- `display_name`: non-empty, bounded (DB max 100), reserved name/impersonation detection after normalization, profanity policy configurable.
- `bio`: optional, bounded by configured max; sanitize HTML/Markdown rendering. Do not trust escaped input alone; render Markdown with raw HTML disabled/sanitized.
- DOB: not future; age sanity upper bound configured. `is_birth_date_public` is required for public profile output.
- Avatar: allow only configured formats JPG/PNG/WebP; validate decoded actual MIME, dimensions and file size, not just extension; random object key; strip metadata/re-encode if processing service available; serve via trusted media service.
- Don't let avatar URL field become arbitrary remote URL; prefer media object reference, or validate against allowed storage host.

## 6. Password update

1. Require active authenticated account and re-auth by current password.
2. Validate new password and confirmation.
3. Disallow same password as old (as UC-6.3 states).
4. Hash and update `password_hash` in transaction.
5. Revoke old sessions with `PASSWORD_CHANGE` except the session being rotated/retained by policy.
6. Write activity/audit event; notify security channel as recommended.
7. Never expose current/new password in logs, events, exception metadata or analytics.

## 7. Activity logs and audit

### 7.1 Activity log types

Baseline examples in Lab10: `LOGIN`, `COMMENT`, `RATING`, `REPORT`, `LIST_ITEM_ADDED`, `ACCOUNT_LOCK`.

Recommended additional stable codes:
`ACCOUNT_UNLOCK`, `PASSWORD_CHANGE`, `PROFILE_UPDATE`, `AVATAR_UPDATE`, `MANGA_HIDE`, `MANGA_SHOW`, `MANGA_DELETE_REQUESTED`, `MANGA_DELETE_COMPLETED`, `REPORT_RESOLVE`, `REPORT_IGNORE`, `READING_STATUS_CHANGED`, `CHAPTER_OPENED`, `VALID_VIEW_RECORDED`, `LIST_CREATED`, `LIST_UPDATED`, `LIST_DELETED`, `LIST_CLONED`, `CDC_SUBSCRIPTION_CHANGED`.

These are proposed event names; use an enum registry and schema version for `details_json`.

### 7.2 Immutability

- No update/delete API for activity logs.
- Only a DB role/service writer can insert; application query APIs read-only.
- Admin can filter by account/event/time and paginate, sorted by time.
- Store IP/user-agent only when needed; apply retention/privacy policy.
- System-generated events may have null account ID; Admin operations set actor Admin ID and target type/id.

## 8. Report submission

### 8.1 Shared fields

- `report_type`: `ACCOUNT`, `MANGA`, `COMMENT`.
- `reason_category`: controlled options by report type; description optional.
- `status=PENDING` at creation.
- `reporter_reader_account_id` from authenticated session, not request body.
- Snapshot target display/identity fields so Admin retains evidence when target is removed.
- Activity log includes report ID and target type; not necessarily full user-supplied description if sensitive.

### 8.2 ACCOUNT report (UC-6.6)

- Must be signed in and ACTIVE.
- Cannot report own account.
- Reason categories include avatar/bio inappropriate, impersonation, harassment, spam/destructive behavior (exact catalogue configurable).
- Anti-spam throttle; repeated fake reports create suspicious activity signal.
- Admin action options: lock target Reader or ignore.

### 8.3 MANGA / chapter report (UC-4.9)

- Manga required; chapter optional.
- Snapshot target manga ID/title and chapter label/title at report time.
- Reason categories should include wrong/missing/invalid images/data/content violation/other (exact categories need product configuration).
- Admin actions: Hide manga, Delete manga, Ignore; optionally disable future reports globally for the manga.

### 8.4 COMMENT report (UC-5.7)

- Report comment ID + snapshot/excerpt.
- Admin actions: delete comment, force spoiler/lock spoiler flag, lock offending Reader where authorized, or Ignore (as activity diagram indicates).
- Report target may already be deleted; auto-close report to CLOSED.

### 8.5 Duplicate and rate rules

- Exact numeric rate limits missing. Configure per account/IP and target.
- Recommended avoid multiple active PENDING reports by same user for same target and reason; return existing pending report or stable duplicate response.
- Do not globally dedupe all reports across users; multiple reports may corroborate an issue.
- If `mangas.ignore_all_reports=true`, define whether new reports are rejected, auto-ignored, or accepted as hidden telemetry. Recommended: accept only if policy requires evidence, auto-mark IGNORED with reason “future reports disabled”; do not silently discard.

## 9. Admin moderation queue and command workflow

### 9.1 Query/filter frame

- Admin-only.
- Filters: report type + status; default PENDING.
- Detail includes reporter, target snapshot/current target, category, description, created timestamp.
- Do not make target user's private data visible to ordinary Reader.

### 9.2 Target existence check

- Before showing action buttons, verify target still exists and is eligible.
- Missing target → update report to CLOSED and `resolved_at`, record system closure in action history (Admin ID nullable would require DB adjustment; alternative: system actor via `activity_logs` and omit admin action history). This exact actor field issue should be resolved in schema; see ADR-010.
- Do not execute stale target action after a concurrent delete.

### 9.3 Atomic moderation command

For a human-selected action:
1. Begin transaction/lock report row (optimistic version field acceptable).
2. Require status PENDING and current Admin permission.
3. Re-check target existence/current state.
4. Validate action allowed for report type.
5. Apply local DB target effect (lock/hide/delete comment/force spoiler/ignore flag).
6. Update report status and `action_taken`, resolution note, `resolved_by_admin_account_id`, `resolved_at`.
7. Insert `report_action_histories(previous_status,new_status,action_type,action_note,admin,time)`.
8. Insert immutable `activity_logs` event with actor and target.
9. Enqueue outbox tasks for email, session revoke propagation, search reindex, CDC cancellation, media GC as needed.
10. Commit; then publish async work.

If target operation fails, report must remain PENDING; do not mark RESOLVED just because Admin clicked.

### 9.4 Ignore semantics

- IGNORE does not change target entity visibility/status.
- Save Admin note and history; report becomes IGNORED.
- If Admin chooses ignore future manga reports, update one authoritative manga-level flag.
- Ignore must not suppress audit or hide the report from historical filtered view.

## 10. Lock/unlock details

### Lock
- Target Reader must be ACTIVE (idempotent response if already locked can be “already locked”, not reexecute email/session invalidation repeatedly).
- Reason is mandatory, max 500 according to `accounts.lock_reason`.
- Set `status=LOCKED`; lock metadata; update timestamp; revoke all sessions; log actor/target/before/after/reason; enqueue email.
- Locked user cannot login/comment/rate/report. Also block reading status/list changes and authenticated reader progress writes; no reason to block public browsing.

### Unlock
- Target must be LOCKED; note/reason mandatory.
- Set ACTIVE; clear current lock fields; update status change; log actor/target/before/after/note; enqueue email.
- No new session is automatically created; user logs in normally.
- 7-day lock/unlock note is ambiguous and not enforced in the canonical MVP until product decision.

## 11. Security threat checklist

- Credential stuffing/brute force: rate limits, password hashing, generic credential errors.
- Session theft/reuse: refresh rotation, hash storage, revoke checks, TLS, HttpOnly/Secure/SameSite cookies if cookie transport.
- IDOR: owner guard on list/profile/history/rating/comment/edit/read state; test changing IDs.
- XSS: comments, bios, report description, manga synopsis, tag labels; safe Markdown rendering.
- CSRF: if cookie-based auth, CSRF protection for state mutations.
- SSRF/open redirect: external manga links and avatar URL; allowlist safe protocols; validate redirect target.
- Storage traversal: media bucket/object key validation; never allow client to request arbitrary bucket/key.
- Webhook spoof/replay: signature, timestamp tolerance, event unique IDs, idempotency.
- Race conditions: moderation/report update, lock/session creation, list membership, reaction counts.
- Privilege escalation: Admin routes server-guarded; target Admin lock denied.
- Audit leakage: no OTP/token/password or full sensitive payloads in logs.
