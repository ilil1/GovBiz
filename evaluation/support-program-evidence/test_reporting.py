"""모델·외부 서버 없이 저장 캡처의 데이터 계약과 보고서를 검증한다."""

from copy import deepcopy
import json
from pathlib import Path
import sys

import pandas as pd
import pandera.pandas as pa
import pytest
from plotly.utils import PlotlyJSONEncoder

HERE = Path(__file__).resolve().parent
from govbiz_evaluation import reporting
from govbiz_ai_runtime.config import LangfuseSettings

FIXTURE = HERE / "target-coverage-fixture.json"
CAPTURE = HERE / "runs/target-coverage-20260907-v1/capture.json"


def test_replay_preserves_existing_metrics_and_unknown_usage():
    result = reporting.load_results(FIXTURE, CAPTURE)
    original = json.loads(CAPTURE.with_name("report.json").read_text())
    assert result["summary"] == original
    assert result["frame"].shape == (6, 9)
    assert result["frame"].input_tokens.isna().all()
    assert result["summary"]["semanticFaithfulness"] is None
    assert result["run_id"] == reporting.load_results(FIXTURE, CAPTURE)["run_id"]


@pytest.mark.parametrize("mutation", ["duplicate", "out-of-range", "missing-status", "wrong-failure"])
def test_result_schema_rejects_invalid_rows(mutation):
    frame = reporting.load_results(FIXTURE, CAPTURE)["frame"].copy()
    if mutation == "duplicate":
        frame = pd.concat([frame, frame.iloc[:1]])
    elif mutation == "out-of-range":
        frame.loc[0, "citation_recall"] = 1.1
    elif mutation == "missing-status":
        frame.loc[0, "status_match"] = float("nan")
    else:
        frame.loc[0, "failed"] = 1.0
    with pytest.raises(pa.errors.SchemaErrors):
        reporting.RESULT_SCHEMA.validate(frame, lazy=True)


def partial_capture(tmp_path):
    capture = json.loads(CAPTURE.read_text())
    capture["completed"] = False
    capture["cases"] = [capture["cases"][0], {
        "caseId": capture["cases"][1]["caseId"], "requestSha256": capture["cases"][1]["requestSha256"],
        "outcome": "error", "errorType": "SupportProgramEvidenceError",
    }]
    target = tmp_path / "partial.json"
    target.write_text(json.dumps(capture))
    return target


def test_partial_capture_preserves_missing_rows_and_no_overall_quality(tmp_path):
    current = reporting.load_results(FIXTURE, partial_capture(tmp_path))
    assert current["frame"].outcome.tolist() == ["success", "error", "missing", "missing", "missing", "missing"]
    assert current["summary"]["statusAccuracy"] is None
    assert current["frame"].status_match.notna().sum() == 1
    report = reporting.create_report(current, reporting.load_results(FIXTURE, CAPTURE), tmp_path)
    assert "status_match" not in report["reported_columns"]
    assert "citation_recall" not in report["reported_columns"]
    assert report["current"]["completed"] is False


def test_report_detects_known_change_and_preserves_run_ids(tmp_path):
    baseline = reporting.load_results(FIXTURE, CAPTURE)
    capture = json.loads(CAPTURE.read_text())
    capture["cases"][0]["response"].update(answerStatus="INSUFFICIENT_EVIDENCE", citationChunkIds=[])
    candidate = tmp_path / "candidate.json"
    candidate.write_text(json.dumps(capture))
    current = reporting.load_results(FIXTURE, candidate)
    report = reporting.create_report(current, baseline, tmp_path)
    assert report["scope"] == "fixed-answer-context-only"
    assert report["retrieval_evaluated"] is False
    assert report["current"]["statusAccuracy"] == pytest.approx(5 / 6)
    assert report["reference"]["statusAccuracy"] == 1
    assert report["evaluation_run_id"] != report["reference_run_id"]
    metric = next(item for item in report["metrics"] if item["key"] == "statusAccuracy")
    assert metric["delta"] == pytest.approx(-1 / 6)
    assert report["cases"][0]["candidate"]["status_match"] == 0
    assert report["cases"][0]["reference"]["status_match"] == 1
    unmeasured = next(item for item in report["metrics"] if item["key"] == "semanticFaithfulness")
    assert unmeasured["delta"] is unmeasured["candidate"] is unmeasured["reference"] is None
    assert (tmp_path / "report.html").stat().st_size > 1000
    snapshot = json.loads((tmp_path / "evidently.json").read_text())
    assert "0.8333333333333334" in json.dumps(snapshot)
    metrics = {item["metric_name"]: item["value"] for item in snapshot["metrics"]}
    assert metrics["MeanValue(column=paired_available_status_match)"] == 1
    assert metrics["MeanValue(column=paired_delta_status_match)"] == pytest.approx(-1 / 6)


def test_comparison_rejects_different_cases_before_writing(tmp_path):
    current = reporting.load_results(FIXTURE, CAPTURE)
    other = deepcopy(current)
    other["frame"] = other["frame"].iloc[:1]
    with pytest.raises(ValueError, match="cases differ"):
        reporting.create_report(current, other, tmp_path)
    assert not (tmp_path / "report.html").exists()


@pytest.mark.parametrize("scope", [None, "full-rag", "core-http-mysql-frozen-html-ai-evidence-flow"])
def test_other_capture_scopes_are_not_relabeled_as_fixed_context(tmp_path, scope):
    capture = json.loads(CAPTURE.read_text())
    capture["scope"] = scope
    target = tmp_path / "capture.json"
    target.write_text(json.dumps(capture))
    with pytest.raises(ValueError, match="capture scope"):
        reporting.load_results(FIXTURE, target)


def test_mixed_scopes_never_produce_reports_or_scores(tmp_path):
    fixed = reporting.load_results(FIXTURE, CAPTURE)
    other = deepcopy(fixed)
    other["summary"]["scope"] = "full-rag"
    with pytest.raises(ValueError, match="scopes"):
        reporting.create_report(fixed, other, tmp_path)
    with pytest.raises(ValueError, match="score scope"):
        reporting.score_payloads(other, LangfuseSettings())
    assert not (tmp_path / "report.html").exists()


def test_other_fixture_scope_is_rejected_before_loading_capture(tmp_path):
    fixture = json.loads(FIXTURE.read_text())
    fixture["scope"] = "full-rag"
    target = tmp_path / "fixture.json"
    target.write_text(json.dumps(fixture))
    with pytest.raises(ValueError, match="fixture scope"):
        reporting.load_results(target, tmp_path / "absent-capture.json")


@pytest.mark.parametrize("value", [-1, float("inf"), True, "100"])
def test_invalid_recorded_duration_is_rejected(tmp_path, value):
    data = json.loads(CAPTURE.read_text())
    data["cases"][0]["elapsedMs"] = value
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="duration"):
        reporting.load_results(FIXTURE, path)


def test_existing_prompt_versions_compare_same_case_without_editing_source(tmp_path):
    from hashlib import sha256
    fixture = HERE / "fixture.json"
    old_path = HERE / "runs/fixed-context-20260906-diagnostic-v1/capture.json"
    new_path = HERE / "runs/fixed-context-20260907-index-v1/capture.json"
    before = new_path.read_bytes()
    old = reporting.load_results(fixture, old_path, ["E01"])
    new = reporting.load_results(fixture, new_path, ["E01"])
    report = reporting.create_report(new, old, tmp_path)
    assert report["comparison"] == "candidate-reference"
    assert report["case_ids"] == ["E01"]
    assert report["current"]["caseCount"] == report["reference"]["caseCount"] == 1
    assert report["candidate_execution"]["source_case_ids"] == ["E01", "E07", "E10", "E12"]
    assert report["candidate_execution"]["prompt_sha256"] != report["reference_execution"]["prompt_sha256"]
    tokens = next(item for item in report["metrics"] if item["key"] == "meanOutputTokens")
    # 과거 캡처에는 사례→API 응답 연결이 없어 토큰을 순서로 추정하지 않는다.
    assert tokens == {"key": "meanOutputTokens", "reference": None, "candidate": None, "delta": None}
    latency = next(item for item in report["metrics"] if item["key"] == "meanLatencyMs")
    assert latency["reference"] == 4007.205 and latency["candidate"] == 4124.682
    assert latency["delta"] == pytest.approx(117.477)
    assert new["capture_sha256"] == sha256(before).hexdigest()
    assert new_path.read_bytes() == before
    full = reporting.load_results(fixture, new_path)
    assert full["run_id"] != new["run_id"]
    with pytest.raises(ValueError, match="cases differ"):
        reporting.create_report(full, old, tmp_path)
    with pytest.raises(ValueError, match="absent"):
        reporting.load_results(fixture, old_path, ["E02"])


def test_projection_cannot_hide_failed_or_tampered_source(tmp_path):
    with pytest.raises(ValueError, match="incomplete"):
        reporting.load_results(FIXTURE, partial_capture(tmp_path), ["TC01"])
    capture = json.loads(CAPTURE.read_text())
    capture["cases"][-1]["requestSha256"] = "0" * 64
    path = tmp_path / "tampered.json"
    path.write_text(json.dumps(capture))
    with pytest.raises(ValueError, match="hash"):
        reporting.load_results(FIXTURE, path, ["TC01"])


def test_unknown_usage_is_not_zero_or_a_partial_average(tmp_path):
    data = json.loads(CAPTURE.read_text())
    for index, record in enumerate(data["cases"]):
        record["apiResponseIndexes"] = [index]
    baseline = tmp_path / "mapped-usage.json"
    baseline.write_text(json.dumps(data))
    data["apiResponses"][0]["usage"] = None
    path = tmp_path / "missing-usage.json"
    path.write_text(json.dumps(data))
    result = reporting.load_results(FIXTURE, path)
    report = reporting.create_report(result, reporting.load_results(FIXTURE, baseline), tmp_path)
    metric = next(item for item in report["metrics"] if item["key"] == "meanInputTokens")
    assert metric["reference"] > 0 and metric["candidate"] is None and metric["delta"] is None
    assert "input_tokens" not in report["reported_columns"]


def test_paired_report_aligns_case_ids_and_keeps_unmeasured_values():
    current = pd.DataFrame({"case_id": ["A", "B", "C"], "score": [0.8, None, 0.2]})
    reference = pd.DataFrame({"case_id": ["C", "A", "B"], "score": [None, 0.5, 0.4]})
    after, before, metrics = reporting.add_paired_change_metrics(current, reference, ["score"])
    assert after.paired_available_score.tolist() == [1, 0, 0]
    assert before.paired_available_score.tolist() == [0, 1, 0]
    assert after.paired_delta_score.iloc[0] == pytest.approx(0.3)
    assert after.paired_delta_score.iloc[1:].isna().all()
    assert before.paired_delta_score.iloc[1] == 0
    assert before.paired_delta_score.iloc[[0, 2]].isna().all()
    snapshot = reporting.Report(metrics, include_tests=False).run(current_data=after, reference_data=before).dict()
    values = {item["metric_name"]: item["value"] for item in snapshot["metrics"]}
    assert values["MeanValue(column=paired_available_score)"] == pytest.approx(1 / 3)
    assert values["MeanValue(column=paired_delta_score)"] == pytest.approx(0.3)



def test_paired_report_with_no_measured_pair_has_only_zero_availability():
    current = pd.DataFrame({"case_id": ["A", "B"], "score": [0.5, None]})
    reference = pd.DataFrame({"case_id": ["B", "A"], "score": [0.4, None]})
    after, before, metrics = reporting.add_paired_change_metrics(current, reference, ["score"])
    assert "paired_delta_score" not in after.columns
    assert after.paired_available_score.tolist() == [0, 0]
    snapshot = reporting.Report(metrics, include_tests=False).run(
        current_data=after.drop(columns="score"), reference_data=before.drop(columns="score")
    ).dict()
    assert snapshot["metrics"][0]["value"] == 0



def test_compact_charts_preserve_metrics_and_reject_unexpected_layout():
    current = pd.DataFrame({"score": [0.0, 0.5, 1.0], "other": [0.0, 1.0, 1.0]})
    reference = pd.DataFrame({"score": [1.0, 0.5, 1.0], "other": [0.0, 0.0, 1.0]})
    snapshot = reporting.Report(
        [reporting.RowCount(), reporting.MeanValue(column="score"), reporting.MeanValue(column="other")],
        include_tests=False,
    ).run(current_data=current, reference_data=reference)
    metrics = deepcopy(snapshot.dict())
    graphs = [widget for widget in snapshot._widgets if widget.type == "big_graph"]
    payloads = [deepcopy(widget.params) for widget in graphs]
    reporting.compact_report_charts(snapshot, 2)
    assert [widget.size for widget in graphs] == [1, 1]
    assert json.dumps([widget.params for widget in graphs], cls=PlotlyJSONEncoder, sort_keys=True) == json.dumps(
        payloads, cls=PlotlyJSONEncoder, sort_keys=True
    )
    assert snapshot.dict() == metrics
    with pytest.raises(RuntimeError, match="Unexpected Evidently report widget layout"):
        reporting.compact_report_charts(snapshot, 2)
