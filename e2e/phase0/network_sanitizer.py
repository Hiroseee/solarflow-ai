from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


def sanitize_url(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def classify_request(url: str) -> str:
    path = urlsplit(url).path
    if "/auth/v1/" in path:
        return "auth"
    if "/rest/v1/" in path:
        return "database"
    if "/functions/v1/" in path:
        return "edge_function"
    if "/storage/v1/" in path:
        return "storage"
    if "pages.dev" in url:
        return "application"
    return "other"


class NetworkEvidence:
    def __init__(self, output_path: str | Path):
        self.output_path = Path(output_path)
        self.output_path.parent.mkdir(parents=True, exist_ok=True)

    def attach(self, page) -> None:
        page.on("request", self._on_request)
        page.on("response", self._on_response)

    def _write(self, row: dict) -> None:
        with self.output_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def _on_request(self, request) -> None:
        self._write({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": "request",
            "method": request.method,
            "url": sanitize_url(request.url),
            "request_category": classify_request(request.url),
        })

    def _on_response(self, response) -> None:
        request = response.request
        self._write({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": "response",
            "method": request.method,
            "url": sanitize_url(response.url),
            "request_category": classify_request(response.url),
            "status": response.status,
        })
