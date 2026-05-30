"""JSON helpers safe for HTTP headers and ASCII-only log sinks."""

from __future__ import annotations

import base64
import json
from typing import Any

CAD_WORKER_RESULT_ENCODING_HEADER = "X-Cad-Worker-Result-Encoding"


def dumps_ascii_safe(payload: object) -> str:
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"), default=str)


def apply_layer_header_metadata(result: dict[str, object]) -> dict[str, object]:
    """Subset of apply-electrical-layer result safe for response headers."""
    meta: dict[str, object] = {
        "ok": result.get("ok", True),
        "layer": result.get("layer"),
        "outlets_added": result.get("outlets_added"),
    }
    skipped = result.get("placements_skipped_out_of_bbox")
    if skipped is not None:
        meta["placements_skipped_out_of_bbox"] = skipped
    bbox = result.get("bounding_box")
    if isinstance(bbox, dict):
        meta["bounding_box"] = bbox
    return meta


def encode_result_header(result: dict[str, object]) -> tuple[str, dict[str, str]]:
    """
    HTTP headers must be ASCII. Use base64(utf-8 json) so metadata can include
    any characters from upstream DXF / placements without codec errors.
    """
    raw = json.dumps(apply_layer_header_metadata(result), ensure_ascii=False).encode("utf-8")
    token = base64.b64encode(raw).decode("ascii")
    return token, {CAD_WORKER_RESULT_ENCODING_HEADER: "base64-utf-8"}
