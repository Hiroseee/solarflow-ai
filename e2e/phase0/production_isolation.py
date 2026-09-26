from __future__ import annotations

from urllib.parse import urlsplit

STAGING_URL = "https://fluxo-solar-crm.pages.dev/teste/"
ALLOWED_EDGE_FUNCTION = "crm-staging-v55-seller-timeline-fix"
PRODUCTION_EDGE_FUNCTIONS = {"crm-prod", "crm-v58", "crm-v57", "crm-v56"}
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class ProductionIsolationViolation(RuntimeError):
    pass


def assert_staging_page_url(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.netloc != "fluxo-solar-crm.pages.dev":
        raise ProductionIsolationViolation(f"unexpected application host: {parts.netloc}")
    if not parts.path.startswith("/teste/"):
        raise ProductionIsolationViolation(f"write-capable E2E must stay under /teste/: {parts.path}")


def table_from_rest_path(path: str) -> str | None:
    marker = "/rest/v1/"
    if marker not in path:
        return None
    tail = path.split(marker, 1)[1]
    return tail.split("/", 1)[0]


def install_production_write_guard(context):
    violations: list[str] = []

    def handler(route, request):
        method = request.method.upper()
        if method not in WRITE_METHODS:
            route.continue_()
            return

        path = urlsplit(request.url).path

        if "/functions/v1/" in path:
            slug = path.split("/functions/v1/", 1)[1].split("/", 1)[0]
            if slug != ALLOWED_EDGE_FUNCTION:
                violations.append(f"blocked edge write: {slug}")
                route.abort()
                return

        table = table_from_rest_path(path)
        if table:
            if table.startswith("rpc/"):
                violations.append(f"blocked RPC write: {table}")
                route.abort()
                return
            if not (table.startswith("staging_b1_") or table.startswith("staging_")):
                violations.append(f"blocked production-table write: {table}")
                route.abort()
                return

        if "/storage/v1/" in path:
            violations.append("blocked storage write during Phase0 E2E")
            route.abort()
            return

        route.continue_()

    context.route("**/*", handler)
    return violations
