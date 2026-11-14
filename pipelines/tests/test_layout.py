"""평가 계산의 독립 실행과 기존 Deployment 등록 계약을 검증한다."""

from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("module", ["reporting", "rag_reporting"])
def test_reporting_runs_without_prefect_or_pipelines(module, tmp_path):
    script = r'''
import importlib
import importlib.abc
from pathlib import Path
import sys

root = Path(sys.argv[1])
module = sys.argv[2]
evidence = root / "evaluation/support-program-evidence"
sys.path[:0] = [
    str(evidence), str(root / "backend/ai-service"), str(root / "backend/ops-service"),
]

class RejectOrchestration(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".", 1)[0] in {"prefect", "pipelines"}:
            raise AssertionError("Evaluation imported orchestration: " + fullname)
        return None

sys.meta_path.insert(0, RejectOrchestration())
reporting = importlib.import_module(module)
if module == "reporting":
    result = reporting.load_results(
        evidence / "target-coverage-fixture.json",
        evidence / "runs/target-coverage-20260907-v1/capture.json",
    )
    assert result["frame"].shape == (6, 9)
    assert result["summary"]["completed"] is True
else:
    import rag_evaluate
    result = rag_evaluate.evaluate(
        evidence / "rag-fixture.json", evidence / "rag-synthetic-capture.json",
    )
    frame = reporting.result_frame(result)
    assert len(frame) == 3
    assert "retrieval_recall" in frame.columns
assert not any(name.split(".", 1)[0] in {"prefect", "pipelines"} for name in sys.modules)
'''
    completed = subprocess.run(
        [sys.executable, "-I", "-c", script, str(ROOT), module],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_entrypoint_serves_existing_deployment_with_one_run(monkeypatch):
    from pipelines import serve
    from pipelines.evaluation.flows import evaluate_saved_capture

    assert serve.evaluate_saved_capture is evaluate_saved_capture
    assert evaluate_saved_capture.name == "govbiz-ops-evidence-evaluation"
    registrations = []
    monkeypatch.setattr(
        evaluate_saved_capture, "serve", lambda **options: registrations.append(options)
    )

    serve.main()

    assert registrations == [{"name": "saved-capture", "limit": 1}]


@pytest.mark.parametrize(
    "filename,function,name",
    [
        ("flows.py", "evaluate_saved_capture", "govbiz-ops-evidence-evaluation"),
        ("capture.py", "evaluate_capture", "govbiz-evidence-capture-evaluation"),
        ("rag.py", "evaluate_rag_capture", "govbiz-rag-capture-replay"),
    ],
)
def test_prefect_loads_persisted_file_entrypoint_in_fresh_process(
    filename, function, name, tmp_path
):
    # The server stores a file entrypoint by default. A new process must load it
    # without relying on the serving process's sys.path or imported packages.
    entrypoint = str(ROOT / "pipelines/evaluation" / filename) + ":" + function
    completed = subprocess.run(
        [
            sys.executable, "-I", "-c",
            "import sys; from prefect.flows import load_flow_from_entrypoint; "
            "flow = load_flow_from_entrypoint(sys.argv[1], use_placeholder_flow=False); "
            "assert flow.name == sys.argv[2]",
            entrypoint, name,
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
