"""Django와 실행기가 함께 검증하는 후처리 복구 입력. 모델·평가 SDK를 사용하지 않는다."""

import json
import re
from hashlib import sha256
from uuid import UUID

from .catalog import RAG_SCOPE, evaluation_scope, selection, validate_reference_config
from .execution_spec import digest, read_release


def read_recovery_inputs(
    results_root,
    evidence_root,
    source_id,
    *,
    artifact_reader=None,
    evidence_reader=None,
    reassessment=False,
):
    """원본 요청·검증 manifest에 고정된 완료 응답만 반환한다. 경로는 서버가 구성한다."""
    try:
        source_id = str(UUID(source_id))
        folder = results_root.resolve() / source_id

        def read(root, name):
            path = (root / name).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                raise ValueError("Recovery input path is invalid")
            return path.read_bytes()

        # Ops can read through authenticated HTTP; the Compose runner keeps local reads.
        result_bytes = artifact_reader or (lambda name: read(folder, name))
        evidence_bytes = evidence_reader or (lambda name: read(evidence_root.resolve(), name))
        request_raw = result_bytes("request.json")
        marker = json.loads(request_raw)
        manifest_raw = result_bytes("evaluation/manifest.json")
        manifest = json.loads(manifest_raw)
        rag = evaluation_scope(marker["dataset_id"]) == RAG_SCOPE
        evaluator = read_release()["rag_evaluation" if rag else "evaluation"]
        spec = marker.get("execution_spec")
        if reassessment:
            # A new evaluation of a stored response is not a same-version recovery.
            # Limit this separate path to completed fixed-answer live captures whose
            # original evaluation stopped while publishing; preserve both versions.
            source_version = manifest.get("evaluator_version")
            approved_version = (
                spec.get("evaluation", {}).get("version") if isinstance(spec, dict) else None
            )
            if (
                rag
                or marker.get("execution_mode") != "live"
                or not isinstance(spec, dict)
                or spec.get("schema_version") != 2
                or spec.get("evaluation_scope") != "fixed-answer-context-only"
                or manifest.get("scope") != "fixed-answer-context-only"
                or manifest.get("status") != "failed"
                or manifest.get("stage") != "publish"
                or not isinstance(source_version, str)
                or not re.fullmatch(r"[a-f0-9]{64}", source_version)
                or source_version == evaluator["version"]
                or not isinstance(approved_version, str)
                or not re.fullmatch(r"[a-f0-9]{64}", approved_version)
                or spec["evaluation"].get("sha256") != approved_version
                or digest(spec) != marker.get("execution_spec_sha256")
                or manifest.get("execution_spec_sha256") != marker.get("execution_spec_sha256")
                or spec.get("dataset_id") != marker["dataset_id"]
                or spec.get("execution_mode") != "live"
                or spec.get("live_config") != marker.get("live_config")
                or spec.get("candidate_capture_id") != marker["candidate_capture_id"]
                or spec.get("reference_capture_id") != marker["reference_capture_id"]
                or spec.get("reference_config") != marker.get("reference_config", {})
            ):
                raise ValueError(
                    "Stored response reassessment source is incompatible or unverified"
                )
        elif manifest.get("evaluator_version") != evaluator["version"] or (
            spec
            and (
                spec["evaluation"] != evaluator
                or digest(spec) != marker.get("execution_spec_sha256")
                or manifest.get("execution_spec_sha256") != marker.get("execution_spec_sha256")
            )
        ):
            raise ValueError("Recovery evaluator is incompatible or unverified")
        dataset, candidate, reference = selection(
            marker["dataset_id"], marker["candidate_capture_id"], marker["reference_capture_id"]
        )
        if (
            marker["request_id"] != source_id
            or type(manifest["model_api_calls"]) is not int
            or manifest["model_api_calls"] != 0
            or manifest["fixture_sha256"] != dataset["fixture_sha256"]
        ):
            raise ValueError("Recovery source differs")
        mode = marker.get("execution_mode", "replay")
        if mode not in {"replay", "live", "recovery"}:
            raise ValueError("Invalid source mode")
        if rag and (
            not spec
            or spec["evaluation_scope"] != RAG_SCOPE
            or (mode != "live" and marker.get("live_config"))
            or manifest.get("scope") != RAG_SCOPE
            or manifest.get("stage") not in {"report", "publish", "completed"}
        ):
            raise ValueError("RAG recovery requires validated replay inputs")
        reference_config = marker.get("reference_config", {})
        validate_reference_config(dataset["id"], marker["reference_capture_id"], reference_config)
        inputs = {
            "fixture": result_bytes("recovery-fixture.json")
            if mode == "recovery"
            else evidence_bytes(dataset["fixture"]),
            "capture": result_bytes("capture/capture.json")
            if mode in {"live", "recovery"}
            else evidence_bytes(candidate["path"]),
            "reference_capture": result_bytes("reference-capture.json")
            if reference_config or mode == "recovery"
            else evidence_bytes(reference["path"]),
        }
        config = {
            "source_run_id": source_id,
            "source_request_sha256": sha256(request_raw).hexdigest(),
            "evaluator_sha256": evaluator["sha256"],
            "evaluator_version": evaluator["version"],
        }
        if reassessment:
            config.update(
                reassessment_kind="stored-response-reassessment",
                source_manifest_sha256=sha256(manifest_raw).hexdigest(),
                source_evaluator_version=source_version,
                source_approved_evaluator_version=approved_version,
            )
        for name, raw in inputs.items():
            actual_hash = sha256(raw).hexdigest()
            if actual_hash != manifest[f"{name}_sha256"]:
                raise ValueError("Recovery input changed")
            config[f"{name}_sha256"] = actual_hash
            if name == "fixture":
                continue
            capture = json.loads(raw)
            case_ids = [case["caseId"] for case in capture["cases"]]
            if rag:
                if (
                    capture.get("scope") != RAG_SCOPE
                    or capture.get("schemaVersion")
                    not in {"support-program-rag-capture-v1", "support-program-rag-capture-v2"}
                    or capture["fixtureSha256"] != dataset["fixture_sha256"]
                    or case_ids != dataset["case_ids"]
                ):
                    raise ValueError("RAG replay recovery source differs")
                continue
            if (
                capture["completed"] is not True
                or capture["fixtureSha256"] != dataset["fixture_sha256"]
                or len(case_ids) != len(set(case_ids))
                or not set(dataset["case_ids"]) <= set(case_ids)
                or capture.get("caseIds", case_ids) != case_ids
                or any(
                    case.get("error") or not isinstance(case.get("response"), dict)
                    for case in capture["cases"]
                )
            ):
                raise ValueError("Recovery requires complete responses")
        if (
            reference_config
            and config["reference_capture_sha256"] != reference_config["capture_sha256"]
        ):
            raise ValueError("Reference snapshot differs")
        if mode == "recovery" and any(
            config[f"{name}_sha256"] != marker["recovery_config"][f"{name}_sha256"]
            for name in inputs
        ):
            raise ValueError("Recovery snapshot differs from dispatch")
        if rag and mode == "live":
            from .rag_replay import validate_live_capture

            capture = json.loads(inputs["capture"])
            validated = validate_live_capture(
                capture,
                json.loads(result_bytes("capture/usage-summary.json")),
                spec,
                marker["execution_spec_sha256"],
            )
            if not validated["completed"]:
                raise ValueError("RAG recovery requires complete responses")
            config["recorded_execution"] = capture["execution"]
        elif rag and mode == "recovery" and marker["recovery_config"].get("recorded_execution"):
            config["recorded_execution"] = marker["recovery_config"]["recorded_execution"]
            if json.loads(inputs["capture"])["execution"] != config["recorded_execution"]:
                raise ValueError("Recovered RAG generation changed")
        if mode == "live" and not rag:
            capture = json.loads(inputs["capture"])
            approved = marker["live_config"]
            if reassessment:
                operations = spec["model_operations"]
                case_ids = dataset["case_ids"]
                responses = capture["apiResponses"]
                if (
                    spec["dataset"]["fixture_sha256"] != dataset["fixture_sha256"]
                    or spec["dataset"]["case_ids"] != case_ids
                    or spec["reference_sha256"] != config["reference_capture_sha256"]
                    or capture.get("scope") != "fixed-answer-context-only"
                    or capture.get("promptSha256") != spec["generation"]["prompt_sha256"]
                    or capture.get("runnerSha256")
                    != spec["generation"]["files"][
                        "evaluation/support-program-evidence/evaluate.py"
                    ]
                    or type(approved.get("max_input_tokens")) is not int
                    or type(capture.get("maxInputTokens")) is not int
                    or capture.get("maxInputTokens") != approved["max_input_tokens"]
                    or any(case.get("outcome") != "success" for case in capture["cases"])
                    or not isinstance(operations, list)
                    or len(operations) != len(case_ids)
                    or not isinstance(responses, list)
                    or len(responses) != len(case_ids)
                    or any(
                        op.get("id") != f"answer:{case_id}"
                        or op.get("kind") != "answer"
                        or op.get("case_id") != case_id
                        or op.get("model") != approved["model"]
                        or op.get("max_input_tokens") != approved["max_input_tokens"]
                        or op.get("max_output_tokens") != approved["max_output_tokens"]
                        for op, case_id in zip(operations, case_ids, strict=True)
                    )
                ):
                    raise ValueError("Stored response source does not match its approved inputs")
                indexes = [
                    index for case in capture["cases"] for index in case["apiResponseIndexes"]
                ]
                if sorted(indexes) != list(range(len(responses))) or any(
                    type(i) is not int for i in indexes
                ):
                    raise ValueError("Stored response calls are incomplete")
                for response in responses:
                    usage = response["usage"]
                    if (
                        response["httpStatus"] != 200
                        or response["responseStatus"] != "completed"
                        or any(
                            type(usage[key]) is not int or usage[key] < 0
                            for key in ("input_tokens", "output_tokens", "total_tokens")
                        )
                        or usage["total_tokens"] != usage["input_tokens"] + usage["output_tokens"]
                        or usage["input_tokens"] > approved["max_input_tokens"]
                        or usage["output_tokens"] > approved["max_output_tokens"]
                    ):
                        raise ValueError("Stored response usage is incomplete")
            if (
                capture["model"] != approved["model"]
                or capture["caseIds"] != dataset["case_ids"]
                or capture["fixtureSha256"] != approved["fixture_sha256"]
                or type(capture["modelApiCalls"]) is not int
                or capture["modelApiCalls"] != approved["max_model_calls"]
                or capture["maxModelCalls"] != approved["max_model_calls"]
                or capture["maxOutputTokens"] != approved["max_output_tokens"]
            ):
                raise ValueError("Source generation does not match its approval")
        return marker, config, inputs
    except (OSError, KeyError, TypeError, AttributeError) as exc:
        raise ValueError("Recovery inputs are unavailable") from exc
