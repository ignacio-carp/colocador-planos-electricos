"""Explain, for one DXF, exactly what the engine sees and what it would draw.

Written after a release where the app drew nothing and nobody could tell why:
the deployed worker was answering, the API was quietly falling back to the vision
model, and every symptom was two layers away from its cause. This command puts
the whole chain in one output so the next diagnosis takes a minute instead of a
session.

    python -m cad_worker diagnose --input plan.dxf
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from cad_worker.detect_rooms import detect_rooms_from_walls
from cad_worker.extract_geometry import extract_geometry
from cad_worker.room_labels import NON_WIRED_ROOM_TYPES, collect_room_labels
from cad_worker.symbol_catalog import compute_symbol_scale_resolution, resolve_plot_scale
from cad_worker.unit_resolution import dimension_lengths, resolve_drawing_units


def diagnose(dxf_path: Path) -> dict[str, Any]:
    """Run the read-only half of the chain and report every decision it makes."""
    report: dict[str, Any] = {"plan": str(dxf_path)}

    missing: list[str] = []
    for module in ("shapely", "numpy", "PIL", "contourpy"):
        try:
            __import__(module)
        except ImportError:
            missing.append(module)
    report["dependencies_missing"] = missing
    if missing:
        report["verdict"] = (
            f"Faltan dependencias del worker ({', '.join(missing)}). La detección de "
            "ambientes no puede correr y la API va a caer al modelo de visión."
        )
        return report

    geometry = extract_geometry(dxf_path)
    labels = collect_room_labels(geometry.get("etiquetas_texto"))
    report["extraction"] = {
        "paredes": len(geometry.get("paredes", [])),
        "aberturas": len(geometry.get("aberturas", [])),
        "muebles": len(geometry.get("muebles", [])),
        "etiquetas_texto": len(geometry.get("etiquetas_texto", [])),
        "etiquetas_de_local": len(labels),
        "dimensiones": len(geometry.get("dimensiones", [])),
        "capas_clasificadas": geometry.get("capas_clasificadas"),
        "insunits_header": geometry.get("insunits"),
    }

    resolution = resolve_drawing_units(geometry.get("insunits"), geometry, [])
    report["units"] = {
        "effective_insunits": resolution.effective_insunits,
        "drawing_units_per_meter": resolution.drawing_units_per_meter,
        "confidence": resolution.confidence,
        "overridden": resolution.overridden,
        "reason": resolution.reason,
        "dimension_samples": len(dimension_lengths(geometry)),
    }

    plot_scale = resolve_plot_scale(geometry)
    scale = compute_symbol_scale_resolution(resolution, [], plot_scale=plot_scale)
    report["symbol_scale"] = {
        "plot_scale": plot_scale,
        "nominal_scale": scale.nominal_scale,
        "symbol_size_in_drawing_units": scale.nominal_paper_mm * scale.nominal_scale,
    }

    detection = detect_rooms_from_walls(geometry, geometry.get("insunits"))
    if not detection.get("ok"):
        report["rooms"] = {
            "ok": False,
            "code": detection.get("code"),
            "error": detection.get("error"),
        }
        report["verdict"] = (
            f"La detección de ambientes falla con {detection.get('code')}. La API va a "
            "caer al modelo de visión, que estima polígonos y da resultados distintos "
            "en cada corrida."
        )
        return report

    rooms = detection.get("rooms", [])
    wireable = [r for r in rooms if str(r.get("room_type") or "") not in NON_WIRED_ROOM_TYPES]
    report["rooms"] = {
        "ok": True,
        "detector": detection.get("detector"),
        "labels_total": detection.get("labels_total"),
        "labels_resolved": detection.get("labels_resolved"),
        "rooms": len(rooms),
        "wireable": len(wireable),
        "unresolved": detection.get("unresolved_labels", [])[:20],
        "detail": [
            {
                "id": room.get("id"),
                "label": room.get("label"),
                "room_type": room.get("room_type"),
                "area_m2": room.get("area_m2"),
                "warnings": room.get("warnings"),
            }
            for room in rooms
        ],
    }

    total = int(detection.get("labels_total") or 0)
    resolved = int(detection.get("labels_resolved") or 0)
    coverage = resolved / total if total else 0.0
    report["verdict"] = (
        f"Detección geométrica OK: {resolved}/{total} etiquetas ({coverage:.0%}) en "
        f"{len(rooms)} ambientes, {len(wireable)} cableables. Si la app muestra otra "
        "cosa, no está corriendo este worker."
    )
    return report


def diagnose_cmd(input_path: str, as_json: bool = False) -> int:
    try:
        report = diagnose(Path(input_path))
    except FileNotFoundError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_FILE_NOT_FOUND"}))
        return 2
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_ERROR"}))
        return 1

    if as_json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0

    print(f"PLANO: {report['plan']}\n")
    if report.get("dependencies_missing"):
        print(f"DEPENDENCIAS FALTANTES: {', '.join(report['dependencies_missing'])}")
        print(f"\nVEREDICTO: {report['verdict']}")
        return 1

    extraction = report["extraction"]
    print("EXTRACCIÓN")
    for key in ("paredes", "aberturas", "muebles", "etiquetas_de_local", "dimensiones"):
        print(f"  {key:22s} {extraction[key]}")
    print(f"  {'capas de muro':22s} {extraction['capas_clasificadas']['paredes']}")

    units = report["units"]
    print("\nUNIDADES")
    print(f"  {'insunits efectivo':22s} {units['effective_insunits']}")
    print(f"  {'unidades por metro':22s} {units['drawing_units_per_meter']}")
    print(f"  {'confianza':22s} {units['confidence']}")
    print(f"  {'cotas usadas':22s} {units['dimension_samples']}")

    scale = report["symbol_scale"]
    print("\nTAMAÑO DE SÍMBOLO")
    print(f"  {'escala de ploteo':22s} 1:{scale['plot_scale']:.0f}")
    print(f"  {'tamaño en el dibujo':22s} {scale['symbol_size_in_drawing_units']:.4f} unidades")

    rooms = report["rooms"]
    print("\nAMBIENTES")
    if not rooms.get("ok"):
        print(f"  FALLA {rooms.get('code')}: {rooms.get('error')}")
    else:
        print(f"  {'detector':22s} {rooms['detector']}")
        print(f"  {'etiquetas':22s} {rooms['labels_resolved']}/{rooms['labels_total']}")
        print(f"  {'ambientes':22s} {rooms['rooms']} ({rooms['wireable']} cableables)")
        for room in rooms["detail"]:
            warn = f"  [{room['warnings'][0][:40]}]" if room.get("warnings") else ""
            print(
                f"    {str(room['label'])[:34]:34s} {str(room['room_type']):18s}"
                f" {room['area_m2']:7.2f} m2{warn}",
            )
        for item in rooms["unresolved"]:
            print(f"    (sin resolver) {item.get('label')}: {item.get('reason')}")

    print(f"\nVEREDICTO: {report['verdict']}")
    return 0
