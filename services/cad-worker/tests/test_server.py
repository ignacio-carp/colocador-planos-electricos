"""Regression tests for cad_worker_server module wiring."""

from __future__ import annotations

import importlib
import json

import pytest


def test_cad_worker_server_imports_json_for_apply_layer() -> None:
    """apply_layer uses json.loads and json.JSONDecodeError — must not be removed."""
    server = importlib.import_module("cad_worker_server")
    assert server.json is json
    assert server.json.loads("[]") == []
    with pytest.raises(json.JSONDecodeError):
        server.json.loads("not-json")
