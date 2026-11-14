"""Installed artifacts must reject changed code or evidence before any paid work."""

from importlib.metadata import distribution
import json
from pathlib import Path
import shutil
import subprocess
import sys
import textwrap

import pytest


PACKAGES = {
    "govbiz-ai-runtime": "govbiz_ai_runtime",
    "govbiz-evaluation-contracts": "govbiz_evaluation_contracts",
    "govbiz-evaluation-engine": "govbiz_evaluation",
    "govbiz-pipelines": "pipelines",
}


PROBE = textwrap.dedent("""
    import importlib.abc
    import json
    import os
    from pathlib import Path
    import socket
    import sys
    from types import SimpleNamespace
    from uuid import uuid4

    installed, results, changed = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    sys.path.insert(0, str(installed))
    (results / 'prefect').mkdir(parents=True)

    class NoBackendImports(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path=None, target=None):
            if fullname.split('.')[0] in {'app', 'apps', 'django'}:
                raise AssertionError('Backend import attempted: ' + fullname)

    sys.meta_path.insert(0, NoBackendImports())
    calls = {'budget': 0, 'model': 0, 'network': 0}

    def no_network(*args, **kwargs):
        calls['network'] += 1
        raise AssertionError('Installed-artifact preflight attempted network access')

    socket.socket.connect = no_network
    socket.socket.connect_ex = no_network
    socket.create_connection = no_network
    os.environ.update(
        DO_NOT_TRACK='1', PREFECT_SERVER_ANALYTICS_ENABLED='false',
        PREFECT_HOME=str(results / 'prefect'), LLMOPS_RESULTS_DIR=str(results),
        LLMOPS_LIVE_ENABLED='true', OPENAI_API_KEY='unused-installed-artifact-test-key',
        LANGFUSE_ENABLED='false',
    )

    from govbiz_evaluation_contracts.catalog import DATASETS, LIVE_CAPTURE_ID, live_config
    from govbiz_evaluation_contracts.execution_spec import (
        ExecutionSpecMismatch, build_release, digest, make_spec, read_release,
    )
    from govbiz_evaluation_contracts.resources import evidence_root, source_path
    from pipelines.evaluation import flows

    for package in ('govbiz_ai_runtime', 'govbiz_evaluation_contracts', 'govbiz_evaluation', 'pipelines'):
        assert Path(sys.modules[package].__file__).resolve().is_relative_to(installed)
    assert flows.ROOT is None, 'This test must exercise the installed default resolver'
    assert read_release() == build_release(), 'Installed release was stale before tampering'

    dataset_id = flows.DATASET_ID
    config = live_config(dataset_id)
    accepted = make_spec(read_release(), dataset_id, 'live', config, LIVE_CAPTURE_ID, dataset_id)
    params = dict(
        request_id=str(uuid4()), dataset_id=dataset_id, execution_mode='live',
        candidate_capture_id=LIVE_CAPTURE_ID, reference_capture_id=dataset_id,
        live_config=config, execution_spec=accepted, execution_spec_sha256=digest(accepted),
    )
    dataset = DATASETS[dataset_id]
    reference = next(item for item in dataset['captures'] if item['id'] == dataset_id)
    paths = {
        'prompt': source_path('backend/ai-service/app/support_program_evidence/prompt.py'),
        'runtime_init': source_path('backend/ai-service/app/support_program_evidence/__init__.py'),
        'tasks': source_path('pipelines/evaluation/tasks.py'),
        'lock': source_path('pipelines/uv.lock'),
        'fixture': evidence_root() / dataset['fixture'],
        'capture': evidence_root() / reference['path'],
    }
    target = paths[changed].resolve()
    assert target.is_relative_to(installed), 'Do not mutate the shared installed environment'
    original = target.read_bytes()
    target.write_bytes(original + b'\\n')

    def no_budget(*args, **kwargs):
        calls['budget'] += 1
        raise AssertionError('Budget client constructed before rejected preflight')

    def no_model(*args, **kwargs):
        calls['model'] += 1
        raise AssertionError('Model execution started before rejected preflight')

    flows.BudgetClient = no_budget
    flows.evaluate.execute = no_model
    flows.flow_run = SimpleNamespace(id=str(uuid4()))
    # Run the real flow body and nested preflight body without starting Prefect.
    flows.task = lambda **options: lambda fn: fn
    try:
        flows.evaluate_saved_capture.fn(**params)
    except ExecutionSpecMismatch as error:
        assert str(error) == 'EXECUTION_SPEC_MISMATCH'
    else:
        raise AssertionError('Changed installed artifact was accepted: ' + changed)

    folder = results / params['request_id']
    preflight_path = folder / 'preflight.json'
    preserved = preflight_path.read_bytes()
    preflight = json.loads(preserved)
    assert preflight == {
        'error_code': 'EXECUTION_SPEC_MISMATCH', 'phase': 'before_model_call',
        'model_api_calls': 0, 'execution_spec_sha256': params['execution_spec_sha256'],
    }
    assert json.loads((folder / 'request.json').read_text())['execution_spec'] == accepted
    assert not (folder / 'capture').exists()
    try:
        flows.evaluate_saved_capture.fn(**params)
    except FileExistsError:
        pass
    else:
        raise AssertionError('Rejected request directory was reused')
    assert preflight_path.read_bytes() == preserved
    assert calls == {'budget': 0, 'model': 0, 'network': 0}, calls
    assert not any(name.split('.')[0] in {'app', 'apps', 'django'} for name in sys.modules)
    print(json.dumps({'changed': changed, 'calls': calls, 'preflight': preflight}))
""")


@pytest.mark.parametrize("changed", ["prompt", "runtime_init", "tasks", "lock", "fixture", "capture"])
def test_installed_artifact_changes_fail_before_budget_or_model(tmp_path, changed):
    installed = tmp_path / "installed"
    for name, package in PACKAGES.items():
        metadata = distribution(name)
        files = {str(path) for path in metadata.files or ()}
        source = Path(metadata.locate_file(package)).resolve()
        assert package + "/__init__.py" in files and source.is_dir(), (
            f"{name} must be installed as a wheel; run uv sync --project pipelines "
            "--locked --extra dev --no-editable before this artifact test"
        )
        shutil.copytree(source, installed / package, ignore=shutil.ignore_patterns(
            ".venv", "__pycache__", ".pytest_cache", "tests", "*.pyc", "*.pyo",
        ))
    working = tmp_path / "unrelated-working-directory"
    working.mkdir()
    result = subprocess.run(
        [sys.executable, "-I", "-B", "-c", PROBE, str(installed), str(tmp_path / "results"), changed],
        cwd=working, capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    proof = json.loads(result.stdout)
    assert proof["changed"] == changed
    assert proof["calls"] == {"budget": 0, "model": 0, "network": 0}
    assert proof["preflight"]["model_api_calls"] == 0
