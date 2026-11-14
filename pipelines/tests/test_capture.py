"""Prefect 실행 순서에서 실패·중복 실행을 정상 완료로 숨기지 않는지 검증한다."""

from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from filelock import FileLock, Timeout

from pipelines.evaluation import capture
import reporting
from app.config import LangfuseSettings

HERE = Path(__file__).resolve().parents[2] / "evaluation/support-program-evidence"
FIXTURE = HERE / "target-coverage-fixture.json"
CAPTURE = HERE / "runs/target-coverage-20260907-v1/capture.json"


@pytest.fixture(autouse=True)
def isolate_lock_directory(monkeypatch, tmp_path):
    monkeypatch.setattr(capture, "ROOT", tmp_path)


@pytest.mark.parametrize("stage", ["prepare", "render", "publish"])
def test_required_step_failure_is_not_marked_completed(monkeypatch, tmp_path, stage):
    for name in ["prepare", "render", "publish"]:
        monkeypatch.setattr(capture, name, getattr(capture, name).fn)
    def fail(*args):
        raise RuntimeError("test failure")
    monkeypatch.setattr(capture, stage, fail)
    output = tmp_path / "run"
    with pytest.raises(RuntimeError, match="test failure"):
        capture.evaluate_capture.fn(str(FIXTURE), str(CAPTURE), str(CAPTURE), str(output))
    assert json.loads((output / "manifest.json").read_text())["status"] == "failed"


def test_overlapping_manual_run_is_rejected_before_writes(tmp_path):
    directory = capture.ROOT / "work/llmops"
    directory.mkdir(parents=True, exist_ok=True)
    with FileLock(str(directory / "evaluation.lock")):
        with pytest.raises(Timeout):
            capture.evaluate_capture.fn(str(FIXTURE), str(CAPTURE), str(CAPTURE), str(tmp_path / "run"))
    assert not (tmp_path / "run").exists()


def reassessment_provenance(source="1f270c5b-4f7d-434d-8415-3285917c796b"):
    return {"source_run_id": source, "source_evaluator_version": "a" * 64,
            "source_approved_evaluator_version": "b" * 64,
            "target_evaluator_version": reporting.EVALUATOR_VERSION}


def test_reassessment_score_provenance_and_distinct_deterministic_ids(monkeypatch, tmp_path):
    base = reporting.load_results(FIXTURE, CAPTURE)
    settings = LangfuseSettings(enabled=True, base_url="http://localhost:13000", public_key="test", secret_key="test")
    captured = []
    monkeypatch.setattr(capture, "prepare", lambda *_args: deepcopy(base))
    monkeypatch.setattr(capture, "render", lambda current, reference, _output: {
        "evaluation_run_id": current["run_id"], "reference_run_id": reference["run_id"], "artifact_sha256": {}})
    monkeypatch.setattr(capture, "publish", lambda current: captured.append(reporting.score_payloads(current, settings)) or
                        [item["id"] for item in captured[-1]])
    monkeypatch.setattr(capture, "flow_run", SimpleNamespace(id="00000000-0000-0000-0000-000000000001"))

    def run(name, provenance=None):
        output = tmp_path / name
        result = capture.evaluate_capture.fn(str(FIXTURE), str(CAPTURE), str(CAPTURE), str(output), reassessment=provenance)
        comparison = json.loads((output / "comparison.json").read_text(encoding="utf-8"))
        payloads = captured[-1]
        assert result["evaluation_run_id"] == comparison["evaluation_run_id"]
        assert all(item["metadata"]["evaluation_run_id"] == result["evaluation_run_id"] for item in payloads)
        assert all(item.get("session_id", result["evaluation_run_id"]) == result["evaluation_run_id"] for item in payloads)
        return result, payloads

    original, original_payloads = run("original")
    assert original["evaluation_run_id"] == base["run_id"]
    provenance = reassessment_provenance()
    reassessed, reassessed_payloads = run("reassessed", provenance)
    again, again_payloads = run("again", provenance)
    other, other_payloads = run("other", reassessment_provenance("00000000-0000-0000-0000-000000000002"))
    monkeypatch.setattr(reporting, "EVALUATOR_VERSION", "c" * 64)
    monkeypatch.setattr(capture, "EVALUATOR_VERSION", "c" * 64)
    other_version, other_version_payloads = run("other-version", reassessment_provenance())
    assert original["evaluation_run_id"] != reassessed["evaluation_run_id"]
    assert reassessed["evaluation_run_id"] == again["evaluation_run_id"] != other["evaluation_run_id"]
    assert {item["id"] for item in original_payloads}.isdisjoint({item["id"] for item in reassessed_payloads})
    assert [item["id"] for item in reassessed_payloads] == [item["id"] for item in again_payloads]
    assert {item["id"] for item in reassessed_payloads}.isdisjoint({item["id"] for item in other_payloads})
    assert reassessed["evaluation_run_id"] != other_version["evaluation_run_id"]
    assert {item["id"] for item in reassessed_payloads}.isdisjoint({item["id"] for item in other_version_payloads})
    for item in reassessed_payloads:
        assert item["metadata"]["record_kind"] == "stored-response-reassessment"
        assert all(item["metadata"][key] == value for key, value in provenance.items())
    assert all(item["metadata"]["record_kind"] != "stored-response-reassessment" for item in original_payloads)


@pytest.mark.parametrize("mutation", ["empty", "invalid_source", "invalid_digest", "other_target", "extra"])
def test_reassessment_invalid_provenance_fails_before_writing(tmp_path, mutation):
    provenance = reassessment_provenance()
    if mutation == "empty": provenance = {}
    elif mutation == "invalid_source": provenance["source_run_id"] = "not-a-uuid"
    elif mutation == "invalid_digest": provenance["source_evaluator_version"] = "invalid"
    elif mutation == "other_target": provenance["target_evaluator_version"] = "f" * 64
    else: provenance["untrusted"] = "extra"
    target = tmp_path / "invalid"
    with pytest.raises(ValueError, match="invalid reassessment provenance"):
        capture.evaluate_capture.fn(str(FIXTURE), str(CAPTURE), str(CAPTURE), str(target), reassessment=provenance)
    assert not target.exists()
