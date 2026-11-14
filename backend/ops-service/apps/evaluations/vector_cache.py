"""Ops settings and HTTP adapter for the shared immutable vector cache."""

import json

from django.conf import settings
from govbiz_evaluation_contracts import vector_cache as _cache

MAX_BYTES = _cache.MAX_BYTES
cache_name = _cache.cache_name
results_root = _cache.results_root
validate = _cache.validate
read = _cache.read
status = _cache.status
operations = _cache.operations
apply_plan = _cache.apply_plan
publish = _cache.publish


def discover(key):
    cache_name(key)
    if settings.configured:
        if settings.LLMOPS_ARTIFACT_URL:
            from .artifact_store import remote_read

            value = json.loads(remote_read("/v1/vector-cache/" + key, max_bytes=1024))
        else:
            value = status(settings.LLMOPS_RESULTS_DIR, key)
    else:
        value = status(results_root(), key)
    return _cache.status_fingerprint(value, key)


def selection(keys):
    with _cache.discovery_context(discover):
        return _cache.selection(keys)
