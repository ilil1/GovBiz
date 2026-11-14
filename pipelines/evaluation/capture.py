"""저장 캡처의 무료 평가·보고서·점수 전송 순서를 관리한다."""

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
# Prefect의 파일 진입점 로더에서도 평가 모듈을 찾을 수 있게 한다.
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import pipelines  # noqa: F401 -- initialize shared source paths before loading the flow

from filelock import FileLock
from prefect import flow
from prefect.runtime import flow_run

from reporting import EVALUATOR_VERSION, validate_reassessment, write_json
from pipelines.evaluation.tasks import prepare, publish, render


@flow(name="govbiz-evidence-capture-evaluation", retries=0, timeout_seconds=300, persist_result=False)
def evaluate_capture(fixture: str, capture: str, reference: str, output_dir: str, case_ids: list[str] | None = None,
                     execution_spec_sha256: str | None = None, reassessment: dict | None = None) -> dict:
    reassessment = validate_reassessment(reassessment)
    lock_dir = ROOT / "work/llmops"
    lock_dir.mkdir(parents=True, exist_ok=True)
    # 수동 실행 프로세스도 같은 checkout에서 겹치지 않는다. 배포 시에도 serve(limit=1)을 적용한다.
    with FileLock(str(lock_dir / "evaluation.lock"), timeout=0):
        output = Path(output_dir)
        output.mkdir(parents=True, exist_ok=False)
        manifest = {"status": "running", "prefect_flow_run_id": str(flow_run.id),
                    "started_at": datetime.now(timezone.utc).isoformat(), "model_api_calls": 0}
        if execution_spec_sha256:
            manifest["execution_spec_sha256"] = execution_spec_sha256
        write_json(output / "manifest.json", manifest)
        try:
            current = prepare(fixture, capture, case_ids)
            baseline = prepare(fixture, reference, case_ids)
            if reassessment is not None:
                current = {**current, "reassessment": reassessment,
                           "run_id": sha256(f"stored-response-reassessment:{reassessment['source_run_id']}:{reassessment['target_evaluator_version']}:{current['run_id']}".encode()).hexdigest()[:32]}
            manifest.update(evaluation_run_id=current["run_id"], reference_run_id=baseline["run_id"],
                            scope=current["summary"]["scope"],
                            capture_sha256=current["capture_sha256"], reference_capture_sha256=baseline["capture_sha256"],
                            fixture_sha256=current["fixture_sha256"], evaluator_version=EVALUATOR_VERSION)
            # 프로세스가 강제 종료되어도 검증된 입력과 실패 단계를 복구할 수 있게 먼저 기록한다.
            manifest["stage"] = "report"
            write_json(output / "manifest.json", manifest)
            current["frame"].to_json(output / "results.json", orient="records", force_ascii=False, indent=2)
            report = render(current, baseline, str(output))
            write_json(output / "comparison.json", report)
            report["artifact_sha256"]["comparison.json"] = sha256((output / "comparison.json").read_bytes()).hexdigest()
            manifest["stage"] = "publish"
            write_json(output / "manifest.json", manifest)
            score_ids = publish(current)
            manifest.update(status="completed", score_ids=score_ids, report="report.html",
                            artifact_sha256=report["artifact_sha256"])
            if not current["summary"]["completed"] or not baseline["summary"]["completed"]:
                raise RuntimeError("Source evaluation is incomplete; partial results were preserved")
            manifest["stage"] = "completed"
        except BaseException:
            manifest["status"] = "failed"
            raise
        finally:
            manifest["finished_at"] = datetime.now(timezone.utc).isoformat()
            write_json(output / "manifest.json", manifest)
        return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if not os.environ.get("PREFECT_API_URL"):
        parser.error("PREFECT_API_URL is required; start the local evaluation server first")
    result = evaluate_capture(*(str(path.resolve()) for path in [args.fixture, args.capture, args.reference, args.output_dir]))
    print(json.dumps(result, ensure_ascii=False, indent=2))



if __name__ == "__main__":
    main()
