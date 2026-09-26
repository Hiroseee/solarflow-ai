from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parent
STATE_DIR = ROOT / ".state"
EVIDENCE_DIR = ROOT / ".evidence"
AUTH_DIR = ROOT / ".auth"
RUN_FILE = STATE_DIR / "current-run.json"
PREFLIGHT_FILE = EVIDENCE_DIR / "preflight.json"
RESULT_FILE = EVIDENCE_DIR / "flow-results.json"


def utc_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def get_or_create_run() -> dict:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if RUN_FILE.exists():
        return json.loads(RUN_FILE.read_text(encoding="utf-8"))
    run_id = os.getenv("PHASE0_RUN_ID") or utc_run_id()
    data = {
        "run_id": run_id,
        "prefix": f"TESTE_PHASE0_TECH_{run_id}",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    RUN_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data


def marker(run: dict, entity_type: str) -> str:
    return f"{run['prefix']}_{entity_type.upper()}"


def require_preflight_zero() -> dict:
    if not PREFLIGHT_FILE.exists():
        raise RuntimeError("missing preflight evidence; run verify_production_isolation.py --stage preflight first")
    data = json.loads(PREFLIGHT_FILE.read_text(encoding="utf-8"))
    if data.get("production_test_rows") != 0 or data.get("staging_test_rows") != 0:
        raise RuntimeError(f"preflight residues detected: {data}")
    return data


def write_flow_result(name: str, status: str, details: str = "") -> None:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    if RESULT_FILE.exists():
        rows = json.loads(RESULT_FILE.read_text(encoding="utf-8"))
    rows.append({
        "flow": name,
        "status": status,
        "details": details,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    RESULT_FILE.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")


def click_any(page, patterns, *, timeout=5000, required=True) -> bool:
    for pattern in patterns:
        rx = re.compile(pattern, re.I)
        for candidate in [
            page.get_by_role("button", name=rx),
            page.get_by_role("link", name=rx),
            page.get_by_text(rx, exact=False),
        ]:
            try:
                candidate.first.click(timeout=timeout)
                return True
            except Exception:
                pass
    if required:
        raise AssertionError(f"could not click any pattern: {patterns}")
    return False


def fill_any(page, labels, value: str, *, timeout=4000, required=True) -> bool:
    for label in labels:
        rx = re.compile(label, re.I)
        for candidate in [page.get_by_label(rx), page.get_by_placeholder(rx)]:
            try:
                candidate.first.fill(value, timeout=timeout)
                return True
            except Exception:
                pass
    if required:
        raise AssertionError(f"could not fill any field: {labels}")
    return False


def select_any(page, labels, value_pattern: str, *, required=True) -> bool:
    for label in labels:
        try:
            control = page.get_by_label(re.compile(label, re.I)).first
            control.select_option(label=re.compile(value_pattern, re.I))
            return True
        except Exception:
            pass
    if required:
        raise AssertionError(f"could not select {value_pattern} using labels {labels}")
    return False


def open_section(page, patterns) -> None:
    click_any(page, patterns, timeout=7000)
    page.wait_for_timeout(500)


def save(page) -> None:
    click_any(page, [r"^salvar$", r"salvar alterações", r"confirmar"], timeout=7000)
    page.wait_for_timeout(700)


def close_modal(page) -> None:
    click_any(page, [r"^fechar$", r"cancelar", r"×"], timeout=3000, required=False)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)


def search_for(page, text: str) -> None:
    fill_any(page, [r"buscar", r"pesquisar", r"search"], text, required=True)
    page.wait_for_timeout(600)
    expect(page.get_by_text(text, exact=False).first).to_be_visible(timeout=7000)


def assert_marker_visible(page, text: str) -> None:
    expect(page.get_by_text(text, exact=False).first).to_be_visible(timeout=7000)
