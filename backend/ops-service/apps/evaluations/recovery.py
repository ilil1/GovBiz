"""완료된 응답의 후처리 복구 접수와 원본·복구 이력 연결."""

import json

from django.conf import settings
from django.db import transaction

from .admission import lock_admission, require_open
from .artifact_store import read_artifact, read_evidence
from .execution_spec import digest, make_spec, read_release
from .models import EvaluationRun
from .recovery_inputs import read_recovery_inputs
from .services import (
    RequestConflict,
    ResultsUnavailable,
    dispatch_run,
    read_request,
    sync_run,
)

RECOVERABLE = {"FAILED", "CRASHED", "CANCELLED", "RESULT_ERROR"}
FINISHED = RECOVERABLE | {"COMPLETED"}


class ReassessmentAlreadyExists(RequestConflict):
    """Avoid duplicate Langfuse scores after complete or uncertain publication."""


def _same_reassessment(item, evaluator_version):
    return (
        item.recovery_config.get("reassessment_kind") == "stored-response-reassessment"
        and item.recovery_config.get("evaluator_version") == evaluator_version
    )


def _source_identity(run):
    return digest(
        {
            "status": run.status,
            "error_code": run.error_code,
            "dataset_id": run.dataset_id,
            "execution_mode": run.execution_mode,
            "execution_spec_sha256": run.execution_spec_sha256,
            "execution_spec": run.execution_spec,
            "candidate_capture_id": run.candidate_capture_id,
            "reference_capture_id": run.reference_capture_id,
            "reference_config": run.reference_config,
            "live_config": run.live_config,
            "source_run_id": str(run.source_run_id) if run.source_run_id else None,
        }
    )


def recovery_config(run, *, reassessment=False):
    try:
        if reassessment and (run.source_run_id or run.execution_mode != "live"):
            raise ValueError("Reassessment requires an original live execution")
        read_request(run)
        _, config, _ = read_recovery_inputs(
            settings.LLMOPS_RESULTS_DIR,
            settings.LLMOPS_EVIDENCE_DIR,
            str(run.id),
            artifact_reader=lambda name: read_artifact(run.id, name),
            evidence_reader=read_evidence,
            reassessment=reassessment,
        )
        return config
    except (ValueError, OSError, KeyError, TypeError) as exc:
        raise ResultsUnavailable from exc


def recovery_state(run):
    attempts = list(run.recoveries.all())
    # 원본 화면으로 돌아왔을 때 이미 종료된 복구가 계속 접수를 막지 않게 상태를 확인한다.
    for attempt in attempts:
        if attempt.status not in FINISHED:
            sync_run(attempt)
    active = next((item for item in attempts if item.status not in FINISHED), None)
    try:
        recovery_config(run)
        ready = True
    except ResultsUnavailable:
        ready = False
    target_version = read_release()["evaluation"]["version"]
    prior_reassessment = any(_same_reassessment(item, target_version) for item in attempts)
    reassessment_ready = False
    if not ready and not prior_reassessment and run.status in RECOVERABLE and active is None:
        try:
            recovery_config(run, reassessment=True)
            reassessment_ready = True
        except ResultsUnavailable:
            pass
    stage = "unverified"
    try:
        value = json.loads(read_artifact(run.id, "evaluation/manifest.json")).get("stage")
        if isinstance(value, str) and value in {"report", "publish", "completed"}:
            stage = value
    except (ResultsUnavailable, ValueError, OSError, AttributeError):
        pass
    can_recover = (
        ready
        and run.status in RECOVERABLE
        and active is None
        and run.error_code != "PREFECT_STATUS_UNAVAILABLE"
    )
    can_reassess = reassessment_ready and run.error_code != "PREFECT_STATUS_UNAVAILABLE"
    return {
        "inputs_ready": ready,
        "stage": stage,
        "can_recover": can_recover,
        "can_reassess": can_reassess,
        "reassessment_blocked_reason": ""
        if can_reassess
        else (
            "같은 평가기로 재평가한 기록이 있습니다. 결과 또는 실패 원인을 확인해 주세요."
            if prior_reassessment
            else "진행 중인 복구 또는 재평가를 먼저 확인해 주세요."
            if active
            else "평가의 종료 상태를 확인할 수 없어 재평가할 수 없습니다."
            if run.error_code == "PREFECT_STATUS_UNAVAILABLE"
            else "평가가 종료된 후 재평가할 수 있습니다."
            if run.status not in RECOVERABLE
            else "저장된 응답과 재평가 입력을 확인할 수 없습니다."
        ),
        "blocked_reason": ""
        if can_recover
        else (
            "진행 중인 복구 실행을 먼저 확인하세요."
            if active
            else "완료 응답·입력 무결성 또는 원본 평가기 버전의 호환성을 확인할 수 없습니다."
            if not ready
            else "실행 종료 상태를 확인한 뒤 실패한 후처리만 복구할 수 있습니다."
        ),
        "attempts": [
            {
                "id": str(item.id),
                "status": item.status,
                "status_label": item.get_status_display(),
                "recovery_kind": "reassessment"
                if item.recovery_config.get("reassessment_kind") == "stored-response-reassessment"
                else "recovery",
            }
            for item in attempts
        ],
    }


def submit_recovery(user, source, request_id, *, reassessment=False):
    # 이미 접수한 요청은 같은 명세로만 재전송한다. 이후 파일 변경은 실행기에서 거절한다.
    existing = EvaluationRun.objects.filter(pk=request_id).first()
    if existing:
        if (
            existing.source_run_id != source.pk
            or existing.requested_by_id != user.pk
            or (existing.recovery_config.get("reassessment_kind") == "stored-response-reassessment")
            != reassessment
        ):
            raise RequestConflict
        return dispatch_run(existing), False
    sync_run(source)
    if source.status not in RECOVERABLE or source.error_code == "PREFECT_STATUS_UNAVAILABLE":
        raise RequestConflict
    identity = _source_identity(source)
    config = recovery_config(source, reassessment=reassessment)
    spec = make_spec(
        read_release(source.dataset_id),
        source.dataset_id,
        "recovery",
        {},
        source.candidate_capture_id,
        source.reference_capture_id,
        source.reference_config,
        recovery_config=config,
    )
    # 종료된 복구 상태를 갱신하는 외부 HTTP 호출은 DB transaction 밖에서 한다.
    recovery_state(source)
    with transaction.atomic():
        locked = EvaluationRun.objects.select_for_update().get(pk=source.pk)
        existing = EvaluationRun.objects.filter(pk=request_id).first()
        if existing:
            if (
                existing.source_run_id != source.pk
                or existing.requested_by_id != user.pk
                or (
                    existing.recovery_config.get("reassessment_kind")
                    == "stored-response-reassessment"
                )
                != reassessment
            ):
                raise RequestConflict
            run, created = existing, False
        else:
            require_open(lock_admission())
            if reassessment and any(
                _same_reassessment(item, config["evaluator_version"])
                for item in locked.recoveries.all()
            ):
                raise ReassessmentAlreadyExists
            if (
                locked.status not in RECOVERABLE
                or _source_identity(locked) != identity
                or locked.recoveries.exclude(status__in=FINISHED).exists()
            ):
                raise RequestConflict
            run, created = EvaluationRun.objects.get_or_create(
                id=request_id,
                defaults={
                    "requested_by": user,
                    "source_run": locked,
                    "dataset_id": locked.dataset_id,
                    "candidate_capture_id": locked.candidate_capture_id,
                    "reference_capture_id": locked.reference_capture_id,
                    "reference_config": locked.reference_config,
                    "execution_mode": "recovery",
                    "recovery_config": config,
                    "execution_spec": spec,
                    "execution_spec_sha256": digest(spec),
                    "model_api_calls": 0,
                },
            )
            if (
                run.source_run_id != source.pk
                or run.requested_by_id != user.pk
                or (run.recovery_config.get("reassessment_kind") == "stored-response-reassessment")
                != reassessment
            ):
                raise RequestConflict
    return dispatch_run(run), created
