"""Resolve Ops-owned inputs before applying the shared recovery contract."""

from govbiz_evaluation_contracts import recovery_inputs as _recovery

from .catalog import contract_context


def read_recovery_inputs(
    results_root,
    evidence_root,
    source_id,
    *,
    artifact_reader=None,
    evidence_reader=None,
    reassessment=False,
):
    with contract_context():
        return _recovery.read_recovery_inputs(
            results_root,
            evidence_root,
            source_id,
            artifact_reader=artifact_reader,
            evidence_reader=evidence_reader,
            reassessment=reassessment,
        )
