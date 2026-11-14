"""등록된 RAG 캡처를 무료로 재계산하고 보고서와 점수를 보존한다."""

from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
# Prefect의 파일 진입점 로더에서도 평가 모듈을 찾을 수 있게 한다.
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import pipelines  # noqa: F401 -- initialize shared source paths before loading the flow

from filelock import FileLock
from prefect import flow, task
from prefect.cache_policies import NO_CACHE
from prefect.runtime import flow_run

import rag_evaluate
from app.config import LangfuseSettings
from apps.evaluations import rag_replay
from reporting import write_json
from rag_reporting import render, score_payloads
from pipelines.evaluation.clients import publish_payloads


@flow(
    name="govbiz-rag-capture-replay",
    retries=0,
    timeout_seconds=300,
    persist_result=False,
)
def evaluate_rag_capture(
    fixture, capture, reference, output_dir, *, execution_spec, execution_spec_sha256
):
    spec = execution_spec
    lock_dir = ROOT / "work/llmops"
    lock_dir.mkdir(parents=True, exist_ok=True)
    with FileLock(str(lock_dir / "evaluation.lock"), timeout=0):
        output = Path(output_dir)
        output.mkdir(parents=True, exist_ok=False)
        manifest = {
            "status": "running",
            "stage": "validate",
            "scope": rag_replay.SCOPE,
            "model_api_calls": 0,
            "prefect_flow_run_id": str(flow_run.id),
            "execution_spec_sha256": execution_spec_sha256,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        write_json(output / "manifest.json", manifest)
        try:
            @task(name="validate-rag-results", retries=0, cache_policy=NO_CACHE, persist_result=False)
            def validate_rag_results():
                current = rag_evaluate.evaluate(Path(fixture), Path(capture))
                if spec["execution_mode"] == "live":
                    current.update(measurementKind="recorded-live-evaluation", liveExecutionPerformed=True)
                baseline = rag_evaluate.evaluate(Path(fixture), Path(reference))
                return current, baseline, rag_replay.comparison(current, baseline, spec)

            current, baseline, value = validate_rag_results()
            # 저장 원본이 실패한 사례도 정상적인 재계산 대상이다. 원본 완료 여부는 별도 필드다.
            manifest.update(
                evaluation_run_id=value["evaluation_run_id"],
                reference_run_id=value["reference_run_id"],
                evaluator_version=spec["evaluation"]["version"],
                fixture_sha256=current["fixtureSha256"],
                capture_sha256=current["captureSha256"],
                reference_capture_sha256=baseline["captureSha256"],
                stage="report",
            )
            write_json(output / "manifest.json", manifest)
            @task(name="render-rag-comparison", retries=0, cache_policy=NO_CACHE, persist_result=False)
            def render_rag_comparison():
                render(value, output)

            render_rag_comparison()
            write_json(output / "comparison.json", value)
            manifest.update(
                stage="publish",
                artifact_sha256={
                    name: sha256((output / name).read_bytes()).hexdigest()
                    for name in ("report.html", "comparison.json")
                },
            )
            write_json(output / "manifest.json", manifest)
            @task(name="publish-rag-scores", retries=0, cache_policy=NO_CACHE, persist_result=False)
            def publish_rag_scores():
                settings = LangfuseSettings.from_environment()
                return publish_payloads(score_payloads(value, spec, settings), settings)

            manifest["score_ids"] = publish_rag_scores()
            manifest.update(status="completed", stage="completed")
        except BaseException:
            manifest["status"] = "failed"
            raise
        finally:
            manifest["finished_at"] = datetime.now(timezone.utc).isoformat()
            write_json(output / "manifest.json", manifest)
        return manifest
