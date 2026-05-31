"""JSON helpers safe for HTTP headers and ASCII-only log sinks."""

from __future__ import annotations

import base64
import json

CAD_WORKER_RESULT_ENCODING_HEADER = "X-Cad-Worker-Result-Encoding"


def dumps_ascii_safe(payload: object) -> str:
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"), default=str)


def apply_layer_header_metadata(result: dict[str, object]) -> dict[str, object]:
    """Subset of apply-electrical-layer result safe for response headers."""
    meta: dict[str, object] = {
        "ok": result.get("ok", True),
        "layer": result.get("layer"),
        "block_name": result.get("block_name"),
        "outlets_added": result.get("outlets_added"),
        "source_layers_preserved": result.get("source_layers_preserved"),
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
    HTTP headers must be ASCII. We base64-encode JSON bytes so metadata can
    include Unicode and non-JSON-native values without propagating 500s.
    """
    # Reuse the worker's safe serializer: ASCII-only payload + default=str.
    raw = dumps_ascii_safe(apply_layer_header_metadata(result)).encode("utf-8")
    token = base64.b64encode(raw).decode("ascii")
    return token, {CAD_WORKER_RESULT_ENCODING_HEADER: "base64-utf-8"}
