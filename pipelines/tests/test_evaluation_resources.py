"""Evaluation source IDs remain stable when implementation files move."""

from pathlib import Path

import pytest

from govbiz_evaluation_contracts.resources import (
    COMPAT_MODULES, ENGINE_METADATA, ENGINE_SOURCE, EVALUATION_MODULES,
    EVIDENCE, LEGACY_ENGINE_METADATA, PREVIOUS_ENGINE_METADATA, PREVIOUS_ENGINE_SOURCE, source_path,
)


@pytest.mark.parametrize("logical,physical", sorted(EVALUATION_MODULES.items()))
def test_legacy_identifier_fingerprints_current_implementation(tmp_path, logical, physical):
    old = tmp_path / EVIDENCE / logical
    current = tmp_path / ENGINE_SOURCE / physical
    old.parent.mkdir(parents=True, exist_ok=True)
    current.parent.mkdir(parents=True, exist_ok=True)
    old.write_text("historical bytes")
    current.write_text("current implementation")

    resolved = source_path(EVIDENCE + logical, tmp_path)
    assert resolved == current
    assert resolved.read_text() == "current implementation"
    current.write_text("modified implementation")
    assert source_path(EVIDENCE + logical, tmp_path).read_text() == "modified implementation"


@pytest.mark.parametrize("logical,physical", sorted(EVALUATION_MODULES.items()))
def test_historical_checkout_falls_back_to_flat_location(tmp_path, logical, physical):
    old = tmp_path / EVIDENCE / logical
    old.parent.mkdir(parents=True, exist_ok=True)
    old.write_text("historical checkout")

    assert source_path(EVIDENCE + logical, tmp_path) == old


@pytest.mark.parametrize("logical,physical", sorted(EVALUATION_MODULES.items()))
def test_previous_role_layout_is_supported(tmp_path, logical, physical):
    old = tmp_path / EVIDENCE / physical
    old.parent.mkdir(parents=True, exist_ok=True)
    old.write_text("previous role layout")
    assert source_path(EVIDENCE + logical, tmp_path) == old


def test_data_resources_remain_and_package_initializers_move(tmp_path):
    for resource in ("fixture.json", "runs/saved/capture.json"):
        assert source_path(EVIDENCE + resource, tmp_path) == tmp_path / EVIDENCE / resource
    (tmp_path / ENGINE_SOURCE).mkdir(parents=True)
    initializer = tmp_path / ENGINE_SOURCE / "evaluators/__init__.py"
    initializer.parent.mkdir(parents=True)
    initializer.write_text("")
    assert source_path(EVIDENCE + "evaluators/__init__.py", tmp_path) == initializer


def test_rejects_path_traversal_even_for_old_ids(tmp_path):
    with pytest.raises(ValueError):
        source_path(EVIDENCE + "../evaluate.py", tmp_path)


@pytest.mark.parametrize("logical,physical", sorted(EVALUATION_MODULES.items()))
def test_missing_new_implementation_does_not_fingerprint_flat_file(tmp_path, logical, physical):
    old = tmp_path / EVIDENCE / logical
    old.parent.mkdir(parents=True, exist_ok=True)
    old.write_text("stale or tampered flat file")
    (tmp_path / ENGINE_SOURCE / physical).parent.mkdir(parents=True, exist_ok=True)

    with pytest.raises(FileNotFoundError, match="Evaluation implementation is missing"):
        source_path(EVIDENCE + logical, tmp_path)


@pytest.mark.parametrize("module", sorted(COMPAT_MODULES))
def test_compatibility_and_implementation_are_separately_fingerprinted(tmp_path, module):
    wrapper = tmp_path / ENGINE_SOURCE / module
    implementation = tmp_path / ENGINE_SOURCE / EVALUATION_MODULES[module]
    wrapper.parent.mkdir(parents=True, exist_ok=True)
    implementation.parent.mkdir(parents=True, exist_ok=True)
    wrapper.write_text("wrapper bytes")
    implementation.write_text("implementation bytes")
    assert source_path(EVIDENCE + "_compat/" + module, tmp_path).read_text() == "wrapper bytes"
    assert source_path(EVIDENCE + module, tmp_path).read_text() == "implementation bytes"
    wrapper.write_text("tampered wrapper")
    assert source_path(EVIDENCE + "_compat/" + module, tmp_path).read_text() == "tampered wrapper"
    assert source_path(EVIDENCE + module, tmp_path).read_text() == "implementation bytes"


def test_missing_compatibility_module_cannot_fall_back_to_logical_path(tmp_path):
    planted = tmp_path / EVIDENCE / "_compat" / "evaluate.py"
    planted.parent.mkdir(parents=True, exist_ok=True)
    planted.write_text("unrelated bytes")
    (tmp_path / ENGINE_SOURCE).mkdir(parents=True)
    with pytest.raises(FileNotFoundError, match="Evaluation implementation is missing"):
        source_path(EVIDENCE + "_compat/evaluate.py", tmp_path)


def test_packaging_metadata_uses_current_file_and_fails_closed(tmp_path):
    old = tmp_path / LEGACY_ENGINE_METADATA
    current = tmp_path / ENGINE_METADATA
    old.parent.mkdir(parents=True)
    old.write_text("old metadata")
    current.parent.mkdir(parents=True)
    current.write_text("current metadata")
    assert source_path(LEGACY_ENGINE_METADATA, tmp_path).read_text() == "current metadata"
    current.unlink()
    (tmp_path / ENGINE_SOURCE).mkdir(parents=True)
    with pytest.raises(FileNotFoundError, match="Evaluation implementation is missing"):
        source_path(LEGACY_ENGINE_METADATA, tmp_path)


@pytest.mark.parametrize("logical,physical", sorted(EVALUATION_MODULES.items()))
def test_previous_colocated_checkout_uses_real_implementation(tmp_path, logical, physical):
    previous = tmp_path / PREVIOUS_ENGINE_SOURCE / physical
    previous.parent.mkdir(parents=True, exist_ok=True)
    previous.write_text("previous colocated implementation")
    flat = tmp_path / EVIDENCE / logical
    flat.parent.mkdir(parents=True, exist_ok=True)
    flat.write_text("stale wrapper")
    assert source_path(EVIDENCE + logical, tmp_path) == previous


def test_previous_colocated_metadata_uses_its_actual_file(tmp_path):
    previous = tmp_path / PREVIOUS_ENGINE_METADATA
    previous.parent.mkdir(parents=True, exist_ok=True)
    previous.write_text("previous metadata")
    assert source_path(LEGACY_ENGINE_METADATA, tmp_path) == previous


def test_previous_colocated_wrapper_uses_its_actual_file(tmp_path):
    previous = tmp_path / PREVIOUS_ENGINE_SOURCE / "evaluate.py"
    previous.parent.mkdir(parents=True, exist_ok=True)
    previous.write_text("previous wrapper")
    assert source_path(EVIDENCE + "_compat/evaluate.py", tmp_path) == previous


def test_current_layout_missing_file_cannot_fall_back_to_previous(tmp_path):
    current = tmp_path / ENGINE_SOURCE
    current.mkdir(parents=True)
    previous = tmp_path / PREVIOUS_ENGINE_SOURCE / EVALUATION_MODULES["evaluate.py"]
    previous.parent.mkdir(parents=True, exist_ok=True)
    previous.write_text("stale implementation")
    with pytest.raises(FileNotFoundError, match="Evaluation implementation is missing"):
        source_path(EVIDENCE + "evaluate.py", tmp_path)


def test_incomplete_previous_layout_cannot_fall_back_to_flat_wrapper(tmp_path):
    (tmp_path / PREVIOUS_ENGINE_SOURCE).mkdir(parents=True)
    flat = tmp_path / EVIDENCE / "evaluate.py"
    flat.parent.mkdir(parents=True, exist_ok=True)
    flat.write_text("stale wrapper")
    with pytest.raises(FileNotFoundError, match="Evaluation implementation is missing"):
        source_path(EVIDENCE + "evaluate.py", tmp_path)


def test_incomplete_previous_layout_cannot_fall_back_to_old_metadata(tmp_path):
    (tmp_path / PREVIOUS_ENGINE_SOURCE).mkdir(parents=True)
    old = tmp_path / LEGACY_ENGINE_METADATA
    old.parent.mkdir(parents=True, exist_ok=True)
    old.write_text("stale metadata")
    with pytest.raises(FileNotFoundError, match="Evaluation implementation is missing"):
        source_path(LEGACY_ENGINE_METADATA, tmp_path)


def test_empty_current_project_cannot_fall_back_to_previous(tmp_path):
    (tmp_path / ENGINE_METADATA).parent.mkdir(parents=True)
    previous = tmp_path / PREVIOUS_ENGINE_SOURCE / EVALUATION_MODULES["evaluate.py"]
    previous.parent.mkdir(parents=True, exist_ok=True)
    previous.write_text("stale implementation")
    with pytest.raises(FileNotFoundError, match="Evaluation implementation is missing"):
        source_path(EVIDENCE + "evaluate.py", tmp_path)


def test_empty_previous_project_cannot_fall_back_to_flat(tmp_path):
    (tmp_path / PREVIOUS_ENGINE_METADATA).parent.mkdir(parents=True)
    flat = tmp_path / EVIDENCE / "evaluate.py"
    flat.parent.mkdir(parents=True, exist_ok=True)
    flat.write_text("stale wrapper")
    with pytest.raises(FileNotFoundError, match="Evaluation implementation is missing"):
        source_path(EVIDENCE + "evaluate.py", tmp_path)
