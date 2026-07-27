import json
import subprocess
import sys
from pathlib import Path

import ezdxf


def _write_minimal_dxf(path: Path) -> None:
    doc = ezdxf.new()
    doc.layers.add("INSTALACION_ELECTRICA")
    msp = doc.modelspace()
    msp.add_line((0, 0), (10, 0))
    doc.saveas(path)


def test_inspect_cli_json(tmp_path: Path) -> None:
    dxf = tmp_path / "minimal.dxf"
    _write_minimal_dxf(dxf)
    proc = subprocess.run(
        [sys.executable, "-m", "cad_worker", "inspect", "--input", str(dxf), "--json"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["ok"] is True
    assert payload["entity_count"] >= 1
    assert payload["has_instalacion_electrica_layer"] is True


def test_inspect_invalid_dxf_code(tmp_path: Path) -> None:
    bad = tmp_path / "not.dxf"
    bad.write_text("not a dxf", encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, "-m", "cad_worker", "inspect", "--input", str(bad), "--json"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 3
    payload = json.loads(proc.stdout)
    assert payload["code"] == "CAD_WORKER_INVALID_DXF"


def test_diagnose_reports_the_whole_chain(tmp_path) -> None:
    """One command that explains what the engine sees, so a diagnosis is not archaeology."""
    import ezdxf

    from cad_worker.diagnose import diagnose

    src = tmp_path / "plan.dxf"
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 6
    doc.layers.add("MUROS")
    doc.layers.add("NOM - LOCALES")
    msp = doc.modelspace()
    for start, end in (((0, 0), (4, 0)), ((4, 0), (4, 3)), ((4, 3), (0, 3)), ((0, 3), (0, 0))):
        msp.add_line(start, end, dxfattribs={"layer": "MUROS"})
    msp.add_text("DORMITORIO", dxfattribs={"insert": (2, 1.5), "layer": "NOM - LOCALES"})
    doc.saveas(src)

    report = diagnose(src)
    assert report["dependencies_missing"] == []
    assert report["extraction"]["etiquetas_de_local"] == 1
    assert report["units"]["effective_insunits"] == 6
    # 4.5 mm of paper at 1:100 on a drawing in metres.
    assert abs(report["symbol_scale"]["symbol_size_in_drawing_units"] - 0.45) < 1e-9
    assert report["rooms"]["ok"] is True
    assert "VEREDICTO" not in report["verdict"]
