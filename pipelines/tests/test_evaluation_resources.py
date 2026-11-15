"""Evaluation source IDs remain stable when implementation files move."""

from pathlib import Path
import hashlib
import json
import runpy

import pytest

from govbiz_evaluation_contracts.resources import (
    COMPAT_MODULES, DATASETS, ENGINE_METADATA, ENGINE_SOURCE, EVALUATION_MODULES,
    EVIDENCE, LEGACY_ENGINE_METADATA, PREVIOUS_ENGINE_METADATA, PREVIOUS_ENGINE_SOURCE,
    PRIOR_DATASETS, PRIOR_ENGINE_SOURCE,
    evidence_root, source_path,
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


def test_historical_checkout_data_and_package_initializers(tmp_path):
    (tmp_path / EVIDENCE).mkdir(parents=True)
    for resource in ("fixture.json", "runs/saved/capture.json"):
        assert source_path(EVIDENCE + resource, tmp_path) == tmp_path / EVIDENCE / resource
    assert evidence_root(tmp_path) == tmp_path / EVIDENCE
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
def test_historical_compatibility_and_implementation_resolve_separately(tmp_path, module):
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


def test_installed_data_accepts_current_and_historical_identifiers():
    assert source_path(DATASETS + "fixture.json") == source_path(EVIDENCE + "fixture.json")


def test_moved_data_resolves_legacy_id_and_refuses_stale_fallback(tmp_path):
    name = "runs/saved/capture.json"
    old = tmp_path / EVIDENCE / name
    current = tmp_path / DATASETS / name
    old.parent.mkdir(parents=True)
    current.parent.mkdir(parents=True)
    old.write_text("old")
    current.write_text("current")
    assert evidence_root(tmp_path) == tmp_path / DATASETS
    assert source_path(EVIDENCE + name, tmp_path).read_text() == "current"
    current.unlink()
    with pytest.raises(FileNotFoundError, match="Evaluation data is missing"):
        source_path(EVIDENCE + name, tmp_path)


def test_moved_data_symlink_cannot_escape_checkout(tmp_path):
    outside = tmp_path.parent / (tmp_path.name + "-outside.json")
    outside.write_text("untrusted")
    try:
        current = tmp_path / DATASETS / "fixture.json"
        current.parent.mkdir(parents=True)
        current.symlink_to(outside)
        with pytest.raises(ValueError, match="escapes repository"):
            source_path(EVIDENCE + "fixture.json", tmp_path)
    finally:
        outside.unlink()


def test_bundled_data_uses_new_source_and_stable_installed_identifiers(tmp_path):
    repo = Path(__file__).resolve().parents[2]
    bundler = runpy.run_path(str(repo / "infrastructure/llmops/bundle_runner_inputs.py"))
    fixture = b'{"fixture":true}\n'
    capture = b'{"capture":true}\n'
    data = tmp_path / DATASETS
    (data / "runs/example").mkdir(parents=True)
    (data / "fixture.json").write_bytes(fixture)
    (data / "runs/example/capture.json").write_bytes(capture)
    def digest(raw):
        return hashlib.sha256(raw).hexdigest()

    catalog = [{
        "id": "example", "fixture": "fixture.json", "fixture_sha256": digest(fixture),
        "captures": [{"id": "capture", "path": "runs/example/capture.json"}],
    }]
    release = {"datasets": {"example": {
        "fixture_sha256": digest(fixture), "captures": {"capture": digest(capture)},
    }}}
    owner = tmp_path / bundler["CONTRACTS"]
    owner.mkdir(parents=True)
    (owner / "capture_catalog.json").write_text(json.dumps(catalog))
    (owner / "execution_release.json").write_text(json.dumps(release))
    for logical in bundler["METADATA"]:
        source = tmp_path / bundler["METADATA_SOURCES"].get(logical, logical)
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text("metadata")
    assert bundler["bundle"](tmp_path) == 2
    packaged = owner / "_inputs" / EVIDENCE
    assert (packaged / "fixture.json").read_bytes() == fixture
    assert (packaged / "runs/example/capture.json").read_bytes() == capture
    assert not (owner / "_inputs" / DATASETS).exists()
    (data / "fixture.json").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="Registered evaluation input differs"):
        bundler["bundle"](tmp_path)
    assert (packaged / "fixture.json").read_bytes() == fixture


@pytest.mark.parametrize("logical,physical", sorted(EVALUATION_MODULES.items()))
def test_immediately_previous_package_layout_remains_inspectable(tmp_path, logical, physical):
    previous = tmp_path / PRIOR_ENGINE_SOURCE / physical
    previous.parent.mkdir(parents=True, exist_ok=True)
    previous.write_text("previous evaluation implementation")
    assert source_path(EVIDENCE + logical, tmp_path) == previous


def test_partial_current_package_never_falls_back_to_immediately_previous(tmp_path):
    (tmp_path / ENGINE_SOURCE).mkdir(parents=True)
    previous = tmp_path / PRIOR_ENGINE_SOURCE / EVALUATION_MODULES["evaluate.py"]
    previous.parent.mkdir(parents=True)
    previous.write_text("stale implementation")
    with pytest.raises(FileNotFoundError, match="Evaluation implementation is missing"):
        source_path(EVIDENCE + "evaluate.py", tmp_path)


def test_immediately_previous_data_layout_remains_inspectable(tmp_path):
    previous = tmp_path / PRIOR_DATASETS / "fixture.json"
    previous.parent.mkdir(parents=True)
    previous.write_text("previous data")
    assert evidence_root(tmp_path) == previous.parent
    assert source_path(EVIDENCE + "fixture.json", tmp_path) == previous
    assert source_path(PRIOR_DATASETS + "fixture.json", tmp_path) == previous
    assert source_path(DATASETS + "fixture.json") == source_path(PRIOR_DATASETS + "fixture.json")


def test_partial_previous_data_never_falls_back_to_older_data(tmp_path):
    (tmp_path / PRIOR_DATASETS).mkdir(parents=True)
    old = tmp_path / EVIDENCE / "fixture.json"
    old.parent.mkdir(parents=True)
    old.write_text("stale data")
    with pytest.raises(FileNotFoundError, match="Evaluation data is missing"):
        source_path(EVIDENCE + "fixture.json", tmp_path)


def test_missing_current_data_directory_never_reuses_previous_layout(tmp_path):
    (tmp_path / ENGINE_SOURCE).mkdir(parents=True)
    previous = tmp_path / PRIOR_DATASETS / "fixture.json"
    previous.parent.mkdir(parents=True)
    previous.write_text("stale data")
    assert evidence_root(tmp_path) == tmp_path / DATASETS
    with pytest.raises(FileNotFoundError, match="Evaluation data is missing"):
        source_path(EVIDENCE + "fixture.json", tmp_path)
