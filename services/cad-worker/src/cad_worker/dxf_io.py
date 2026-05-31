"""DXF file I/O helpers."""

from __future__ import annotations

from pathlib import Path

import ezdxf
from ezdxf.document import Drawing


def open_dxf_file(file_path: str | Path) -> Drawing:
    """Open a DXF file with ezdxf; raises clear errors on invalid input."""
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"Input file not found: {path}")
    try:
        return ezdxf.readfile(str(path))
    except (ezdxf.DXFStructureError, IOError, OSError) as e:
        raise ezdxf.DXFStructureError(f"Invalid or corrupt DXF: {path.name}: {e}") from e


def save_dxf_file(doc: Drawing, file_path: str | Path) -> None:
    """Save DXF using the encoding required by the drawing version (UTF-8 for R2007+)."""
    path = Path(file_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    encoding = getattr(doc, "output_encoding", None)
    if not encoding:
        if doc.dxfversion >= "AC1021":
            encoding = "utf-8"
        else:
            encoding = getattr(doc, "encoding", None) or "cp1252"
    doc.saveas(str(path), encoding=encoding)
