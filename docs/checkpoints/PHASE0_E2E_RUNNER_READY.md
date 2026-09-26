# PHASE0 E2E RUNNER READY

Status: **PHASE0-E2E-RUNNER = READY**

This checkpoint prepares a reproducible authenticated browser harness only. It does **not** mark the Phase0 authenticated E2E itself as PASS.

## Official staging

- STAGING_PHASE0_OFFICIAL = `baseline-1.0-staging-phase0-r1-e2e-relations`
- MD5 = `ffcb0358ce7bd94510d1a6d8bf133793`
- EDGE_FUNCTION = `crm-staging-v55-seller-timeline-fix v11 ACTIVE`
- PREVIOUS_STAGING_ARTIFACT = `baseline-1.0-staging-phase0-r1`
- predecessor is preserved; no rollback or redeploy was performed.

## Production remains frozen

- `CRM BASELINE 1.0 R1`
- `crm-prod v13 ACTIVE`
- artifact `baseline-1.0-production-r1`
- MD5 `52f9fd84cb102393fcebf085d68e83ce`

No production change is part of this checkpoint.

## Harness

Implemented under `e2e/phase0/`:

- interactive Playwright authentication;
- local-only storageState;
- exact `/teste/` URL guard;
- production/legacy Edge Function mutation guard;
- staging-only REST mutation guard;
- sanitized network evidence;
- common `TESTE_PHASE0_TECH_<run_id>` markers;
- critical UI flow tests;
- DB preflight/post-cleanup verification;
- idempotent staging-only cleanup;
- offline validation.

## Authentication safety

- password is entered only in the browser;
- storageState stays under Git-ignored `.auth/`;
- no password/JWT/refresh token/cookie/service-role is committed;
- optional email may be supplied locally through `PHASE0_E2E_EMAIL`.

## Database/admin safety

Optional administrative DB access is supplied only at runtime via `PHASE0_DATABASE_URL`.

It is used only by:
- aggregate preflight/post-cleanup test-row verification;
- staging-only cleanup.

It is not used by the browser test and is never written into the repository.

## Cleanup safety

Cleanup requires:
- current run state;
- a prefix beginning `TESTE_PHASE0_TECH_`;
- explicit `staging_b1_*` allowlist;
- local administrative DB connectivity.

No production table is present in the cleanup allowlist.

## Offline validation

Executed without staging network access:

- Python syntax = PASS;
- config parse = PASS;
- unittest discovery/import = PASS;
- 8 real E2E flows discovered and skipped offline = PASS;
- exact staging URL guard = PASS;
- `crm-prod/crm-v58/crm-v57/crm-v56` guard presence = PASS;
- `staging_b1_*` mutation allowlist guard = PASS;
- cleanup marker/scope guard = PASS;
- Git-ignore coverage = PASS;
- static secret-safety scan = PASS.

`PHASE0_E2E_OFFLINE_VALIDATION = PASS`.

## Remaining blocker

The authenticated E2E itself still requires a machine with:
- normal network access to the staging;
- Chromium/Playwright browser;
- a human performing the login directly in the browser;
- approved DB verification/cleanup access when needed.

Therefore:

- FASE0-ETAPA-A-E2E remains BLOCKED until real execution;
- importer hotfix is not started;
- Phase1A is not started.
