"""검증된 평가 점수를 Langfuse에 전송하고 저장 여부를 확인한다."""

import time

import httpx
from langfuse.api.client import LangfuseAPI

from govbiz_evaluation import evaluate
from govbiz_ai_runtime.config import LangfuseSettings
from govbiz_evaluation.reporting import score_payloads


def publish_scores(result: dict, settings: LangfuseSettings) -> list[str]:
    return publish_payloads(score_payloads(result, settings), settings)


def publish_payloads(payloads: list[dict], settings: LangfuseSettings) -> list[str]:
    """범위별 검증을 마친 점수를 등록하고 실제 서버 저장을 재조회한다."""
    evaluate.require(settings.enabled, "Langfuse must be explicitly enabled for publication")
    # 재전송 시 날짜가 달라지면 같은 ID라도 별도 점수가 될 수 있으므로 자동 POST 재시도는 하지 않는다.
    options = {"max_retries": 0, "timeout_in_seconds": 20}
    with httpx.Client(timeout=20) as transport:
        client = LangfuseAPI(username=settings.public_key, password=settings.secret_key,
                             base_url=settings.base_url, httpx_client=transport, timeout=20)

        def stored(expected: dict) -> bool:
            deadline = time.monotonic() + 60
            while True:
                actual = {}
                identifiers = list(expected)
                try:
                    for start in range(0, len(identifiers), 100):
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            return False
                        read_options = {**options, "timeout_in_seconds": min(20, remaining)}
                        found = client.scores_v3.get_many_v3(id=",".join(identifiers[start:start + 100]), limit=100,
                                                            fields="details,subject", request_options=read_options)
                        actual.update({score.id: score for score in found.data})
                except httpx.TimeoutException:
                    # 읽기는 부작용이 없으므로 제한 시간 안에서 다시 확인할 수 있다.
                    pass
                else:
                    if all(identifier in actual and actual[identifier].value == payload["value"]
                           and actual[identifier].name == payload["name"] for identifier, payload in expected.items()):
                        return True
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                time.sleep(min(1, remaining))

        for payload in payloads:
            try:
                client.scores.create(**payload, request_options=options)
            except httpx.TimeoutException:
                # 서버에 이미 접수됐을 수 있다. 재전송하지 않고 실제 저장이 확인된 경우에만 진행한다.
                if not stored({payload["id"]: payload}):
                    raise
        expected = {payload["id"]: payload for payload in payloads}
        if not stored(expected):
            raise RuntimeError("Langfuse score persistence verification timed out")
        return list(expected)
