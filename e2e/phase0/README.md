# Phase 0 authenticated E2E runner

Purpose: reproduce the **Phase0 authenticated browser E2E** against the official staging only.

Official staging:
- URL: `https://fluxo-solar-crm.pages.dev/teste/`
- artifact: `baseline-1.0-staging-phase0-r1-e2e-relations`
- MD5: `ffcb0358ce7bd94510d1a6d8bf133793`
- Edge Function: `crm-staging-v55-seller-timeline-fix v11 ACTIVE`

This runner must never be pointed at production for writes.

## Safety model

- Password is typed directly into the browser, never terminal/chat.
- `storageState` is stored only under `e2e/phase0/.auth/` and is Git-ignored.
- No Authorization/JWT/cookie/request body is written to the network report.
- Business writes are blocked unless the REST destination begins with `staging_b1_` or `staging_`.
- Writes to `crm-prod`, `crm-v58`, `crm-v57`, `crm-v56`, another Edge Function, RPC or Storage are aborted.
- The test refuses to start without zero-count preflight evidence for `TESTE_PHASE0_TECH_*` in production and staging.
- Cleanup accepts only the current `TESTE_PHASE0_TECH_<run_id>` prefix and an explicit `staging_b1_*` allowlist.

## 1. Install

```bash
python -m pip install -r e2e/phase0/requirements-e2e.txt
playwright install chromium
```

## 2. Offline validation

Does not open staging and does not write data:

```bash
python e2e/phase0/validate_offline.py
```

Validates:
- Python syntax;
- import/test discovery;
- exact staging URL;
- production-write guard;
- cleanup scope guard;
- Git-ignore coverage;
- static secret-safety scan.

## 3. Authenticate manually

Optional email prefill:

```bash
export PHASE0_E2E_EMAIL='your-email@example.com'
```

Then:

```bash
cd e2e/phase0
python auth_setup.py
cd ../..
```

A headed Chromium window opens. Type the password **only in the browser**. The script detects the Supabase session and writes local storage state under `.auth/`.

Never commit `.auth/`.

## 4. Database preflight before any write

Preferred: use local administrative database access through an environment variable that is never committed:

```bash
export PHASE0_DATABASE_URL='postgresql://...'
python e2e/phase0/verify_production_isolation.py --stage preflight
```

The script only records aggregate `TESTE_PHASE0_TECH_*` counts and never prints the connection string.

If your approved DB access is through another tool, run the same check there and start the verifier without `PHASE0_DATABASE_URL`; enter **only the two verified integer counts**.

The E2E refuses to write unless both counts are zero.

## 5. Run the critical authenticated E2E

```bash
PHASE0_E2E_RUN=1 PYTHONPATH=e2e/phase0 \
python -m unittest discover -s e2e/phase0 -p 'test_phase0_critical.py' -v
```

Optional headless mode after initial interactive authentication:

```bash
PHASE0_E2E_RUN=1 PHASE0_HEADLESS=1 PYTHONPATH=e2e/phase0 \
python -m unittest discover -s e2e/phase0 -p 'test_phase0_critical.py' -v
```

A common run ID is persisted in `.state/current-run.json`. Every marker starts with:

`TESTE_PHASE0_TECH_<run_id>_...`

Flows:
1. contact create/edit/save/reopen/search;
2. company create/edit/save/reopen;
3. opportunity create/edit/status/responsible/save/reopen;
4. activity/history evidence;
5. pending item create/view/state persistence;
6. participant add/reopen and removal when supported;
7. seller/team read validation only;
8. revision/history evidence.

Selectors use semantic Portuguese labels/roles with fallbacks. If the live UI differs, the flow returns FAIL/BLOCKED rather than inferred PASS.

## 6. Evidence

Local and Git-ignored:
- `.evidence/network.jsonl`: timestamp, method, sanitized URL, request category, HTTP status;
- `.evidence/flow-results.json`: PASS/FAIL/BLOCKED by flow;
- `.evidence/preflight.json`;
- `.evidence/post-cleanup.json`;
- traces/screenshots may be stored under `traces/` or `test-results/`.

The runner intentionally does not record headers, JWT, cookies, passwords, refresh tokens, request payloads or response bodies.

## 7. Cleanup

Cleanup is a separate administrative action and never uses the browser credential.

```bash
export PHASE0_DATABASE_URL='postgresql://...'
python e2e/phase0/cleanup.py
python e2e/phase0/verify_production_isolation.py --stage post-cleanup
```

It is idempotent and deletes only rows in the explicit `staging_b1_*` allowlist whose JSON representation contains the **current run prefix**.

If `PHASE0_DATABASE_URL` is unavailable, cleanup returns `CLEANUP_BLOCKED`; do not improvise with production/browser credentials.

## Pass rule

The existence of this harness is **not an E2E PASS**.

Phase0 remains blocked until:
- authenticated browser flows execute successfully;
- real staging/backend persistence is confirmed;
- no test write reaches production;
- cleanup succeeds;
- post-cleanup confirms `TESTE_PHASE0_TECH_* = 0` in both staging and production.
