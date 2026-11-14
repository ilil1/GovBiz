"""Ops storage adapters for the shared immutable evaluation catalog."""

from contextlib import contextmanager

from govbiz_evaluation_contracts import catalog as _catalog
from govbiz_evaluation_contracts.managed_materials import validate_snapshot

DATASETS = _catalog.DATASETS
LEGACY_DATASET_ID = _catalog.LEGACY_DATASET_ID
LIVE_CAPTURE_ID = _catalog.LIVE_CAPTURE_ID
MAX_INPUT_TOKENS = _catalog.MAX_INPUT_TOKENS
RAG_SCOPE = _catalog.RAG_SCOPE
DEFAULT_ALLOWED_MODELS = _catalog.DEFAULT_ALLOWED_MODELS
managed_snapshot_context = _catalog.managed_snapshot_context
allowed_models = _catalog.allowed_models
reference_run_id = _catalog.reference_run_id


def _database_snapshot(dataset_id):
    from .models import EvaluationDatasetRevision

    revision = EvaluationDatasetRevision.objects.filter(pk=dataset_id).first()
    if revision is None:
        raise KeyError(dataset_id)
    return validate_snapshot(revision.snapshot)


@contextmanager
def contract_context():
    from .vector_cache import discover

    with _catalog.evaluation_context(snapshot_reader=_database_snapshot, vector_reader=discover):
        yield


def get_snapshot(dataset_id):
    with contract_context():
        return _catalog.get_snapshot(dataset_id)


def get_dataset(dataset_id):
    with contract_context():
        return _catalog.get_dataset(dataset_id)


def dataset_label(dataset_id):
    with contract_context():
        return _catalog.dataset_label(dataset_id)


def managed_datasets():
    """Expose only the latest published revisions of nonarchived datasets."""
    from .models import EvaluationDatasetRevision

    result, seen = [], set()
    for revision in EvaluationDatasetRevision.objects.filter(dataset__archived=False).order_by(
        "dataset_id", "-number"
    ):
        if revision.dataset_id not in seen:
            seen.add(revision.dataset_id)
            result.append(validate_snapshot(revision.snapshot)["catalog"])
    return result


def read_managed_evidence(name):
    with contract_context():
        return _catalog.read_managed_evidence(name)


def evaluation_scope(dataset_id):
    with contract_context():
        return _catalog.evaluation_scope(dataset_id)


def live_config(dataset_id, *, model=None, document_vectors=None):
    with contract_context():
        return _catalog.live_config(dataset_id, model=model, document_vectors=document_vectors)


def validate_execution(
    dataset_id, candidate_id, reference_id, execution_mode, config, *, pinned_vectors=False
):
    with contract_context():
        return _catalog.validate_execution(
            dataset_id,
            candidate_id,
            reference_id,
            execution_mode,
            config,
            pinned_vectors=pinned_vectors,
        )


def selection(dataset_id, candidate_capture_id, reference_capture_id):
    with contract_context():
        return _catalog.selection(dataset_id, candidate_capture_id, reference_capture_id)


def validate_reference_config(dataset_id, capture_id, config):
    with contract_context():
        return _catalog.validate_reference_config(dataset_id, capture_id, config)


def public_datasets(*, include_managed=False):
    with contract_context():
        return _catalog.public_datasets(managed_items=managed_datasets() if include_managed else ())
