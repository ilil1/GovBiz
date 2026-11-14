"""Langfuse 재전송의 점수 ID 안정성과 저장 재조회를 검증한다."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from pipelines.evaluation import clients, tasks
from govbiz_evaluation import reporting
from govbiz_ai_runtime.config import LangfuseSettings

HERE = Path(__file__).resolve().parents[2] / "evaluation/support-program-evidence"
FIXTURE = HERE / "target-coverage-fixture.json"
CAPTURE = HERE / "runs/target-coverage-20260907-v1/capture.json"


def test_score_retry_uses_stable_ids_without_inventing_model_traces(monkeypatch):
    result = reporting.load_results(FIXTURE, CAPTURE)
    settings = LangfuseSettings(enabled=True, base_url="http://localhost:13000", public_key="test", secret_key="test")
    store = {}
    def create(**payload):
        assert "trace_id" not in payload
        assert payload["session_id"] == result["run_id"]
        store[payload["id"]] = SimpleNamespace(id=payload["id"], name=payload["name"], value=payload["value"])
    client = SimpleNamespace(
        scores=SimpleNamespace(create=create),
        scores_v3=SimpleNamespace(get_many_v3=lambda **kwargs: SimpleNamespace(data=list(store.values()))),
    )
    monkeypatch.setattr(clients, "LangfuseAPI", lambda **kwargs: client)
    first = clients.publish_scores(result, settings)
    second = clients.publish_scores(result, settings)
    assert first == second
    assert len(store) == len(first)
    payloads = json.dumps(reporting.score_payloads(result, settings))
    assert result["capture"]["cases"][0]["response"]["answer"] not in payloads


def test_score_write_timeout_checks_stored_result_without_reposting(monkeypatch):
    assert tasks.publish.retries == 0
    settings = LangfuseSettings(enabled=True, base_url="http://localhost:13000", public_key="test", secret_key="test")
    payload = {"id": "score-1", "name": "accuracy", "value": 1.0}
    calls = {"post": 0, "read": 0}
    clock = [0.0]

    def create(**kwargs):
        calls["post"] += 1
        assert kwargs["request_options"]["timeout_in_seconds"] == 20
        raise clients.httpx.ReadTimeout("response lost after write")

    def read(**_kwargs):
        calls["read"] += 1
        if calls["read"] == 1:
            raise clients.httpx.ReadTimeout("temporary read delay")
        return SimpleNamespace(data=[SimpleNamespace(id="score-1", name="accuracy", value=1.0)])

    monkeypatch.setattr(clients, "LangfuseAPI", lambda **_: SimpleNamespace(
        scores=SimpleNamespace(create=create), scores_v3=SimpleNamespace(get_many_v3=read)))
    monkeypatch.setattr(clients, "time", SimpleNamespace(monotonic=lambda: clock[0], sleep=lambda seconds: clock.__setitem__(0, clock[0] + seconds)))
    assert clients.publish_payloads([payload], settings) == ["score-1"]
    assert calls["post"] == 1
    assert calls["read"] == 3  # 임시 조회 실패, 저장 확인, 전체 재확인


def test_score_write_timeout_does_not_retry_or_claim_unverified_success(monkeypatch):
    settings = LangfuseSettings(enabled=True, base_url="http://localhost:13000", public_key="test", secret_key="test")
    payload = {"id": "score-1", "name": "accuracy", "value": 1.0}
    posts = []
    clock = [0.0]

    def create(**_kwargs):
        posts.append(1)
        raise clients.httpx.ReadTimeout("response lost")

    monkeypatch.setattr(clients, "LangfuseAPI", lambda **_: SimpleNamespace(
        scores=SimpleNamespace(create=create), scores_v3=SimpleNamespace(get_many_v3=lambda **_: SimpleNamespace(data=[]))))
    monkeypatch.setattr(clients, "time", SimpleNamespace(monotonic=lambda: clock[0], sleep=lambda seconds: clock.__setitem__(0, clock[0] + seconds)))
    with pytest.raises(clients.httpx.ReadTimeout):
        clients.publish_payloads([payload], settings)
    assert len(posts) == 1
    assert clock[0] == 60


def test_score_readback_requires_matching_value_and_does_not_repost(monkeypatch):
    settings = LangfuseSettings(enabled=True, base_url="http://localhost:13000", public_key="test", secret_key="test")
    payload = {"id": "score-1", "name": "accuracy", "value": 1.0}
    posts = []
    clock = [0.0]
    monkeypatch.setattr(clients, "LangfuseAPI", lambda **_: SimpleNamespace(
        scores=SimpleNamespace(create=lambda **kwargs: posts.append(kwargs)),
        scores_v3=SimpleNamespace(get_many_v3=lambda **_: SimpleNamespace(data=[SimpleNamespace(id="score-1", name="accuracy", value=0.0)]))))
    monkeypatch.setattr(clients, "time", SimpleNamespace(monotonic=lambda: clock[0], sleep=lambda seconds: clock.__setitem__(0, clock[0] + seconds)))
    with pytest.raises(RuntimeError, match="persistence verification timed out"):
        clients.publish_payloads([payload], settings)
    assert len(posts) == 1
    assert clock[0] == 60
