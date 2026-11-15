"""Previous execution IDs resolve to the installed flow implementation."""

import pytest

from govbiz_evaluation_contracts.resources import (
    PIPELINE_COMPAT, PIPELINE_EVALUATION, PIPELINE_MODULES, FLOW_EVALUATION,
    PRIOR_FLOW_EVALUATION, source_path,
)


@pytest.mark.parametrize("module", sorted(PIPELINE_MODULES))
def test_legacy_pipeline_id_resolves_current_code(tmp_path, module):
    current = tmp_path / FLOW_EVALUATION / module
    legacy = tmp_path / PIPELINE_EVALUATION / module
    current.parent.mkdir(parents=True)
    legacy.parent.mkdir(parents=True)
    current.write_text("implementation")
    legacy.write_text("compatibility wrapper")
    assert source_path(PIPELINE_EVALUATION + module, tmp_path) == current
    assert source_path(PIPELINE_COMPAT + module, tmp_path) == legacy
    current.write_text("modified implementation")
    assert source_path(PIPELINE_EVALUATION + module, tmp_path).read_text() == "modified implementation"
    assert source_path(PIPELINE_COMPAT + module, tmp_path).read_text() == "compatibility wrapper"


@pytest.mark.parametrize("module", sorted(PIPELINE_MODULES))
def test_old_flat_checkout_resolves_original_code(tmp_path, module):
    legacy = tmp_path / PIPELINE_EVALUATION / module
    legacy.parent.mkdir(parents=True)
    legacy.write_text("historical implementation")
    assert source_path(PIPELINE_EVALUATION + module, tmp_path) == legacy


@pytest.mark.parametrize("module", sorted(PIPELINE_MODULES))
def test_missing_new_flow_never_falls_back_to_legacy_wrapper(tmp_path, module):
    wrapper = tmp_path / PIPELINE_EVALUATION / module
    wrapper.parent.mkdir(parents=True)
    wrapper.write_text("stale wrapper")
    (tmp_path / FLOW_EVALUATION).mkdir(parents=True)
    with pytest.raises(FileNotFoundError, match="Pipeline flow implementation is missing"):
        source_path(PIPELINE_EVALUATION + module, tmp_path)


def test_missing_wrapper_cannot_use_compat_logical_path(tmp_path):
    planted = tmp_path / PIPELINE_COMPAT / "flows.py"
    planted.parent.mkdir(parents=True)
    planted.write_text("unrelated code")
    with pytest.raises(FileNotFoundError, match="Pipeline compatibility module is missing"):
        source_path(PIPELINE_COMPAT + "flows.py", tmp_path)


def test_unknown_compat_identifier_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="Unknown pipeline compatibility resource"):
        source_path(PIPELINE_COMPAT + "untrusted.py", tmp_path)


@pytest.mark.parametrize("module", sorted(PIPELINE_MODULES))
def test_previous_flow_identifier_resolves_current_implementation(tmp_path, module):
    current = tmp_path / FLOW_EVALUATION / module
    current.parent.mkdir(parents=True)
    current.write_text("current implementation")
    assert source_path(PRIOR_FLOW_EVALUATION + module, tmp_path) == current


@pytest.mark.parametrize("module", sorted(PIPELINE_MODULES))
@pytest.mark.parametrize("prefix", [PIPELINE_EVALUATION, PRIOR_FLOW_EVALUATION])
def test_previous_flow_checkout_remains_inspectable(tmp_path, module, prefix):
    previous = tmp_path / PRIOR_FLOW_EVALUATION / module
    previous.parent.mkdir(parents=True)
    previous.write_text("previous implementation")
    assert source_path(prefix + module, tmp_path) == previous


@pytest.mark.parametrize("prefix", [PIPELINE_EVALUATION, PRIOR_FLOW_EVALUATION])
def test_partial_current_flow_never_uses_previous_code(tmp_path, prefix):
    previous = tmp_path / PRIOR_FLOW_EVALUATION / "flows.py"
    previous.parent.mkdir(parents=True)
    previous.write_text("stale implementation")
    (tmp_path / FLOW_EVALUATION).mkdir(parents=True)
    with pytest.raises(FileNotFoundError, match="Pipeline flow implementation is missing"):
        source_path(prefix + "flows.py", tmp_path)


def test_partial_previous_flow_never_uses_flat_wrapper(tmp_path):
    flat = tmp_path / PIPELINE_EVALUATION / "flows.py"
    flat.parent.mkdir(parents=True)
    flat.write_text("stale wrapper")
    (tmp_path / PRIOR_FLOW_EVALUATION).mkdir(parents=True)
    with pytest.raises(FileNotFoundError, match="Pipeline flow implementation is missing"):
        source_path(PIPELINE_EVALUATION + "flows.py", tmp_path)


@pytest.mark.parametrize("prefix", [PIPELINE_EVALUATION, PRIOR_FLOW_EVALUATION])
def test_installed_legacy_identifiers_resolve_new_flow(monkeypatch, tmp_path, prefix):
    from govbiz_evaluation_contracts import resources

    monkeypatch.setattr(resources, "_package", lambda name: tmp_path if name == "pipelines" else None)
    assert source_path(prefix + "flows.py") == tmp_path / "flows/support_program_evidence/flows.py"


@pytest.mark.parametrize("prefix", [PIPELINE_EVALUATION, PRIOR_FLOW_EVALUATION])
def test_missing_current_flow_directory_never_uses_stale_previous_code(tmp_path, prefix):
    previous = tmp_path / PRIOR_FLOW_EVALUATION / "flows.py"
    previous.parent.mkdir(parents=True)
    previous.write_text("stale implementation")
    config = tmp_path / "pipelines/pyproject.toml"
    config.write_text('[tool.setuptools]\npackages = ["pipelines.flows.support_program_evidence"]\n')
    with pytest.raises(FileNotFoundError, match="Pipeline flow implementation is missing"):
        source_path(prefix + "flows.py", tmp_path)
