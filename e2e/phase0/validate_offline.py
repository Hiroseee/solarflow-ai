from __future__ import annotations

import ast
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
PY_FILES = sorted(ROOT.glob("*.py"))
SENSITIVE_PATTERNS = [
    re.compile(r"service_role\s*[:=]\s*['\"][^'\"]+", re.I),
    re.compile(r"password\s*[:=]\s*['\"][^'\"]+", re.I),
    re.compile(r"eyJ[a-zA-Z0-9_-]{20,}\.eyJ[a-zA-Z0-9_-]{20,}"),
]


def check(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)
    print("PASS:", message)


def main():
    for path in PY_FILES:
        ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    check(True, f"python syntax for {len(PY_FILES)} files")

    config = json.loads((ROOT / "playwright.config.json").read_text(encoding="utf-8"))
    check(config["base_url"] == "https://fluxo-solar-crm.pages.dev/teste/", "staging base URL is exact /teste/")
    check(config["allowed_edge_function"] == "crm-staging-v55-seller-timeline-fix", "allowed edge function is current staging")

    guard = (ROOT / "production_isolation.py").read_text(encoding="utf-8")
    for name in ["crm-prod", "crm-v58", "crm-v57", "crm-v56"]:
        check(name in guard, f"production/legacy edge guard includes {name}")
    check("staging_b1_" in guard, "REST write allowlist requires staging tables")

    cleanup = (ROOT / "cleanup.py").read_text(encoding="utf-8")
    check("TESTE_PHASE0_TECH_" in cleanup, "cleanup requires Phase0 marker")
    check("staging_b1_" in cleanup and "CLEANUP_TABLES" in cleanup, "cleanup uses explicit staging allowlist")
    check('table.startswith("staging_b1_")' in cleanup, "cleanup runtime scope guard blocks non-staging table")

    gitignore = (REPO / ".gitignore").read_text(encoding="utf-8")
    for item in [".auth/", ".state/", ".evidence/", "playwright-report/", "test-results/", "traces/"]:
        check(item in gitignore, f"gitignore protects {item}")

    scanned = []
    for path in [REPO / ".gitignore", *PY_FILES, ROOT / "README.md", ROOT / "playwright.config.json"]:
        text = path.read_text(encoding="utf-8")
        scanned.append(path)
        for pattern in SENSITIVE_PATTERNS:
            if pattern.search(text):
                raise AssertionError(f"possible committed secret in {path}: {pattern.pattern}")
    check(True, f"secret-safety static scan for {len(scanned)} files")

    import os
    env = {k: v for k, v in os.environ.items() if k != "PHASE0_E2E_RUN"}
    proc = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", str(ROOT), "-p", "test_*.py", "-v"],
        text=True, capture_output=True, env=env,
    )
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    check(proc.returncode == 0, "unittest discovery/import passes offline")
    check("skipped" in (proc.stdout + proc.stderr).lower(), "real E2E is skipped during offline validation")
    print("PHASE0_E2E_OFFLINE_VALIDATION=PASS")


if __name__ == "__main__":
    main()
