from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EVIDENCE = ROOT / ".evidence"
PREFIX = "TESTE_PHASE0_TECH_"

PRODUCTION_TABLES = [
    "opportunities", "crm_entities", "activities", "pending_items",
    "revisions", "opportunity_participants", "salespeople"
]
STAGING_TABLES = [
    "staging_b1_opportunities", "staging_b1_crm_entities", "staging_b1_activities",
    "staging_b1_pending_items", "staging_b1_revisions",
    "staging_b1_opportunity_participants", "staging_b1_salespeople"
]


def sql_count(tables: list[str]) -> str:
    return " + ".join(
        f"(select count(*) from {table} t where to_jsonb(t)::text like '%{PREFIX}%')"
        for table in tables
    )


def run_psql(database_url: str) -> tuple[int, int]:
    if not shutil.which("psql"):
        raise RuntimeError("psql is not installed")
    sql = f"select ({sql_count(PRODUCTION_TABLES)})::bigint, ({sql_count(STAGING_TABLES)})::bigint;"
    proc = subprocess.run(
        ["psql", database_url, "-At", "-c", sql],
        check=True, text=True, capture_output=True, env=os.environ.copy(),
    )
    prod, staging = proc.stdout.strip().splitlines()[-1].split("|")
    return int(prod), int(staging)


def prompt_int(label: str) -> int:
    raw = input(label).strip()
    if not raw.isdigit():
        raise RuntimeError("count must be a non-negative integer")
    return int(raw)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=["preflight", "post-cleanup"], required=True)
    args = parser.parse_args()
    EVIDENCE.mkdir(parents=True, exist_ok=True)

    db_url = os.getenv("PHASE0_DATABASE_URL")
    if db_url:
        prod, staging = run_psql(db_url)
        source = "direct_database_psql"
    else:
        print("PHASE0_DATABASE_URL não definido. Use o mecanismo administrativo seguro existente e informe SOMENTE as contagens.")
        prod = prompt_int("TESTE_PHASE0_TECH_* em produção: ")
        staging = prompt_int("TESTE_PHASE0_TECH_* em staging: ")
        source = "operator_verified_database_counts"

    data = {
        "stage": args.stage,
        "production_test_rows": prod,
        "staging_test_rows": staging,
        "source": source,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    path = EVIDENCE / ("preflight.json" if args.stage == "preflight" else "post-cleanup.json")
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(json.dumps(data, indent=2))
    if prod != 0 or staging != 0:
        raise SystemExit("BLOCKED: TESTE_PHASE0_TECH_* residue detected")
    print("ISOLATION_DB_CHECK=PASS")


if __name__ == "__main__":
    main()
