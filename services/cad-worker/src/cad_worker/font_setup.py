"""Register bundled fonts so ezdxf/matplotlib can render DXF text in minimal containers."""

from __future__ import annotations

import logging
from pathlib import Path

import matplotlib as mpl
from ezdxf import options
from ezdxf.fonts import fonts

logger = logging.getLogger(__name__)

_CONFIGURED = False


def _matplotlib_font_dir() -> Path | None:
    candidate = Path(mpl.get_data_path()) / "fonts" / "ttf"
    return candidate if candidate.is_dir() else None


def ensure_drawing_fonts(*, force: bool = False) -> None:
    """Load DejaVu fonts shipped with matplotlib into ezdxf's font cache."""
    global _CONFIGURED
    if _CONFIGURED and not force:
        return

    font_dir = _matplotlib_font_dir()
    if font_dir is None:
        logger.warning("matplotlib font directory not found; DXF text rendering may fail")
        return

    existing = {str(path) for path in options.support_dirs}
    font_dir_str = str(font_dir)
    if font_dir_str not in existing:
        options.set("core", "support_dirs", font_dir_str)

    fonts.build_system_font_cache()

    mpl.rcParams["font.family"] = "sans-serif"
    mpl.rcParams["font.sans-serif"] = ["DejaVu Sans"]

    _CONFIGURED = True
    logger.debug("Configured drawing fonts from %s", font_dir)
