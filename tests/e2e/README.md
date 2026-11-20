# End-to-End Test Suite (`tests/e2e/`)

This directory reserves the cross-module end-to-end test harness mapped to `docs/agent-plan/11_TEST_STRATEGY_ACCEPTANCE.md` §11:

- `E2E-1`: Registration → OTP verify → Login → Search alt title → Read First → Layout switch → Continue at page N → Rate 8/10.
- `E2E-2`: Reader submits Account report → Admin inspects logs & locks Reader → Active session revoked → Report resolved & audited.
- `E2E-3`: Admin lists source packages → Selects manga + CDC → ETL imports → Public catalog visibility → CDC new chapter update.
- `E2E-4`: Chapter comment with spoiler → Reply → Edit history → Report → Admin delete with reply placeholder.
- `E2E-5`: Create overlapping lists → Clone/merge dedupe → Membership sync → Metadata stats & hidden manga omission.

Playwright browser tests will be installed and implemented incrementally starting in **Phase 5–6** once public catalog and reader journeys are built.
