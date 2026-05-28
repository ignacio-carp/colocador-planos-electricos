"""Backward-compatible re-exports; platform is DXF-only."""

from cad_worker.inspect_dxf import inspect_cmd, inspect_dxf_file

inspect_dwg_file = inspect_dxf_file

__all__ = ["inspect_cmd", "inspect_dwg_file", "inspect_dxf_file"]
