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
