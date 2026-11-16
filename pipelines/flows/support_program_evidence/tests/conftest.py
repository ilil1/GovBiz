"""외부 모델 호출 없이 파이프라인의 계약과 실패 처리를 검증한다."""
# Flow 함수 단위 테스트는 Prefect 서버 없이 내부 Task의 본문을 실행한다.

import pytest
from prefect.context import FlowRunContext
import prefect.task_engine


@pytest.fixture(autouse=True)
def isolated_prefect_tasks(monkeypatch):
    original = prefect.task_engine.run_task
    stages = []
    names = {
        "validate-evaluation-inputs", "claim-evaluation-budget", "generate-evaluation-responses",
        "validate-rag-results", "render-rag-comparison", "publish-rag-scores",
    }

    def run_task(*args, **kwargs):
        task = kwargs.get("task")
        if task is None or task.name not in names or FlowRunContext.get() is not None:
            return original(*args, **kwargs)
        stages.append((task.name, task.retries))
        return task.fn(**kwargs.get("parameters", {}))

    monkeypatch.setattr(prefect.task_engine, "run_task", run_task)
    return stages
