"""RAG 평가 결과의 점수 연결과 기존 캡처 원본 보존을 검증한다."""

import json
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

EVIDENCE = Path(__file__).resolve().parent
sys.path.insert(0, str(EVIDENCE))
import rag_evaluate
import rag_reporting
from apps.evaluations import rag_replay
from apps.evaluations.rag_material import material_from_sources


@pytest.mark.parametrize("kind", ["synthetic", "integration-stub", "recorded"])
@pytest.mark.parametrize("stage", [None, "not_started", "source", "chunk", "index", "search", "answer"])
def test_review_material_preserves_real_evaluator_stage_contract(tmp_path, kind, stage):
    from test_rag_evaluate import fail_at

    here = EVIDENCE
    fixture = json.loads((here / "rag-fixture.json").read_bytes())
    candidate = json.loads((here / "rag-synthetic-capture.json").read_bytes())
    reference = deepcopy(candidate)
    if kind != "synthetic":
        candidate["schemaVersion"] = (
            "support-program-rag-capture-v2" if kind == "integration-stub"
            else "support-program-rag-capture-v1"
        )
        candidate["execution"] = {
            "kind": kind, "model": "offline-model", "embeddingModel": "offline-embedding",
            "promptSha256": "a" * 64, "recorderSha256": "b" * 64,
            **({"paidModelApiCalls": 0} if kind == "integration-stub" else {}),
        }
        candidate["cases"][0]["traceId"] = "1" * 32
    if stage is not None:
        fail_at(candidate["cases"][0], stage)
    saved = tmp_path / "capture.json"
    saved.write_text(json.dumps(candidate, ensure_ascii=False))
    current = rag_evaluate.evaluate(here / "rag-fixture.json", saved)
    before = rag_evaluate.evaluate(here / "rag-fixture.json", here / "rag-synthetic-capture.json")
    comparison = {"scope": rag_replay.SCOPE, "case_ids": [c["id"] for c in fixture["cases"]], "current": current, "reference": before}
    material = material_from_sources(fixture, candidate, reference, comparison)
    first = material["cases"][0]
    assert first["reference"]["answer"] == reference["cases"][0]["answer"]["response"]["answer"]
    assert first["candidate"]["failure"] == candidate["cases"][0]["failure"]
    assert first["candidate"]["trace_id"] == candidate["cases"][0]["traceId"]
    assert (first["candidate"]["answer"] is None) == (stage is not None)
    assert (first["candidate"]["context_chunk_ids"] is None) == (stage not in (None, "answer"))
    assert material["candidate_measurement_kind"] == current["measurementKind"]
    assert material["reference_measurement_kind"] == "synthetic-contract-check"


def test_scores_target_either_original_trace_or_replay_session():
    here = EVIDENCE
    report = rag_evaluate.evaluate(here / "rag-fixture.json", here / "rag-synthetic-capture.json")
    report["cases"][0]["traceId"] = "1" * 32
    value = {"current": report, "evaluation_run_id": "2" * 32}
    spec = {"evaluation": {"version": "test"}}
    scores = rag_reporting.score_payloads(value, spec, SimpleNamespace(environment="test"))
    for score in scores:
        assert ("trace_id" in score) != ("session_id" in score)
        if score["metadata"]["case_id"] == "R01":
            assert score["trace_id"] == "1" * 32
        else:
            assert score["session_id"] == value["evaluation_run_id"]
        assert score["metadata"]["evaluation_run_id"] == value["evaluation_run_id"]
    assert scores == rag_reporting.score_payloads(value, spec, SimpleNamespace(environment="test"))


def test_registered_core_snapshots_keep_original_ci_bytes():
    folder = EVIDENCE / "runs/core-rag-20261002"
    source = json.loads((folder / "provenance.json").read_bytes())
    assert source["commit"] == "461e79e13c9d8a87d7aa1fa5d59da64833762600"
    assert source["paidModelApiCalls"] == 0 and source["baselineEligible"] is False
    assert set(source["files"]) == {
        f"{v}/{name}.json" for v in ("v1", "v2") for name in ("fixture", "capture")
    }
    for name, expected in source["files"].items():
        assert sha256((folder / name).read_bytes()).hexdigest() == expected
