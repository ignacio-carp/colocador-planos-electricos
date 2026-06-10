"""Regression tests for cad_worker_server module wiring and HTTP endpoints."""

from __future__ import annotations

import importlib
from json import JSONDecodeError
from json import loads as json_loads
from pathlib import Path

import ezdxf
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client() -> TestClient:
    server = importlib.import_module("cad_worker_server")
    return TestClient(server.app)


@pytest.fixture
def sample_dxf(tmp_path: Path) -> Path:
    path = tmp_path / "sample.dxf"
    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (1000, 0))
    doc.saveas(path)
    return path


def test_cad_worker_server_json_helpers_for_apply_layer() -> None:
    """apply_layer uses json.loads and JSONDecodeError — must not be removed."""
    server = importlib.import_module("cad_worker_server")
    assert server.json_loads is json_loads
    assert server.JSONDecodeError is JSONDecodeError
    assert server.json_loads("[]") == []
    with pytest.raises(JSONDecodeError):
        server.json_loads("not-json")


def test_healthz(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "cad-worker"}


def test_inspect(client: TestClient, sample_dxf: Path) -> None:
    with sample_dxf.open("rb") as handle:
        response = client.post(
            "/inspect",
            files={"file": ("sample.dxf", handle, "application/octet-stream")},
        )
    assert response.status_code == 200
    body = response.json()
    assert body.get("ok") is True
    assert body.get("entity_count", 0) >= 1


def test_extract_geometry(client: TestClient, sample_dxf: Path) -> None:
    with sample_dxf.open("rb") as handle:
        response = client.post(
            "/extract-geometry",
            files={"file": ("sample.dxf", handle, "application/octet-stream")},
        )
    assert response.status_code == 200
    body = response.json()
    assert body.get("ok") is True
    assert "paredes" in body


def test_render_svg(client: TestClient, sample_dxf: Path) -> None:
    with sample_dxf.open("rb") as handle:
        response = client.post(
            "/render-svg",
            files={"file": ("sample.dxf", handle, "application/octet-stream")},
        )
    assert response.status_code == 200
    body = response.json()
    assert body.get("ok") is True
    assert "svg_inner" in body
    assert body.get("view_box") is not None


def test_apply_electrical_layer(client: TestClient, sample_dxf: Path) -> None:
    with sample_dxf.open("rb") as handle:
        response = client.post(
            "/apply-electrical-layer",
            files={"file": ("sample.dxf", handle, "application/octet-stream")},
            data={"placements_json": "[]"},
        )
    assert response.status_code == 200
    assert response.headers.get("content-type", "").startswith("application/dxf")
    assert response.headers.get("x-cad-worker-result")


def test_apply_electrical_layer_header_serialization_does_not_500(
    client: TestClient,
    sample_dxf: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    server = importlib.import_module("cad_worker_server")

    class LayerToken:
        def __str__(self) -> str:
            return "INSTALACIÓN_ELÉCTRICA"

    def fake_apply(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {"ok": True, "layer": LayerToken(), "outlets_added": 0}

    monkeypatch.setattr(server, "apply_electrical_layer", fake_apply)

    with sample_dxf.open("rb") as handle:
        response = client.post(
            "/apply-electrical-layer",
            files={"file": ("sample.dxf", handle, "application/octet-stream")},
            data={"placements_json": "[]"},
        )

    assert response.status_code == 200
    assert response.headers.get("x-cad-worker-result")


def test_apply_electrical_layer_header_encode_failure_is_non_fatal(
    client: TestClient,
    sample_dxf: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    server = importlib.import_module("cad_worker_server")

    def boom(_result: dict[str, object]) -> tuple[str, dict[str, str]]:
        raise UnicodeEncodeError("ascii", "áé", 0, 2, "ordinal not in range(128)")

    monkeypatch.setattr(server, "encode_result_header", boom)

    with sample_dxf.open("rb") as handle:
        response = client.post(
            "/apply-electrical-layer",
            files={"file": ("sample.dxf", handle, "application/octet-stream")},
            data={"placements_json": "[]"},
        )

    assert response.status_code == 200
    assert response.headers.get("x-cad-worker-result") is None
