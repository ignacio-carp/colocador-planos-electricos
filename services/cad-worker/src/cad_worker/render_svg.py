"""Render DXF modelspace to SVG using ezdxf drawing addon."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import ezdxf
from ezdxf import bbox as ezdxf_bbox
from ezdxf.addons.drawing import Frontend, RenderContext, layout, svg

from cad_worker.dxf_io import open_dxf_file

_VIEWBOX_RE = re.compile(r'viewBox="([^"]+)"', re.IGNORECASE)


def _parse_view_box(svg_text: str) -> dict[str, float] | None:
    match = _VIEWBOX_RE.search(svg_text)
    if not match:
        return None
    parts = [float(v) for v in match.group(1).split()]
    if len(parts) != 4:
        return None
    return {"x": parts[0], "y": parts[1], "w": parts[2], "h": parts[3]}


def _normalize_svg_for_web(svg_text: str) -> str:
    """Light theme + drop XML prolog for inline embedding."""
    out = svg_text
    if out.startswith("<?xml"):
        out = out.split("?>", 1)[-1].lstrip()
    out = out.replace('fill="#212830"', 'fill="#ffffff"')
    out = out.replace("stroke: #ffffff", "stroke: #1f2937")
    out = out.replace("fill: #ffffff; fill-opacity: 1.000;}", "fill: #6b7280; fill-opacity: 1.000;}")
    return out.strip()


def _extract_inner_svg(svg_text: str) -> str:
    """Return SVG element inner HTML (paths, groups) without outer <svg> wrapper."""
    normalized = _normalize_svg_for_web(svg_text)
    start = normalized.find(">")
    end = normalized.rfind("</svg>")
    if start == -1 or end == -1:
        return normalized
    return normalized[start + 1 : end].strip()


def render_dxf_to_svg(dxf_path: str | Path) -> dict[str, Any]:
    doc = open_dxf_file(dxf_path)
    msp = doc.modelspace()

    backend = svg.SVGBackend()
    Frontend(RenderContext(doc), backend).draw_layout(msp, finalize=True)

    page = layout.Page(0, 0, layout.Units.mm, margins=layout.Margins.all(5))
    svg_text = backend.get_string(page)
    normalized = _normalize_svg_for_web(svg_text)
    view_box = _parse_view_box(normalized)

    cache = ezdxf_bbox.Cache()
    ext = ezdxf_bbox.extents(msp, cache=cache)
    dxf_bbox = {
        "min_x": float(ext.extmin.x),
        "min_y": float(ext.extmin.y),
        "max_x": float(ext.extmax.x),
        "max_y": float(ext.extmax.y),
    }

    return {
        "svg": normalized,
        "svg_inner": _extract_inner_svg(svg_text),
        "view_box": view_box,
        "dxf_bbox": dxf_bbox,
        "entity_count": len(list(msp)),
    }


def render_svg_cmd(input_path: str) -> int:
    import json

    try:
        payload = render_dxf_to_svg(Path(input_path))
        print(json.dumps({"ok": True, **payload}))
        return 0
    except FileNotFoundError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_FILE_NOT_FOUND"}))
        return 2
    except ezdxf.DXFStructureError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_INVALID_DXF"}))
        return 3
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_ERROR"}))
        return 1
