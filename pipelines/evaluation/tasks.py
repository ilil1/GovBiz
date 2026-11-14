"""평가 계산과 외부 점수 전송에 재시도 정책을 적용하는 Prefect 작업."""

from pathlib import Path

from prefect import task
from prefect.cache_policies import NO_CACHE

from govbiz_ai_runtime.config import LangfuseSettings
from govbiz_evaluation.reporting import create_report, load_results
from pipelines.evaluation.clients import publish_scores


@task(name="validate-capture-and-results", retries=0, cache_policy=NO_CACHE, persist_result=False)
def prepare(fixture: str, capture: str, case_ids: list[str] | None = None) -> dict:
    return load_results(Path(fixture), Path(capture), case_ids)


@task(name="evidently-comparison", retries=1, retry_delay_seconds=1, cache_policy=NO_CACHE, persist_result=False)
def render(current: dict, reference: dict, output: str) -> dict:
    return create_report(current, reference, Path(output))


@task(name="langfuse-scores-and-readback", retries=0, cache_policy=NO_CACHE, persist_result=False)
def publish(current: dict) -> list[str]:
    # 키는 Prefect 인자로 저장하지 않고 실행 프로세스에서 읽는다.
    return publish_scores(current, LangfuseSettings.from_environment())
