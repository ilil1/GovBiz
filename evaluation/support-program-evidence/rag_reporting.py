"""RAG 평가 결과의 표·비교 보고서·점수 전송 데이터를 계산한다."""

from hashlib import sha256
from pathlib import Path

import pandas as pd
import pandera.pandas as pa
from evidently import Report
from evidently.metrics import MeanValue, RowCount

from govbiz_evaluation_contracts import rag_replay
from govbiz_evaluation.reporting import add_paired_change_metrics, compact_report_charts

RESULT_SCHEMA = pa.DataFrameSchema(
    {
        "case_id": pa.Column(str, unique=True),
        "retrieval_recall": pa.Column(float, pa.Check.in_range(0, 1), nullable=True),
        "citation_recall": pa.Column(float, pa.Check.in_range(0, 1), nullable=True),
        "status_match": pa.Column(float, pa.Check.isin([0.0, 1.0]), nullable=True),
        "answer_elapsed_ms": pa.Column(float, pa.Check.ge(0), nullable=True),
        "failed": pa.Column(float, pa.Check.isin([0.0, 1.0])),
    },
    strict=True,
)


def result_frame(report):
    frame = pd.DataFrame(
        [
            {
                "case_id": case["caseId"],
                "retrieval_recall": case["retrievalRecallAtK"],
                "citation_recall": case["answerCitationRecall"],
                "status_match": case["answerStatusMatches"],
                "answer_elapsed_ms": case.get("answerElapsedMs"),
                "failed": case["failure"] is not None,
            }
            for case in report["cases"]
        ]
    )
    for column in frame.columns.difference(["case_id"]):
        frame[column] = frame[column].astype(float)
    return RESULT_SCHEMA.validate(frame, lazy=True)


def render(value, output):
    current, reference = (result_frame(value[key]) for key in ("current", "reference"))
    # 실패율은 전체 사례, 품질 평균은 측정 사례만 포함한다. 각 분모를 함께 보존한다.
    columns = [
        name
        for name in current.columns
        if name != "case_id"
        and current[name].notna().any()
        and reference[name].notna().any()
    ]
    metadata = {
        "scope": rag_replay.SCOPE,
        "evaluation_run_id": value["evaluation_run_id"],
        "baseline_eligible": False,
        "current_measurement_kind": value["current"]["measurementKind"],
        "reference_measurement_kind": value["reference"]["measurementKind"],
        "current_metrics": value["current"]["metrics"],
        "reference_metrics": value["reference"]["metrics"],
        "current_coverage": value["current"]["coverage"],
        "reference_coverage": value["reference"]["coverage"],
    }
    paired_columns = ["retrieval_recall", "citation_recall", "status_match"]
    chart_columns = list(dict.fromkeys([*columns, *paired_columns]))
    chart_current, chart_reference, paired_metrics = add_paired_change_metrics(
        current[["case_id", *chart_columns]], reference[["case_id", *chart_columns]], paired_columns,
    )
    unused_columns = [name for name in chart_columns if name not in columns]
    chart_current = chart_current.drop(columns=unused_columns)
    chart_reference = chart_reference.drop(columns=unused_columns)
    snapshot = Report(
        [RowCount(), *[MeanValue(column=name) for name in columns], *paired_metrics],
        metadata=metadata,
        include_tests=False,
    ).run(
        current_data=chart_current,
        reference_data=chart_reference,
        name="GovBiz RAG evaluation comparison",
    )
    compact_report_charts(snapshot, len(columns) + len(paired_metrics))
    snapshot.save_html(str(output / "report.html.partial"))
    (output / "report.html.partial").replace(output / "report.html")
    current.to_json(
        output / "results.json", orient="records", force_ascii=False, indent=2
    )


def score_payloads(value, spec, settings):
    result = value["current"]
    payloads = []
    for case in result["cases"]:
        for name, measured in (
            ("ragRetrievalRecallAtK", case["retrievalRecallAtK"]),
            ("ragAnswerCitationRecall", case["answerCitationRecall"]),
            ("ragAnswerStatusMatch", case["answerStatusMatches"]),
            ("ragSourceCaseFailed", case["failure"] is not None),
        ):
            if measured is None:
                continue
            payload = {
                "id": sha256(
                    f"{value['evaluation_run_id']}:{case['caseId']}:{name}".encode()
                ).hexdigest(),
                "name": name,
                "value": float(measured),
                "data_type": "NUMERIC",
                "environment": settings.environment,
                "metadata": {
                    "scope": rag_replay.SCOPE,
                    "evaluation_run_id": value["evaluation_run_id"],
                    "case_id": case["caseId"],
                    "fixture_sha256": result["fixtureSha256"],
                    "capture_sha256": result["captureSha256"],
                    "measurement_kind": result["measurementKind"],
                    "evaluator_version": spec["evaluation"]["version"],
                    "baseline_eligible": False,
                    "source_completed": result["completed"],
                    "score_computation_model_api_calls": 0,
                    "live_execution_performed": result["liveExecutionPerformed"],
                },
            }
            if case["traceId"]:
                payload["trace_id"] = case["traceId"]
            else:
                # Langfuse 점수는 trace 또는 session 중 한 대상에만 연결한다.
                payload["session_id"] = value["evaluation_run_id"]
            payloads.append(payload)
    return payloads
