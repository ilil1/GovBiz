"""저장 캡처의 검증·지표·보고서 계산. Prefect 없이 실행할 수 있다."""

from hashlib import sha256
import json
from math import isfinite
import os
from pathlib import Path
import re
from uuid import UUID

# 보고서 라이브러리의 사용량 telemetry도 외부로 보내지 않는다.
os.environ["DO_NOT_TRACK"] = "1"

import pandas as pd
import pandera.pandas as pa
from evidently import Report
from evidently.metrics import MeanValue, RowCount
from evidently.legacy.renderers.html_widgets import WidgetSize

from govbiz_evaluation import evaluate
from govbiz_ai_runtime.config import LangfuseSettings

from govbiz_evaluation_contracts.execution_spec import evaluation_version

# 평가 코드·입력 모델·잠금 의존성이 달라지면 점수 ID도 달라진다.
EVALUATOR_VERSION = evaluation_version()

INPUT_SCHEMA = pa.DataFrameSchema({
    "case_id": pa.Column(str, unique=True),
    "expected_status": pa.Column(str, pa.Check.isin(["ANSWERED", "INSUFFICIENT_EVIDENCE"])),
    "chunk_count": pa.Column(int, pa.Check.in_range(1, 5)),
}, strict=True)

RESULT_SCHEMA = pa.DataFrameSchema({
    "case_id": pa.Column(str, unique=True),
    "outcome": pa.Column(str, pa.Check.isin(["success", "error", "missing"])),
    "status_match": pa.Column(float, pa.Check.isin([0.0, 1.0]), nullable=True),
    "citation_recall": pa.Column(float, pa.Check.in_range(0, 1), nullable=True),
    "failed": pa.Column(float, pa.Check.isin([0.0, 1.0])),
    "missing": pa.Column(float, pa.Check.isin([0.0, 1.0])),
    "elapsed_ms": pa.Column(float, pa.Check.ge(0), nullable=True),
    "input_tokens": pa.Column(float, pa.Check.ge(0), nullable=True),
    "output_tokens": pa.Column(float, pa.Check.ge(0), nullable=True),
}, strict=True, checks=[
    pa.Check(lambda frame: (frame.status_match.notna() == (frame.outcome == "success")).all()),
    pa.Check(lambda frame: (frame.failed == (frame.outcome == "error").astype(float)).all()),
    pa.Check(lambda frame: (frame.missing == (frame.outcome == "missing").astype(float)).all()),
    pa.Check(lambda frame: frame.loc[frame.outcome != "success", "citation_recall"].isna().all()),
])


def load_results(fixture_path: Path, capture_path: Path, case_ids: list[str] | None = None) -> dict:
    fixture, prepared, fixture_hash = evaluate.load_fixture(fixture_path)
    raw = capture_path.read_bytes()
    capture = json.loads(raw)
    evaluate.require(isinstance(capture, dict), "capture must be an object")
    # 전체 원본을 먼저 검증한다. 비교 대상 선택으로 손상·실패한 원본을 정상처럼 만들지 않는다.
    source_summary = evaluate.report(fixture, prepared, fixture_hash, capture)
    source_case_ids = source_summary["selectedCaseIds"]
    if case_ids is not None and case_ids != source_case_ids:
        evaluate.select_cases(prepared, case_ids)
        evaluate.require(set(case_ids) <= set(source_case_ids), "comparison cases are absent from source")
        evaluate.require(source_summary["completed"], "cannot project an incomplete source")
        capture = {**capture, "caseIds": case_ids,
                   "cases": [record for record in capture["cases"] if record["caseId"] in case_ids]}
    selected = evaluate.select_cases(prepared, capture.get("caseIds", [case["id"] for case, _ in prepared]))
    inputs = pd.DataFrame([{
        "case_id": case["id"], "expected_status": case["expectedStatus"], "chunk_count": len(request.chunks),
    } for case, request in selected])
    INPUT_SCHEMA.validate(inputs, lazy=True)
    summary = evaluate.report(fixture, prepared, fixture_hash, capture)
    observations = {case["id"]: case for case in summary["cases"]}
    records = {case["caseId"]: case for case in capture["cases"]}
    rows = []
    for case, _ in selected:
        observed = observations.get(case["id"], {})
        record = records.get(case["id"], {})
        outcome = observed.get("outcome", "missing")
        expected = observed.get("expectedCitationOrders", [])
        # 기존 report()의 사례별 지표 정의를 사용하고 집계 일치를 아래에서 확인한다.
        recall = evaluate.reference_citation_recall(observed.get("citedOrders", []), expected)
        indexes = record.get("apiResponseIndexes", [])
        evaluate.require(isinstance(indexes, list) and len(indexes) <= 1
                         and all(type(index) is int and 0 <= index < len(capture.get("apiResponses", [])) for index in indexes),
                         "invalid response indexes")
        responses = [capture["apiResponses"][index] for index in indexes]
        usage = responses[0].get("usage") if len(responses) == 1 else None
        evaluate.require(usage is None or isinstance(usage, dict), "invalid usage record")
        elapsed = record.get("elapsedMs")
        evaluate.require(elapsed is None or type(elapsed) in (int, float) and isfinite(elapsed) and elapsed >= 0,
                         "invalid recorded duration")
        for name in ["input_tokens", "output_tokens"]:
            token = (usage or {}).get(name)
            evaluate.require(token is None or type(token) is int and token >= 0, "invalid token count")
        rows.append({
            "case_id": case["id"], "outcome": outcome,
            "status_match": float(observed["statusMatches"]) if outcome == "success" else None,
            "citation_recall": recall, "failed": float(outcome == "error"), "missing": float(outcome == "missing"),
            "elapsed_ms": record.get("elapsedMs"),
            "input_tokens": (usage or {}).get("input_tokens"), "output_tokens": (usage or {}).get("output_tokens"),
        })
    frame = pd.DataFrame(rows)
    for column in frame.columns.difference(["case_id", "outcome"]):
        frame[column] = frame[column].astype(float)
    RESULT_SCHEMA.validate(frame, lazy=True)
    evaluate.require(frame.case_id.tolist() == summary["selectedCaseIds"], "result coverage differs")
    if summary["completed"]:
        evaluate.require(float(frame.status_match.mean()) == summary["statusAccuracy"], "status aggregate differs")
        recall = frame.citation_recall.mean()
        evaluate.require((pd.isna(recall) and summary["referenceCitationRecall"] is None)
                         or float(recall) == summary["referenceCitationRecall"], "citation aggregate differs")
    capture_hash = sha256(raw).hexdigest()
    run_id = sha256(f"{fixture_hash}:{capture_hash}:{EVALUATOR_VERSION}:{summary['selectedCaseIds']}".encode()).hexdigest()[:32]
    return {"run_id": run_id, "frame": frame, "summary": summary, "capture": capture,
            "capture_sha256": capture_hash, "fixture_sha256": fixture_hash, "source_case_ids": source_case_ids}


def write_json(path: Path, value) -> None:
    temporary = path.with_suffix(path.suffix + ".partial")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def add_paired_change_metrics(current: pd.DataFrame, reference: pd.DataFrame, columns: list[str]):
    """동일 사례의 후보−비교 대상과 쌍으로 측정된 비율을 Evidently에 전달한다."""
    current = current.copy()
    reference = reference.copy()
    if (not current.case_id.is_unique or not reference.case_id.is_unique
            or set(current.case_id) != set(reference.case_id)):
        raise ValueError("comparison cases differ")
    before = reference.set_index("case_id")
    after = current.set_index("case_id")
    metrics = []
    for column in columns:
        delta = after[column] - before[column].reindex(after.index)
        paired = delta.notna().astype(float)
        available_name = f"paired_available_{column}"
        delta_name = f"paired_delta_{column}"
        current[available_name] = current.case_id.map(paired)
        reference[available_name] = reference.case_id.map(paired)
        metrics.append(MeanValue(column=available_name))
        if paired.any():
            current[delta_name] = current.case_id.map(delta)
            # 차이가 없는 경우를 0으로 표시한다. 실제 비교 대상의 측정값이 아니다.
            reference[delta_name] = reference.case_id.map(delta.where(delta.isna(), 0.0))
            metrics.append(MeanValue(column=delta_name))
    return current, reference, metrics


def compact_report_charts(snapshot, expected_charts: int) -> None:
    """Evidently 0.7.23 내부 위젯을 두 열로 배치하며 변경된 구조는 명시적으로 거부한다."""
    widgets = snapshot._widgets  # 잠긴 0.7.23은 차트 크기를 설정하는 공개 API가 없다.
    charts = [widget for widget in widgets if widget.type == "big_graph"]
    if len(charts) != expected_charts or any(widget.size != WidgetSize.FULL for widget in charts):
        raise RuntimeError("Unexpected Evidently report widget layout")
    for chart in charts:
        chart.size = WidgetSize.HALF.value


def create_report(current: dict, reference: dict, output: Path) -> dict:
    evaluate.require(current["summary"].get("scope") == reference["summary"].get("scope") == "fixed-answer-context-only",
                     "comparison scopes differ or are unsupported")
    evaluate.require(current["fixture_sha256"] == reference["fixture_sha256"], "comparison fixtures differ")
    evaluate.require(current["frame"].case_id.tolist() == reference["frame"].case_id.tolist(), "comparison cases differ")
    # 부분 캡처의 성공 행만으로 품질 평균을 내지 않는다. 실패·누락은 선택 사례 전체가 분모다.
    columns = ["failed", "missing"]
    if current["summary"]["completed"] and reference["summary"]["completed"]:
        columns += [name for name in ["status_match", "citation_recall"]
                    if current["frame"][name].notna().any() and reference["frame"][name].notna().any()]
    columns += [name for name in ["elapsed_ms", "input_tokens", "output_tokens"]
                if current["frame"][name].notna().all() and reference["frame"][name].notna().all()]
    metadata = {"schema_version": 2, "fixture_sha256": current["fixture_sha256"],
                "case_ids": current["frame"].case_id.tolist(), "evaluation_run_id": current["run_id"], "reference_run_id": reference["run_id"],
                "evaluator_version": EVALUATOR_VERSION, "scope": current["summary"]["scope"],
                "retrieval_evaluated": False,
                "reference_source": current["summary"]["referenceSource"], "semantic_faithfulness": "unmeasured",
                "data_type": current["summary"]["dataType"],
                "comparison": "self-replay" if current["run_id"] == reference["run_id"] else "candidate-reference"}
    paired_columns = (["status_match", "citation_recall"]
                      if current["summary"]["completed"] and reference["summary"]["completed"] else [])
    chart_columns = list(dict.fromkeys([*columns, *paired_columns]))
    chart_current, chart_reference, paired_metrics = add_paired_change_metrics(
        current["frame"][["case_id", "outcome", *chart_columns]],
        reference["frame"][["case_id", "outcome", *chart_columns]], paired_columns,
    )
    unused_columns = [name for name in chart_columns if name not in columns]
    chart_current = chart_current.drop(columns=unused_columns)
    chart_reference = chart_reference.drop(columns=unused_columns)
    snapshot = Report([RowCount(), *[MeanValue(column=name) for name in columns], *paired_metrics],
                      metadata=metadata, include_tests=False).run(
        current_data=chart_current,
        reference_data=chart_reference, name="GovBiz evidence evaluation",
    )
    compact_report_charts(snapshot, len(columns) + len(paired_metrics))
    snapshot.save_html(str(output / "report.html.partial"))
    (output / "report.html.partial").replace(output / "report.html")
    snapshot.save_json(str(output / "evidently.json.partial"))
    (output / "evidently.json.partial").replace(output / "evidently.json")
    artifacts = {name: sha256((output / name).read_bytes()).hexdigest() for name in ["report.html", "evidently.json"]}
    def execution(result):
        return {"run_id": result["run_id"], "model": result["capture"]["model"],
                "prompt_sha256": result["capture"]["promptSha256"],
                "runner_sha256": result["capture"]["runnerSha256"],
                "capture_sha256": result["capture_sha256"],
                "started_at": result["capture"].get("startedAt"),
                "source_case_ids": result["source_case_ids"],
                "measurement_kind": result["summary"].get("measurementKind", "recorded-answer"),
                "provenance": result["summary"].get("provenance")}

    metrics = []
    for key, column, summary_key in [
        ("statusAccuracy", None, "statusAccuracy"),
        ("referenceCitationRecall", None, "referenceCitationRecall"),
        ("failureRate", "failed", None), ("missingRate", "missing", None),
        ("meanLatencyMs", "elapsed_ms", None), ("meanInputTokens", "input_tokens", None),
        ("meanOutputTokens", "output_tokens", None),
        ("semanticFaithfulness", None, "semanticFaithfulness"),
    ]:
        def value(result):
            if summary_key:
                return result["summary"][summary_key]
            # 일부 사례의 관측값만으로 전체 평균처럼 표시하지 않는다.
            series = result["frame"][column]
            return float(series.mean()) if series.notna().all() else None
        before, after = value(reference), value(current)
        metrics.append({"key": key, "reference": before, "candidate": after,
                        "delta": None if before is None or after is None else after - before})
    cases = []
    for before, after in zip(reference["frame"].to_dict(orient="records"), current["frame"].to_dict(orient="records"), strict=True):
        def observation(row):
            return {name: None if pd.isna(row[name]) else row[name]
                    for name in ["outcome", "status_match", "citation_recall"]}
        candidate_observation = observation(after)
        record = next(item for item in current["capture"]["cases"] if item["caseId"] == after["case_id"]) if after["outcome"] != "missing" else {}
        candidate_observation["trace_id"] = record.get("traceId")
        cases.append({"case_id": after["case_id"], "reference": observation(before), "candidate": candidate_observation})
    return {**metadata, "candidate_execution": execution(current), "reference_execution": execution(reference),
            "metrics": metrics, "cases": cases, "artifact_sha256": artifacts, "reported_columns": columns,
            "current": {key: current["summary"][key] for key in [
                "caseCount", "observedCaseCount", "completed", "statusAccuracy", "referenceCitationRecall", "semanticFaithfulness",
            ]}, "reference": {key: reference["summary"][key] for key in [
                "caseCount", "observedCaseCount", "completed", "statusAccuracy", "referenceCitationRecall", "semanticFaithfulness",
            ]}}


def validate_reassessment(value: dict | None) -> dict | None:
    """Validate the source and evaluator identity before recording reassessment provenance."""
    if value is None:
        return None
    fields = {"source_run_id", "source_evaluator_version", "source_approved_evaluator_version", "target_evaluator_version"}
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError("invalid reassessment provenance")
    try:
        source = value["source_run_id"]
        if not isinstance(source, str) or str(UUID(source)) != source:
            raise ValueError
        for key in fields - {"source_run_id"}:
            if not isinstance(value[key], str) or not re.fullmatch(r"[a-f0-9]{64}", value[key]):
                raise ValueError
        if value["target_evaluator_version"] != EVALUATOR_VERSION:
            raise ValueError
    except (ValueError, AttributeError, TypeError):
        raise ValueError("invalid reassessment provenance") from None
    return dict(value)


def score_payloads(result: dict, settings: LangfuseSettings) -> list[dict]:
    evaluate.require(result["summary"].get("scope") == "fixed-answer-context-only", "unsupported score scope")
    metadata = {"case_ids": result["frame"].case_id.tolist(),
                "evaluation_run_id": result["run_id"], "capture_sha256": result["capture_sha256"],
                "fixture_sha256": result["fixture_sha256"], "evaluator_version": EVALUATOR_VERSION,
                "prompt_sha256": result["capture"]["promptSha256"], "model": result["capture"]["model"],
                "source_started_at": result["capture"].get("startedAt"),
                "record_kind": "admin-entered-answer" if result["summary"].get("measurementKind") == "admin-entered-answer"
                else "captured-model-evaluation" if "modelApiCalls" in result["capture"] else "saved-capture-recalculation",
                "source_completed": result["summary"]["completed"],
                "reference_source": result["summary"]["referenceSource"], "scope": result["summary"]["scope"], "retrieval_evaluated": False}
    reassessment = validate_reassessment(result.get("reassessment"))
    if reassessment is not None:
        metadata.update(reassessment, record_kind="stored-response-reassessment")
    payloads = []
    records = {case["caseId"]: case for case in result["capture"]["cases"]}
    for row in result["frame"].to_dict(orient="records"):
        for column, name in [("status_match", "statusMatch"), ("citation_recall", "referenceCitationRecall"),
                             ("failed", "executionFailed"), ("missing", "caseMissing")]:
            if pd.isna(row[column]):
                continue
            item = {"id": sha256(f'{result["run_id"]}:{row["case_id"]}:{name}'.encode()).hexdigest(),
                    "name": name, "value": row[column], "data_type": "NUMERIC", "environment": settings.environment,
                    "metadata": {**metadata, "case_id": row["case_id"]}}
            trace_id = records.get(row["case_id"], {}).get("traceId")
            if trace_id:
                evaluate.require(isinstance(trace_id, str) and len(trace_id) == 32
                                 and all(char in "0123456789abcdef" for char in trace_id), "invalid trace identifier")
                item["trace_id"] = trace_id
            else:
                # 과거 실행에는 새 model trace를 만들지 않는다. 평가 실행 ID를 score session으로 사용한다.
                item["session_id"] = result["run_id"]
            payloads.append(item)
    return payloads
