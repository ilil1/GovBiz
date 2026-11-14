"""Read Ops-owned result artifacts before rendering the shared RAG evidence contract."""

import json
from hashlib import sha256

from govbiz_evaluation_contracts.rag_material import material_from_sources

from .catalog import RAG_SCOPE, selection
from .execution_spec import digest
from .rag_replay import require


def read_material(run):
    from .artifact_store import read_artifact, read_evidence
    from .services import ResultsUnavailable, read_result

    try:
        require(run.status == "COMPLETED" and run.execution_mode in {"replay", "recovery", "live"})
        require(run.execution_spec["evaluation_scope"] == RAG_SCOPE)
        require(run.execution_spec["execution_mode"] == run.execution_mode)
        _, _, _, comparison = read_result(run)
        dataset, candidate, reference = selection(
            run.dataset_id, run.candidate_capture_id, run.reference_capture_id
        )
        require(dataset["evaluation_scope"] == RAG_SCOPE)
        values = []
        for path, recovery_path, expected in (
            (
                dataset["fixture"],
                "recovery-fixture.json",
                run.execution_spec["dataset"]["fixture_sha256"],
            ),
            (candidate.get("path"), "capture/capture.json", comparison["current"]["captureSha256"]),
            (
                reference.get("path"),
                "reference-capture.json",
                run.execution_spec["reference_sha256"],
            ),
        ):
            raw = (
                read_artifact(run.pk, recovery_path)
                if run.execution_mode == "recovery" or path is None
                else read_evidence(path)
            )
            require(sha256(raw).hexdigest() == expected)
            values.append(json.loads(raw))
        material = material_from_sources(*values, comparison)
        return {**material, "material_sha256": digest(material)}
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise ResultsUnavailable from exc
