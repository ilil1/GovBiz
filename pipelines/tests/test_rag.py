"""실제 RAG 계산기·Pandera·Evidently를 접수 명세와 연결하며 모델 호출은 금지한다."""

import json
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from pipelines.evaluation import flows as ops_flow
import pytest
from pipelines.evaluation import rag
import rag_reporting
from apps.evaluations import rag_replay
from apps.evaluations.catalog import public_datasets, validate_execution
from apps.evaluations.execution_spec import digest, make_spec, read_release
from apps.evaluations.rag_material import material_from_sources
from apps.evaluations.recovery_inputs import read_recovery_inputs

DATASET = "rag-synthetic-multichunk-v1"
CAPTURE = "rag-synthetic-capture-v1"


EVIDENCE = Path(__file__).resolve().parents[2] / "evaluation/support-program-evidence"


def parameters(mode="replay", recovery=None, *, dataset=DATASET, capture=CAPTURE):
    spec = make_spec(
        read_release(), dataset, mode, {}, capture, capture, recovery_config=recovery
    )
    return {
        "request_id": str(uuid4()),
        "dataset_id": dataset,
        "execution_mode": mode,
        "candidate_capture_id": capture,
        "reference_capture_id": capture,
        "execution_spec": spec,
        "execution_spec_sha256": digest(spec),
        "recovery_config": recovery,
    }


@pytest.fixture
def runner(monkeypatch, tmp_path):
    monkeypatch.setenv("LLMOPS_RESULTS_DIR", str(tmp_path))
    monkeypatch.setattr(rag, "ROOT", tmp_path)
    monkeypatch.setattr(ops_flow, "flow_run", SimpleNamespace(id=str(uuid4())))
    monkeypatch.setattr(rag, "flow_run", SimpleNamespace(id=str(uuid4())))
    monkeypatch.setattr(
        ops_flow, "evaluate_rag_capture", rag.evaluate_rag_capture.fn
    )
    monkeypatch.setattr(
        ops_flow.evaluate, "execute", lambda *a, **kw: pytest.fail("No model calls")
    )
    monkeypatch.setattr(
        ops_flow, "BudgetClient", lambda *a: pytest.fail("No paid reservation")
    )
    monkeypatch.setattr(
        rag.LangfuseSettings,
        "from_environment",
        lambda: SimpleNamespace(environment="test"),
    )
    scores = []
    monkeypatch.setattr(
        rag,
        "publish_payloads",
        lambda payloads, _: scores.extend(payloads) or [p["id"] for p in payloads],
    )
    return tmp_path, scores


def test_ops_entrypoint_replays_three_cases_with_real_report_and_distinct_metrics(
    runner, isolated_prefect_tasks,
):
    root, scores = runner
    params = parameters()
    manifest = ops_flow.evaluate_saved_capture.fn(**params)
    folder = root / params["request_id"] / "evaluation"
    raw = (folder / "comparison.json").read_bytes()
    report = (folder / "report.html").read_bytes()
    result = rag_replay.read_result(
        params["execution_spec"], params["execution_spec_sha256"], manifest, raw, report
    )
    summary = result[1]
    assert len(report) > 1000 and manifest["status"] == "completed"
    assert summary["metrics"]["retrievalRecallAtK"] == {
        "value": 0.5,
        "measuredCaseCount": 2,
        "eligibleCaseCount": 2,
    }
    assert summary["metrics"]["answerCitationRecall"]["value"] == 0.25
    assert (
        summary["measurementKind"] == "synthetic-contract-check"
        and not summary["baselineEligible"]
    )
    assert manifest["model_api_calls"] == 0 and all("trace_id" not in p for p in scores)
    assert len(scores) == len({p["id"] for p in scores}) == 10
    assert all(
        p["session_id"] == result[0] and p["metadata"]["scope"] == rag_replay.SCOPE
        for p in scores
    )
    here = EVIDENCE
    fixture = json.loads((here / "rag-fixture.json").read_bytes())
    capture = json.loads((here / "rag-synthetic-capture.json").read_bytes())
    material = material_from_sources(fixture, capture, capture, result[3])
    assert material["cases"][0]["candidate"]["answer"] == capture["cases"][0]["answer"]["response"]["answer"]
    assert material["cases"][0]["content"] == fixture["documents"][0]["content"]
    assert material["cases"][2]["candidate"]["cited_chunk_ids"] == []
    assert material["baseline_eligible"] is False
    with pytest.raises(FileExistsError):
        ops_flow.evaluate_saved_capture.fn(**params)
    assert len(scores) == 10
    assert isolated_prefect_tasks == [
        ("validate-evaluation-inputs", 0),
        ("validate-rag-results", 0),
        ("render-rag-comparison", 0),
        ("publish-rag-scores", 0),
    ]


@pytest.mark.parametrize("version", ["v1", "v2"])
def test_official_preparation_can_render_unmeasured_report_without_model_calls(runner, version, monkeypatch):
    root, scores = runner
    real_report = rag_reporting.Report
    snapshots = []

    class CapturedReport:
        def __init__(self, *args, **kwargs):
            self.report = real_report(*args, **kwargs)

        def run(self, *args, **kwargs):
            snapshot = self.report.run(*args, **kwargs)
            snapshots.append(snapshot.dict())
            return snapshot

    monkeypatch.setattr(rag_reporting, "Report", CapturedReport)
    params = parameters(dataset=f"official-rag-20261006-{version}", capture=f"official-rag-not-started-{version}")
    manifest = ops_flow.evaluate_saved_capture.fn(**params)
    folder = root / params["request_id"] / "evaluation"
    result = rag_replay.read_result(
        params["execution_spec"], params["execution_spec_sha256"], manifest,
        (folder / "comparison.json").read_bytes(), (folder / "report.html").read_bytes(),
    )
    assert manifest["status"] == "completed" and manifest["model_api_calls"] == 0
    assert not result[1]["completed"] and not result[1]["baselineEligible"]
    assert all(m["value"] is None for m in result[1]["metrics"].values())
    assert all(p["name"] == "ragSourceCaseFailed" for p in scores)
    metrics = {item["metric_name"]: item["value"] for item in snapshots[0]["metrics"]}
    assert metrics["MeanValue(column=paired_available_retrieval_recall)"] == 0
    assert "MeanValue(column=paired_delta_retrieval_recall)" not in metrics


def test_catalog_and_runner_reject_live_and_unpinned_rag_before_spending(runner, monkeypatch):
    monkeypatch.setattr("apps.evaluations.vector_cache.discover", lambda _: None)
    item = next(item for item in public_datasets() if item["id"] == DATASET)
    assert item["live_config"]["max_model_calls"] == 8 and item["execution_profiles"]["live"]
    with pytest.raises(ValueError):
        validate_execution(DATASET, "new-model-response", CAPTURE, "live", {})
    with pytest.raises(ValueError):
        make_spec(read_release(), DATASET, "live", {}, CAPTURE, CAPTURE)
    params = parameters()
    params.update(execution_spec=None, execution_spec_sha256=None)
    with pytest.raises(ValueError):
        ops_flow.evaluate_saved_capture.fn(**params)


@pytest.mark.parametrize("version,failed,cases", [("v1", 4, 9), ("v2", 0, 1)])
def test_registered_core_capture_replays_original_failures_and_trace_scores(
    runner, version, failed, cases
):
    root, scores = runner
    params = parameters(
        dataset=f"core-rag-20261002-{version}",
        capture=f"core-rag-capture-20261002-{version}",
    )
    manifest = ops_flow.evaluate_saved_capture.fn(**params)
    folder = root / params["request_id"] / "evaluation"
    result = rag_replay.read_result(
        params["execution_spec"], params["execution_spec_sha256"], manifest,
        (folder / "comparison.json").read_bytes(), (folder / "report.html").read_bytes(),
    )
    report = result[1]
    assert manifest["status"] == "completed" and manifest["model_api_calls"] == 0
    assert report["measurementKind"] == "integration-stub-replay"
    assert report["coverage"]["failedCaseCount"] == failed
    assert report["completed"] is (failed == 0)
    assert report["caseCount"] == report["coverage"]["traceCaseCount"] == cases
    assert report["baselineEligible"] is False and report["semanticFaithfulness"] is None
    by_case = {case["caseId"]: case for case in report["cases"]}
    for score in scores:
        case = by_case[score["metadata"]["case_id"]]
        assert score["trace_id"] == case["traceId"]
        assert score["metadata"]["source_completed"] is (failed == 0)
        assert score["metadata"]["measurement_kind"] == "integration-stub-replay"
        assert score["metadata"]["score_computation_model_api_calls"] == 0
        if score["name"] == "ragSourceCaseFailed":
            assert score["value"] == float(case["failure"] is not None)
        elif case["failure"] is not None and score["name"] != "ragRetrievalRecallAtK":
            pytest.fail("Unmeasured answers must not receive a quality score")
    assert sum(s["value"] for s in scores if s["name"] == "ragSourceCaseFailed") == failed
    assert len({s["id"] for s in scores}) == len(scores)


@pytest.mark.parametrize("failure", ["report", "publish"])
def test_failed_postprocessing_recovers_without_repeating_model_or_score_identity(
    runner, monkeypatch, failure
):
    root, scores = runner
    params = parameters()
    name = "render" if failure == "report" else "publish_payloads"
    original = getattr(rag, name)

    def fail(*args):
        raise RuntimeError("offline injected failure")

    monkeypatch.setattr(rag, name, fail)
    with pytest.raises(RuntimeError, match="offline injected"):
        ops_flow.evaluate_saved_capture.fn(**params)
    path = root / params["request_id"] / "evaluation/manifest.json"
    failed = json.loads(path.read_text())
    assert failed["status"] == "failed" and failed["stage"] == failure
    _, config, _ = read_recovery_inputs(
        root, EVIDENCE, params["request_id"]
    )
    monkeypatch.setattr(rag, name, original)
    recovered = ops_flow.evaluate_saved_capture.fn(**parameters("recovery", config))
    assert recovered["status"] == "completed" and recovered["model_api_calls"] == 0
    assert recovered["evaluation_run_id"] == failed["evaluation_run_id"]
    assert json.loads(path.read_text()) == failed
    assert len(scores) == 10


def test_original_search_failure_remains_visible_in_successful_recalculation(
    runner, monkeypatch
):
    root, _ = runner
    original = rag.rag_evaluate.evaluate

    def partial(fixture, capture):
        report = original(fixture, capture)
        first = report["cases"][0]
        first.update(
            failure={"stage": "search", "code": "timeout"},
            retrievalMeasured=False,
            answerMeasured=False,
            retrievalRecallAtK=None,
            answerCitationRecall=None,
            answerStatusMatches=None,
            retrievedChunkIds=None,
            citedChunkIds=None,
        )
        report.update(
            completed=False,
            coverage={
                "retrievalCaseCount": 2,
                "answerCaseCount": 2,
                "failedCaseCount": 1,
                "traceCaseCount": 0,
            },
        )
        report["metrics"] = {
            "meanAnswerLatencyMs": report["metrics"]["meanAnswerLatencyMs"],
            "retrievalRecallAtK": {
                "value": 0.0,
                "measuredCaseCount": 1,
                "eligibleCaseCount": 2,
            },
            "answerCitationRecall": {
                "value": 0.0,
                "measuredCaseCount": 1,
                "eligibleCaseCount": 2,
            },
            "answerStatusAccuracy": {
                "value": 1.0,
                "measuredCaseCount": 2,
                "eligibleCaseCount": 3,
            },
        }
        return report

    monkeypatch.setattr(rag.rag_evaluate, "evaluate", partial)
    params = parameters()
    result = ops_flow.evaluate_saved_capture.fn(**params)
    report = json.loads(
        (root / params["request_id"] / "evaluation/comparison.json").read_text()
    )["current"]
    assert result["status"] == "completed" and report["completed"] is False
    assert report["coverage"]["failedCaseCount"] == 1
    assert report["cases"][0]["failure"]["stage"] == "search"


@pytest.mark.parametrize(
    "change",
    [
        "scope",
        "denominator",
        "origin",
        "promote",
        "aggregate",
        "source_hash",
        "artifact",
    ],
)
def test_backend_contract_rejects_rehashed_false_evidence(runner, change):
    root, _ = runner
    params = parameters()
    manifest = ops_flow.evaluate_saved_capture.fn(**params)
    folder = root / params["request_id"] / "evaluation"
    value = json.loads((folder / "comparison.json").read_text())
    report = (folder / "report.html").read_bytes()
    modified = deepcopy(value)
    current = modified["current"]
    if change == "scope":
        current["scope"] = "fixed-answer-context-only"
    elif change == "denominator":
        current["metrics"]["retrievalRecallAtK"]["measuredCaseCount"] = 3
    elif change == "origin":
        current["execution"]["model"] = "invented-model"
    elif change == "promote":
        current["baselineEligible"] = True
    elif change == "aggregate":
        current["metrics"]["retrievalRecallAtK"]["value"] = 1.0
    elif change == "source_hash":
        current["captureSha256"] = "0" * 64
    else:
        report += b"tampered"
    raw = json.dumps(modified).encode()
    manifest["artifact_sha256"]["comparison.json"] = sha256(raw).hexdigest()
    with pytest.raises(ValueError):
        rag_replay.read_result(
            params["execution_spec"],
            params["execution_spec_sha256"],
            manifest,
            raw,
            report,
        )


def test_reviewed_reference_snapshot_survives_postprocessing_recovery(runner, monkeypatch):
    # Worker transport only: the DB tests own human approval/PASS admission.
    root, _ = runner
    source = parameters()
    source_manifest = ops_flow.evaluate_saved_capture.fn(**source)
    reference_id = "run:" + source["request_id"]
    reference_config = {
        "run_id": source["request_id"],
        "capture_sha256": source_manifest["capture_sha256"],
        "fixture_sha256": source_manifest["fixture_sha256"],
        "assessment_id": 123,
        "assessment_input_sha256": "a" * 64,
    }

    def request(mode="replay", recovery=None):
        spec = make_spec(
            read_release(), DATASET, mode, {}, CAPTURE, reference_id,
            reference_config, 1, recovery_config=recovery,
        )
        return {
            **parameters(), "reference_capture_id": reference_id,
            "reference_config": reference_config, "execution_mode": mode,
            "execution_spec": spec, "execution_spec_sha256": digest(spec),
            "recovery_config": recovery,
        }

    original = rag.render
    monkeypatch.setattr(rag, "render", lambda *a: (_ for _ in ()).throw(RuntimeError("report test failure")))
    failed = request()
    with pytest.raises(RuntimeError, match="report test failure"):
        ops_flow.evaluate_saved_capture.fn(**failed)
    here = EVIDENCE
    marker, config, inputs = read_recovery_inputs(root, here, failed["request_id"])
    assert marker["reference_config"] == reference_config
    assert sha256(inputs["reference_capture"]).hexdigest() == reference_config["capture_sha256"]
    monkeypatch.setattr(rag, "render", original)
    recovered = request("recovery", config)
    manifest = ops_flow.evaluate_saved_capture.fn(**recovered)
    assert manifest["status"] == "completed" and manifest["model_api_calls"] == 0
    assert (root / recovered["request_id"] / "reference-capture.json").read_bytes() == inputs["reference_capture"]
    folder = root / recovered["request_id"] / "evaluation"
    result = rag_replay.read_result(
        recovered["execution_spec"], recovered["execution_spec_sha256"], manifest,
        (folder / "comparison.json").read_bytes(), (folder / "report.html").read_bytes(),
    )
    assert result[3]["reference"]["captureSha256"] == reference_config["capture_sha256"]
