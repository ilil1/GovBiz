"""Legacy AI imports must refer to the installed shared implementation."""

from importlib import import_module

import pytest


@pytest.mark.parametrize("name", [
    "config",
    "tracing",
    "support_program_identity",
    "support_program_llm",
    "support_program_embedding",
    "support_program_evidence.models",
    "support_program_evidence.prompt",
    "support_program_evidence.errors",
    "support_program_evidence.agent",
    "support_program_evidence.answer_service",
    "support_program_evidence.service",
])
def test_legacy_import_keeps_shared_module_identity(name, monkeypatch):
    legacy = import_module(f"app.{name}")
    shared = import_module(f"govbiz_ai_runtime.{name}")

    assert legacy is shared
    # Existing consumers patch module globals (clock, client factories, caches).
    marker = object()
    monkeypatch.setattr(legacy, "_compatibility_probe", marker, raising=False)
    assert shared._compatibility_probe is marker
