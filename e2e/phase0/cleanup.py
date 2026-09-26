from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUN_FILE = ROOT / ".state" / "current-run.json"

CLEANUP_TABLES = [
    "staging_b1_audit_log",
    "staging_b1_opportunity_stage_history",
    "staging_b1_activities",
    "staging_b1_pending_items",
    "staging_b1_opportunity_participants",
    "staging_b1_entity_supplier_categories",
    "staging_b1_entity_tags",
    "staging_b1_project_locations",
    "staging_b1_projects",
    "staging_b1_revisions",
    "staging_b1_import_job_items",
    "staging_b1_import_jobs",
    "staging_b1_opportunities",
    "staging_b1_crm_entities",
    "staging_b1_salespeople",
    "staging_b1_test_runs",
]


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> None:
    if not RUN_FILE.exists():
        print("CLEANUP_PASS: no current run state; nothing to remove")
        return
    run = json.loads(RUN_FILE.read_text(encoding="utf-8"))
    prefix = str(run.get("prefix", ""))
    if not prefix.startswith("TESTE_PHASE0_TECH_") or len(prefix) < 25:
        raise RuntimeError("cleanup scope guard rejected invalid run prefix")

    db_url = os.getenv("PHASE0_DATABASE_URL")
    if not db_url:
        raise SystemExit("CLEANUP_BLOCKED: PHASE0_DATABASE_URL must be supplied locally; no admin credential is stored in Git/browser")
    if not shutil.which("psql"):
        raise SystemExit("CLEANUP_BLOCKED: psql is required for FK-safe administrative cleanup")

    like = sql_literal("%" + prefix + "%")
    statements = ["begin;"]
    for table in CLEANUP_TABLES:
        if not table.startswith("staging_b1_"):
            raise RuntimeError("cleanup allowlist contains non-staging table")
        statements.append(f"delete from {table} t where to_jsonb(t)::text like {like};")
    statements.append("commit;")
    sql = "\n".join(statements)
    subprocess.run(
        ["psql", db_url, "-v", "ON_ERROR_STOP=1", "-c", sql],
        check=True, env=os.environ.copy()
    )
    print(f"CLEANUP_PASS: removed only records matching current run prefix {prefix} from staging_b1_* allowlist")
    print("NEXT: run verify_production_isolation.py --stage post-cleanup")


if __name__ == "__main__":
    main()
