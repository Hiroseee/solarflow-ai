from __future__ import annotations

import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

from production_isolation import STAGING_URL, assert_staging_page_url

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "playwright.config.json").read_text(encoding="utf-8"))
STATE = Path(CONFIG["storage_state"])


def has_supabase_session(page) -> bool:
    return page.evaluate("() => Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k))")


def main() -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(STAGING_URL, wait_until="domcontentloaded")
        assert_staging_page_url(page.url)

        email = os.getenv("PHASE0_E2E_EMAIL")
        if email:
            for selector in ["input[type=email]", "input[name=email]"]:
                try:
                    page.locator(selector).first.fill(email, timeout=1500)
                    break
                except Exception:
                    pass

        print("Autentique-se diretamente no navegador. Não digite senha no terminal/chat.")
        print("O script salvará apenas o storageState local ignorado pelo Git.")
        page.wait_for_function(
            "() => Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k))",
            timeout=10 * 60 * 1000,
        )
        assert_staging_page_url(page.url)
        if not has_supabase_session(page):
            raise RuntimeError("authentication session not detected")
        context.storage_state(path=str(STATE))
        print(f"AUTH_READY: storage state saved locally at {STATE}")
        browser.close()


if __name__ == "__main__":
    main()
