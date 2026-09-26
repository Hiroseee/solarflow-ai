from __future__ import annotations

import json
import os
import re
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

from helpers import (
    EVIDENCE_DIR, assert_marker_visible, click_any, close_modal,
    fill_any, get_or_create_run, marker, open_section, require_preflight_zero,
    save, search_for, select_any, write_flow_result,
)
from network_sanitizer import NetworkEvidence
from production_isolation import assert_staging_page_url, install_production_write_guard

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "playwright.config.json").read_text(encoding="utf-8"))
STATE = Path(CONFIG["storage_state"])
STAGING_URL = CONFIG["base_url"]
RUN_REAL = os.getenv("PHASE0_E2E_RUN") == "1"


@unittest.skipUnless(RUN_REAL, "offline discovery only; set PHASE0_E2E_RUN=1 for authenticated E2E")
class Phase0CriticalE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        require_preflight_zero()
        if not STATE.exists():
            raise unittest.SkipTest("authentication storageState missing; run auth_setup.py")

        cls.run = get_or_create_run()
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(
            headless=os.getenv("PHASE0_HEADLESS", "0") == "1"
        )
        cls.context = cls.browser.new_context(storage_state=str(STATE))
        cls.violations = install_production_write_guard(cls.context)
        cls.page = cls.context.new_page()

        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        cls.network = NetworkEvidence(CONFIG["network_evidence"])
        cls.network.attach(cls.page)

        cls.page.goto(STAGING_URL, wait_until="domcontentloaded")
        assert_staging_page_url(cls.page.url)

    @classmethod
    def tearDownClass(cls):
        try:
            if getattr(cls, "violations", []):
                write_flow_result(
                    "PRODUCTION_ISOLATION",
                    "FAIL",
                    "; ".join(cls.violations),
                )
        finally:
            if hasattr(cls, "context"):
                cls.context.close()
            if hasattr(cls, "browser"):
                cls.browser.close()
            if hasattr(cls, "pw"):
                cls.pw.stop()

    def run_block(self, name, fn):
        if self.violations:
            self.fail(
                "production isolation guard already triggered: "
                + "; ".join(self.violations)
            )
        try:
            fn()
            if self.violations:
                raise AssertionError(
                    "production isolation violation: "
                    + "; ".join(self.violations)
                )
            write_flow_result(name, "PASS")
        except AssertionError as exc:
            write_flow_result(name, "FAIL", str(exc))
            raise
        except Exception as exc:
            write_flow_result(
                name,
                "BLOCKED",
                f"{type(exc).__name__}: {exc}",
            )
            raise

    def test_01_contact(self):
        name = marker(self.run, "CONTACT")

        def flow():
            open_section(self.page, [r"contatos"])
            click_any(
                self.page,
                [r"novo contato", r"adicionar contato", r"\+ contato"],
            )
            fill_any(self.page, [r"nome"], name)
            fill_any(
                self.page,
                [r"telefone", r"whatsapp"],
                "+55 19 99999-0001",
                required=False,
            )
            save(self.page)
            close_modal(self.page)

            search_for(self.page, name)
            click_any(self.page, [re.escape(name)])
            fill_any(
                self.page,
                [r"observa", r"cargo"],
                name + "_EDITED",
                required=False,
            )
            save(self.page)
            close_modal(self.page)

            search_for(self.page, name)

        self.run_block("CONTATO", flow)

    def test_02_company(self):
        name = marker(self.run, "COMPANY")

        def flow():
            open_section(self.page, [r"empresas", r"empresa"])
            click_any(
                self.page,
                [r"nova empresa", r"adicionar empresa", r"\+ empresa"],
            )
            fill_any(
                self.page,
                [r"razão social", r"nome.*empresa", r"nome"],
                name,
            )
            save(self.page)
            close_modal(self.page)

            search_for(self.page, name)
            click_any(self.page, [re.escape(name)])
            fill_any(
                self.page,
                [r"observa", r"nome fantasia"],
                name + "_EDITED",
                required=False,
            )
            save(self.page)
            close_modal(self.page)

            search_for(self.page, name)

        self.run_block("EMPRESA", flow)

    def test_03_opportunity(self):
        name = marker(self.run, "OPPORTUNITY")

        def flow():
            open_section(self.page, [r"oportunidades", r"oportunidade"])
            click_any(
                self.page,
                [r"nova oportunidade", r"adicionar oportunidade", r"\+ oportunidade"],
            )
            fill_any(
                self.page,
                [r"título", r"nome.*oportunidade", r"oportunidade"],
                name,
            )
            save(self.page)
            close_modal(self.page)

            search_for(self.page, name)
            click_any(self.page, [re.escape(name)])
            select_any(
                self.page,
                [r"status", r"etapa"],
                r"abert|andamento|pend",
                required=False,
            )
            select_any(
                self.page,
                [r"responsável", r"vendedor"],
                r".+",
                required=False,
            )
            save(self.page)
            close_modal(self.page)

            search_for(self.page, name)
            click_any(self.page, [re.escape(name)])
            assert_marker_visible(self.page, name)

        self.run_block("OPORTUNIDADE", flow)

    def test_04_activities(self):
        opportunity = marker(self.run, "OPPORTUNITY")

        def flow():
            open_section(self.page, [r"oportunidades", r"oportunidade"])
            search_for(self.page, opportunity)
            click_any(self.page, [re.escape(opportunity)])
            click_any(
                self.page,
                [r"atividades", r"histórico"],
                required=False,
            )
            click_any(
                self.page,
                [r"status", r"respons", r"atividade", r"histórico"],
                required=True,
            )

        self.run_block("ATIVIDADES", flow)

    def test_05_pending(self):
        pending = marker(self.run, "PENDING")

        def flow():
            open_section(
                self.page,
                [r"dados pendentes", r"pendências", r"pendentes"],
            )
            click_any(
                self.page,
                [r"nova pendência", r"adicionar pendência", r"\+ pend"],
                required=False,
            )
            fill_any(
                self.page,
                [r"descrição", r"o que falta", r"pendência"],
                pending,
                required=False,
            )
            click_any(
                self.page,
                [r"salvar", r"confirmar"],
                required=False,
            )

            search_for(self.page, pending)
            click_any(self.page, [re.escape(pending)])
            click_any(
                self.page,
                [r"resolvida", r"resolver", r"não resolvida"],
                required=False,
            )
            close_modal(self.page)

            search_for(self.page, pending)

        self.run_block("PENDENCIAS", flow)

    def test_06_participants(self):
        opportunity = marker(self.run, "OPPORTUNITY")
        contact = marker(self.run, "CONTACT")

        def flow():
            open_section(self.page, [r"oportunidades", r"oportunidade"])
            search_for(self.page, opportunity)
            click_any(self.page, [re.escape(opportunity)])

            click_any(
                self.page,
                [r"envolvidos", r"participantes"],
                required=True,
            )
            click_any(
                self.page,
                [r"adicionar", r"\+ envolvido", r"\+ participante"],
            )
            fill_any(
                self.page,
                [r"buscar", r"contato", r"nome"],
                contact,
                required=False,
            )
            click_any(self.page, [re.escape(contact)])
            click_any(
                self.page,
                [r"salvar", r"confirmar"],
                required=False,
            )
            close_modal(self.page)

            search_for(self.page, opportunity)
            click_any(self.page, [re.escape(opportunity)])
            click_any(
                self.page,
                [r"envolvidos", r"participantes"],
                required=True,
            )
            assert_marker_visible(self.page, contact)

            if click_any(
                self.page,
                [r"remover", r"excluir envolvido", r"excluir participante"],
                required=False,
            ):
                click_any(
                    self.page,
                    [r"confirmar", r"sim"],
                    required=False,
                )

        self.run_block("ENVOLVIDOS", flow)

    def test_07_sellers(self):
        def flow():
            open_section(
                self.page,
                [r"gerenciar equipe", r"vendedores", r"equipe"],
            )
            click_any(
                self.page,
                [r"gustavo", r"vendedor", r"equipe"],
                required=True,
            )

        self.run_block("VENDEDORES", flow)

    def test_08_revision_history(self):
        opportunity = marker(self.run, "OPPORTUNITY")

        def flow():
            open_section(self.page, [r"oportunidades", r"oportunidade"])
            search_for(self.page, opportunity)
            click_any(self.page, [re.escape(opportunity)])
            click_any(
                self.page,
                [r"histórico", r"revisões", r"atividades"],
                required=True,
            )
            click_any(
                self.page,
                [r"status", r"respons", r"alterad", r"histórico"],
                required=True,
            )

        self.run_block("REVISAO_HISTORICO", flow)
