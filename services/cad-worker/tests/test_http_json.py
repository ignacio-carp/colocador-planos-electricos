"""Tests for HTTP-safe JSON helpers."""

from __future__ import annotations

import base64
import json

from cad_worker.http_json import apply_layer_header_metadata, encode_result_header


def test_encode_result_header_is_ascii() -> None:
    result = {
        "ok": True,
        "layer": "INSTALACIÓN_ELÉCTRICA",
        "outlets_added": 2,
        "input": "/tmp/plano baño.dxf",
    }
    token, extra = encode_result_header(result)
    token.encode("ascii")
    assert extra["X-Cad-Worker-Result-Encoding"] == "base64-utf-8"
    decoded = json.loads(base64.b64decode(token).decode("utf-8"))
    meta = apply_layer_header_metadata(result)
    assert decoded == meta
    assert decoded["outlets_added"] == 2


def test_encode_result_header_handles_non_json_values() -> None:
    class LayerToken:
        def __str__(self) -> str:
            return "INSTALACIÓN_ELÉCTRICA"

    result = {
        "ok": True,
        "layer": LayerToken(),
        "outlets_added": 1,
    }
    token, _extra = encode_result_header(result)
    decoded = json.loads(base64.b64decode(token).decode("ascii"))
    assert decoded["layer"] == "INSTALACIÓN_ELÉCTRICA"
    assert decoded["outlets_added"] == 1


def test_apply_header_metadata_includes_additive_observability() -> None:
    result = {
        "ok": True,
        "header_insunits": 4,
        "effective_insunits": 6,
        "insunits_overridden": True,
        "unit_confidence": 0.94,
        "nominal_symbol_scale": 0.225,
        "final_symbol_scale": 0.195,
        "scale_clamped": True,
        "clamp_reason": "room_relative_footprint",
        "legacy_entities_removed": 6,
        "placements_rejected": [{"index": 0, "reason": "origin_guard"}],
    }
    metadata = apply_layer_header_metadata(result)
    for field, value in result.items():
        if field != "ok":
            assert metadata[field] == value
