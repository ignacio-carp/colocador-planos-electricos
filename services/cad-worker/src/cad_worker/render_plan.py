"""Rasterize DXF plans to PNG for multimodal LLM pipeline (US-007 / US-008)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import ezdxf
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from ezdxf.addons.drawing import Frontend, RenderContext  # noqa: E402
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend  # noqa: E402

from cad_worker.dxf_io import open_dxf_file
from cad_worker.extract_geometry import extract_geometry, geometry_bounding_box

INVALID_DXF_CODE = "CAD_WORKER_INVALID_DXF"


def _point_xy(value: Any) -> tuple[float, float] | None:
    if value is None:
        return None
    if isinstance(value, dict):
        x = value.get("x")
        y = value.get("y")
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            return float(x), float(y)
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return float(value[0]), float(value[1])
    return None


def polygon_bbox(vertices: list[Any], margin: float = 0.0) -> dict[str, float] | None:
    points = [_point_xy(v) for v in vertices]
    valid = [p for p in points if p is not None]
    if not valid:
        return None
    xs = [p[0] for p in valid]
    ys = [p[1] for p in valid]
    return {
        "min_x": min(xs) - margin,
        "min_y": min(ys) - margin,
        "max_x": max(xs) + margin,
        "max_y": max(ys) + margin,
    }


def _layout_bbox(dxf_path: Path) -> dict[str, float] | None:
    geometry = extract_geometry(dxf_path)
    return geometry_bounding_box(geometry)


def _figure_size(width_px: int, height_px: int) -> tuple[float, float]:
    dpi = 100.0
    return width_px / dpi, height_px / dpi


def _render_to_png(
    dxf_path: Path,
    output_png: Path,
    *,
    width_px: int,
    height_px: int,
    crop_bbox: dict[str, float] | None = None,
    highlight_polygon: list[Any] | None = None,
) -> dict[str, object]:
    doc = open_dxf_file(dxf_path)
    msp = doc.modelspace()
    source_path = dxf_path

    fig = plt.figure(figsize=_figure_size(width_px, height_px), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_aspect("equal", adjustable="box")
    ax.axis("off")

    ctx = RenderContext(doc)
    backend = MatplotlibBackend(ax)
    Frontend(ctx, backend).draw_layout(msp, finalize=True)

    if crop_bbox is not None:
        ax.set_xlim(crop_bbox["min_x"], crop_bbox["max_x"])
        ax.set_ylim(crop_bbox["min_y"], crop_bbox["max_y"])
    else:
        bbox = _layout_bbox(source_path)
        if bbox is not None:
            pad_x = max((bbox["max_x"] - bbox["min_x"]) * 0.05, 1.0)
            pad_y = max((bbox["max_y"] - bbox["min_y"]) * 0.05, 1.0)
            ax.set_xlim(bbox["min_x"] - pad_x, bbox["max_x"] + pad_x)
            ax.set_ylim(bbox["min_y"] - pad_y, bbox["max_y"] + pad_y)
            crop_bbox = {
                "min_x": bbox["min_x"] - pad_x,
                "min_y": bbox["min_y"] - pad_y,
                "max_x": bbox["max_x"] + pad_x,
                "max_y": bbox["max_y"] + pad_y,
            }

    if highlight_polygon:
        pts = [_point_xy(v) for v in highlight_polygon]
        ring = [p for p in pts if p is not None]
        if len(ring) >= 3:
            xs = [p[0] for p in ring] + [ring[0][0]]
            ys = [p[1] for p in ring] + [ring[0][1]]
            ax.plot(xs, ys, color="#2563eb", linewidth=1.5, alpha=0.85)

    output_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_png, format="png", dpi=100, bbox_inches="tight", pad_inches=0.05)
    plt.close(fig)

    if crop_bbox is None:
        crop_bbox = {"min_x": 0.0, "min_y": 0.0, "max_x": 1.0, "max_y": 1.0}

    span_x = max(crop_bbox["max_x"] - crop_bbox["min_x"], 1e-6)
    span_y = max(crop_bbox["max_y"] - crop_bbox["min_y"], 1e-6)
    pixels_per_x = width_px / span_x
    pixels_per_y = height_px / span_y
    pixels_per_drawing_unit = min(pixels_per_x, pixels_per_y)

    return {
        "ok": True,
        "output": str(output_png.resolve()),
        "width_px": width_px,
        "height_px": height_px,
        "bbox_drawing_units": crop_bbox,
        "pixels_per_drawing_unit": pixels_per_drawing_unit,
    }


def render_plan(
    dxf_path: str | Path,
    output_png: str | Path,
    *,
    width_px: int = 2048,
    height_px: int | None = None,
) -> dict[str, object]:
    path = Path(dxf_path)
    out = Path(output_png)
    if height_px is None:
        height_px = max(512, int(width_px * 0.75))
    return _render_to_png(path, out, width_px=width_px, height_px=height_px)


def render_room(
    dxf_path: str | Path,
    output_png: str | Path,
    *,
    polygon_vertices: list[Any],
    margin_mm: float = 500.0,
    width_px: int = 1024,
    height_px: int | None = None,
) -> dict[str, object]:
    path = Path(dxf_path)
    out = Path(output_png)
    if height_px is None:
        height_px = max(512, int(width_px * 0.75))
    crop = polygon_bbox(polygon_vertices, margin=margin_mm)
    if crop is None:
        raise ValueError("polygon_vertices must contain at least one valid point")
    span_x = crop["max_x"] - crop["min_x"]
    span_y = crop["max_y"] - crop["min_y"]
    if span_x > span_y:
        height_px = max(256, int(width_px * (span_y / span_x)))
    else:
        width_px = max(256, int(height_px * (span_x / span_y)))
    return _render_to_png(
        path,
        out,
        width_px=width_px,
        height_px=height_px,
        crop_bbox=crop,
        highlight_polygon=polygon_vertices,
    )


def render_plan_cmd(
    input_path: str,
    output_path: str,
    width_px: int = 2048,
) -> int:
    try:
        payload = render_plan(input_path, output_path, width_px=width_px)
        print(json.dumps(payload))
        return 0
    except FileNotFoundError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_FILE_NOT_FOUND"}))
        return 2
    except ezdxf.DXFStructureError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": INVALID_DXF_CODE}))
        return 3
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_ERROR"}))
        return 1


def render_room_cmd(
    input_path: str,
    output_path: str,
    polygon_json: str,
    margin_mm: float = 500.0,
    width_px: int = 1024,
) -> int:
    try:
        raw = json.loads(polygon_json)
        vertices: list[Any]
        if isinstance(raw, dict) and isinstance(raw.get("vertices"), list):
            vertices = raw["vertices"]
        elif isinstance(raw, list):
            vertices = raw
        else:
            raise ValueError("polygon_json must be a vertex list or {vertices: [...]}")
        payload = render_room(
            input_path,
            output_path,
            polygon_vertices=vertices,
            margin_mm=margin_mm,
            width_px=width_px,
        )
        print(json.dumps(payload))
        return 0
    except FileNotFoundError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_FILE_NOT_FOUND"}))
        return 2
    except ezdxf.DXFStructureError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": INVALID_DXF_CODE}))
        return 3
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_INVALID_JSON"}))
        return 4
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_ERROR"}))
        return 1
